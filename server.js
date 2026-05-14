import { createServer } from "node:http";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";

const rootDir = process.cwd();
const publicDir = join(rootDir, "public");
const storageDir = join(rootDir, "storage");
const filesDir = join(storageDir, "files");
const textsFile = join(storageDir, "texts.json");
const port = Number(process.env.PORT || 6789);
const maxUploadBytes = Number(process.env.MAX_UPLOAD_MB || 500) * 1024 * 1024;
const publicUrl = normalizePublicUrl(process.env.PUBLIC_URL || "");
const authUser = process.env.PASS_USER || "pass";
const authPassword = process.env.PASS_PASSWORD || process.env.PASS_TOKEN || "";
const authAccounts = parseAuthAccounts(process.env.PASS_ACCOUNTS || "", authUser, authPassword);
const storedNameSeparator = "__";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"]
]);

await mkdir(filesDir, { recursive: true });
await ensureTextsFile();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (!isAuthorized(req)) {
      return sendUnauthorized(res);
    }

    if (url.pathname === "/api/health") {
      return sendJson(res, { ok: true });
    }

    if (url.pathname === "/api/info") {
      return sendJson(res, {
        port,
        maxUploadMb: Math.floor(maxUploadBytes / 1024 / 1024),
        urls: getReachableUrls(req)
      });
    }

    if (url.pathname === "/api/qr" && req.method === "GET") {
      return handleQrCode(res, url);
    }

    if (url.pathname === "/api/items" && req.method === "GET") {
      return sendJson(res, await listItems());
    }

    if (url.pathname === "/api/text" && req.method === "POST") {
      return await handleText(req, res);
    }

    if (url.pathname === "/api/upload" && req.method === "POST") {
      return await handleUpload(req, res, url);
    }

    if (url.pathname.startsWith("/api/files/") && req.method === "GET") {
      return await handleDownload(req, res, url.pathname);
    }

    if (url.pathname.startsWith("/api/items/") && req.method === "DELETE") {
      return await handleDelete(req, res, url.pathname);
    }

    if (req.method === "GET") {
      return await serveStatic(req, res, url.pathname);
    }

    sendJson(res, { error: "Not found" }, 404);
  } catch (error) {
    console.error(error);
    sendJson(res, { error: error.message || "Server error" }, 500);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Pass is running at http://localhost:${port}`);
  if (publicUrl) {
    console.log(`Public URL: ${publicUrl}`);
  }
  if (!authAccounts.size) {
    console.warn("WARNING: no Pass accounts are set. Do not expose this service to the internet without authentication.");
  }
  for (const address of getLanAddresses()) {
    console.log(`LAN address: http://${address}:${port}`);
  }
});

async function ensureTextsFile() {
  try {
    await stat(textsFile);
  } catch {
    await mkdir(storageDir, { recursive: true });
    await writeFile(textsFile, "[]\n", "utf8");
  }
}

async function listItems() {
  const [texts, files] = await Promise.all([readTexts(), readFiles()]);
  return [...texts, ...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function readTexts() {
  await ensureTextsFile();
  const data = await readFile(textsFile, "utf8");
  const texts = JSON.parse(data || "[]");
  return texts.map((item) => ({ ...item, type: "text" }));
}

async function writeTexts(texts) {
  await writeFile(textsFile, `${JSON.stringify(texts, null, 2)}\n`, "utf8");
}

async function readFiles() {
  await mkdir(filesDir, { recursive: true });
  const names = await readdir(filesDir);
  const items = [];

  for (const storedName of names) {
    const filePath = join(filesDir, storedName);
    const info = await stat(filePath);
    if (!info.isFile()) continue;

    const separatorIndex = storedName.indexOf(storedNameSeparator);
    const id = separatorIndex > 0 ? storedName.slice(0, separatorIndex) : storedName;
    const originalName = separatorIndex > 0 ? storedName.slice(separatorIndex + storedNameSeparator.length) : storedName;
    const mimeType = guessMime(originalName);

    items.push({
      id,
      type: "file",
      name: originalName,
      storedName,
      size: info.size,
      mimeType,
      createdAt: info.birthtime.toISOString(),
      url: `/api/files/${encodeURIComponent(storedName)}`
    });
  }

  return items;
}

async function handleText(req, res) {
  const body = await readBody(req, 1024 * 1024);
  const payload = JSON.parse(body || "{}");
  const content = String(payload.content || "").trim();

  if (!content) {
    return sendJson(res, { error: "Text is empty" }, 400);
  }

  const texts = await readTexts();
  const item = {
    id: randomUUID(),
    type: "text",
    content,
    createdAt: new Date().toISOString()
  };

  texts.unshift(item);
  await writeTexts(texts.slice(0, 200));
  sendJson(res, item, 201);
}

async function handleUpload(req, res, url) {
  const length = Number(req.headers["content-length"] || 0);
  if (length > maxUploadBytes) {
    return sendJson(res, { error: "File is too large" }, 413);
  }

  const rawName = url.searchParams.get("name") || "file";
  const safeName = sanitizeFilename(rawName);
  const id = randomUUID();
  const storedName = `${id}${storedNameSeparator}${safeName}`;
  const finalPath = join(filesDir, storedName);
  const tempPath = `${finalPath}.tmp`;

  let received = 0;
  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxUploadBytes) {
      req.destroy(new Error("File is too large"));
    }
  });

  await pipeline(req, createWriteStream(tempPath));
  await rename(tempPath, finalPath);

  const info = await stat(finalPath);
  sendJson(res, {
    id,
    type: "file",
    name: safeName,
    storedName,
    size: info.size,
    mimeType: req.headers["content-type"] || guessMime(safeName),
    createdAt: info.birthtime.toISOString(),
    url: `/api/files/${encodeURIComponent(storedName)}`
  }, 201);
}

