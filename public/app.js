const state = {
  items: [],
  qrUrl: ""
};

const itemsEl = document.querySelector("#items");
const statusEl = document.querySelector("#status");
const textInput = document.querySelector("#textInput");
const sendTextButton = document.querySelector("#sendTextButton");
const fileInput = document.querySelector("#fileInput");
const dropzone = document.querySelector("#dropzone");
const queueEl = document.querySelector("#queue");
const addressesEl = document.querySelector("#addresses");
const qrImage = document.querySelector("#qrImage");
const qrUrl = document.querySelector("#qrUrl");

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.panel}`).classList.add("active");
  });
});

document.querySelector("#refreshButton").addEventListener("click", refreshAll);
sendTextButton.addEventListener("click", sendText);
fileInput.addEventListener("change", () => uploadFiles(fileInput.files));

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  });
});

dropzone.addEventListener("drop", (event) => {
  const files = event.dataTransfer?.files || [];
  uploadFiles(files);
});

itemsEl.addEventListener("click", async (event) => {
  const action = event.target?.dataset?.action;
  const itemEl = event.target.closest(".item");
  if (!action || !itemEl) return;

  const item = state.items.find((entry) => entry.id === itemEl.dataset.id);
  if (!item) return;

  if (action === "copy") {
    await copyText(item.content);
    setStatus("已复制");
  }

  if (action === "delete") {
    await request(`/api/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    await refresh();
  }
});

await refreshAll();
setInterval(refresh, 5000);

async function refreshAll() {
  await Promise.all([refresh(), loadInfo()]);
  setStatus("已刷新");
}

async function loadInfo() {
  if (!addressesEl || !qrImage || !qrUrl) return;

  const info = await requestJson("/api/info");
  addressesEl.innerHTML = "";

  const currentOrigin = window.location.origin;
  const urls = [...new Set([currentOrigin, ...(info.urls || [])])];
  const scanUrl = state.qrUrl && urls.includes(state.qrUrl)
    ? state.qrUrl
    : urls.find((url) => url.startsWith("https://")) || urls[0];
  setQrCode(scanUrl);

  for (const url of urls) {
    const row = document.createElement("div");
    row.className = "address-row";

    const code = document.createElement("code");
    code.textContent = url;

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "复制";
    button.addEventListener("click", async () => {
      await copyText(url);
      setStatus("地址已复制");
    });

    const qrButton = document.createElement("button");
    qrButton.type = "button";
    qrButton.textContent = "二维码";
    qrButton.addEventListener("click", () => {
      setQrCode(url);
      setStatus("二维码已切换");
    });

    row.append(code, qrButton, button);
    addressesEl.append(row);
  }
}

function setQrCode(url) {
  state.qrUrl = url;
  qrUrl.textContent = url;
  qrImage.src = `/api/qr?url=${encodeURIComponent(url)}&t=${Date.now()}`;
}

async function sendText() {
  const content = textInput.value.trim();
  if (!content) {
    textInput.focus();
    return;
  }

  sendTextButton.disabled = true;
  setStatus("正在发送文字");

  try {
    await request("/api/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content })
    });
    textInput.value = "";
    await refresh();
    setStatus("文字已发送");
  } finally {
    sendTextButton.disabled = false;
  }
}

async function uploadFiles(files) {
  const list = [...files];
  if (!list.length) return;

  queueEl.innerHTML = "";
  for (const file of list) {
    const row = document.createElement("div");
    row.textContent = `上传中：${file.name}`;
    queueEl.append(row);

    try {
      await request(`/api/upload?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });
      row.textContent = `已上传：${file.name}`;
    } catch (error) {
      row.textContent = `上传失败：${file.name}`;
      setStatus(error.message);
    }
  }

  fileInput.value = "";
  await refresh();
  setTimeout(() => {
    queueEl.innerHTML = "";
  }, 1600);
}

async function refresh() {
  const items = await requestJson("/api/items");
  state.items = Array.isArray(items) ? items : [];
  renderItems();
  setStatus(`${state.items.length} 条记录`);
}

function renderItems() {
  itemsEl.innerHTML = "";

  if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "还没有内容，先从任意设备发一条。";
    itemsEl.append(empty);
    return;
  }

  for (const item of state.items) {
    itemsEl.append(item.type === "text" ? renderText(item) : renderFile(item));
  }
}

function renderText(item) {
  const node = document.querySelector("#textTemplate").content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;
  node.querySelector(".content").textContent = item.content;
  node.querySelector("time").textContent = formatTime(item.createdAt);
  return node;
}

function renderFile(item) {
  const node = document.querySelector("#fileTemplate").content.firstElementChild.cloneNode(true);
  node.dataset.id = item.id;
  node.querySelector(".filename").textContent = `${item.name} · ${formatSize(item.size)}`;
  node.querySelector("time").textContent = formatTime(item.createdAt);

  const link = node.querySelector("[data-action='download']");
  link.href = item.url;
  link.download = item.name;

  if (item.mimeType?.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.name;
    node.querySelector(".thumb").append(img);
  }

  return node;
}

async function requestJson(url, options) {
  const response = await request(url, options);
  return response.json();
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (response.ok) return response;

  if (response.status === 401) {
    throw new Error("需要输入访问口令");
  }

  let detail = "";
  try {
    const payload = await response.json();
    detail = payload.error || "";
  } catch {
    detail = await response.text();
  }
  throw new Error(detail || `请求失败：${response.status}`);
}

function setStatus(message) {
  statusEl.textContent = message;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea-based copy path for HTTP browsers.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("复制失败，请长按文字手动复制");
  } finally {
    textarea.remove();
  }
}

function formatTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