async function handleQrCode(res, url) {
  const target = String(url.searchParams.get("url") || "").trim();
  if (!target || target.length > 500) {
    return sendJson(res, { error: "Invalid QR code target" }, 400);
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return sendJson(res, { error: "Invalid QR code target" }, 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return sendJson(res, { error: "Unsupported QR code target" }, 400);
  }

  const png = await QRCode.toBuffer(parsed.toString(), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240
  });

  res.writeHead(200, {
    "Content-Type": "image/png",
    "Content-Length": png.length,
    "Cache-Control": "no-store"
  });
  res.end(png);
}

async function handleDownload(req, res, pathname) {
  const storedName = decodeURIComponent(pathname.replace("/api/files/", ""));
  const filePath = resolveInside(filesDir, storedName);
  const info = await stat(filePath);
  const separatorIndex = storedName.indexOf(storedNameSeparator);
  const originalName = separatorIndex > 0 ? storedName.slice(separatorIndex + storedNameSeparator.length) : storedName;

  res.writeHead(200, {
    "Content-Type": guessMime(originalName),
    "Content-Length": info.size,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(originalName)}`
  });
  createReadStream(filePath).pipe(res);
}

async function handleDelete(req, res, pathname) {
  const id = decodeURIComponent(pathname.replace("/api/items/", ""));

  const texts = await readTexts();
  const remainingTexts = texts.filter((item) => item.id !== id);
  if (remainingTexts.length !== texts.length) {
    await writeTexts(remainingTexts);
    return sendJson(res, { ok: true });
  }

  const files = await readFiles();
  const file = files.find((item) => item.id === id || item.storedName === id);
  if (file) {
    await rm(resolveInside(filesDir, file.storedName), { force: true });
    return sendJson(res, { ok: true });
  }

  sendJson(res, { error: "Not found" }, 404);
}

async function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    res.writeHead(204, { "Cache-Control": "no-store" });
    res.end();
    return;
  }

  const route = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolveInside(publicDir, decodeURIComponent(route));
  let info;

  try {
    info = await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return sendJson(res, { error: "Not found" }, 404);
    }
    throw error;
  }

  if (!info.isFile()) {
    return sendJson(res, { error: "Not found" }, 404);
  }

  res.writeHead(200, {
    "Content-Type": mimeTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

function readBody(req, limit) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > limit) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

function sendJson(res, payload, statusCode = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function isAuthorized(req) {
  if (!authAccounts.size) return true;

  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Basic ")) return false;

  let decoded = "";
  try {
    decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return authAccounts.get(user) === password;
}

function parseAuthAccounts(value, fallbackUser, fallbackPassword) {
  const accounts = new Map();
  if (fallbackPassword) {
    accounts.set(fallbackUser, fallbackPassword);
  }

  for (const entry of String(value || "").split(",")) {
    const separator = entry.indexOf(":");
    if (separator <= 0) continue;

    const user = entry.slice(0, separator).trim();
    const password = entry.slice(separator + 1);
    if (user && password) {
      accounts.set(user, password);
    }
  }

  return accounts;
}

function sendUnauthorized(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="Pass", charset="UTF-8"',
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end("Authentication required");
}

function sanitizeFilename(name) {
  const fallback = "file";
  const clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  return clean || fallback;
}

function resolveInside(base, target) {
  const resolvedBase = resolve(base);
  const safeTarget = normalize(target)
    .replace(/^([/\\])+/, "")
    .replace(/^(\.\.(\/|\\|$))+/, "");
  const resolvedTarget = resolve(base, safeTarget);
  if (!resolvedTarget.startsWith(resolvedBase)) {
    throw new Error("Invalid path");
  }
  return resolvedTarget;
}

function guessMime(name) {
  const ext = extname(name).toLowerCase();
  return mimeTypes.get(ext) || "application/octet-stream";
}

function getLanAddresses() {
  const addresses = [];
  for (const items of Object.values(networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === "IPv4" && !item.internal) {
        addresses.push(item.address);
      }
    }
  }
  return addresses.sort((a, b) => scoreAddress(b) - scoreAddress(a));
}

function getReachableUrls(req) {
  const urls = [];

  if (publicUrl) urls.push(publicUrl);

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req.headers.host || "").trim();
  if (host) {
    const proto = forwardedProto || (shouldUseHttpForHost(host) ? "http" : "https");
    urls.push(`${proto}://${host}`);
  }

  urls.push(`http://localhost:${port}`);
  for (const address of getLanAddresses()) {
    urls.push(`http://${address}:${port}`);
  }

  return [...new Set(urls.map((url) => url.replace(/\/+$/, "")))];
}

function shouldUseHttpForHost(host) {
  const hostname = host.replace(/^\[/, "").replace(/\](:\d+)?$/, "").split(":")[0];
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)
    || hostname.startsWith("169.254.");
}

function normalizePublicUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("PUBLIC_URL must be a valid http or https URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("PUBLIC_URL must start with http:// or https://");
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}

function scoreAddress(address) {
  let score = 0;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(address)) score += 20;
  if (/\.1$/.test(address)) score -= 6;
  if (address.startsWith("169.254.")) score -= 20;
  return score;
}
