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
const cleanupStart = document.querySelector("#cleanupStart");
const cleanupEnd = document.querySelector("#cleanupEnd");
const cleanupButton = document.querySelector("#cleanupButton");
const fileManagerEl = document.querySelector("#fileManager");
const fileManagerSummary = document.querySelector("#fileManagerSummary");
const fileTypeFilter = document.querySelector("#fileTypeFilter");
const fileDateFilter = document.querySelector("#fileDateFilter");

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
cleanupButton?.addEventListener("click", cleanupRange);
fileTypeFilter?.addEventListener("change", renderFileManager);
fileDateFilter?.addEventListener("change", renderFileManager);

if (cleanupStart && cleanupEnd) {
  const today = formatDateInput(new Date());
  cleanupStart.value = today;
  cleanupEnd.value = today;
}

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

itemsEl.addEventListener("click", handleItemAction);
fileManagerEl?.addEventListener("click", handleItemAction);

async function handleItemAction(event) {
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
}

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
  renderFileManager();
  setStatus(`${state.items.length} 条记录`);
}

async function cleanupRange() {
  const startDate = cleanupStart?.value || "";
  const endDate = cleanupEnd?.value || "";

  if (!startDate || !endDate) {
    setStatus("请选择开始日期和结束日期");
    return;
  }

  if (startDate > endDate) {
    setStatus("开始日期不能晚于结束日期");
    return;
  }

  const matched = state.items.filter((item) => {
    const date = formatDateInput(new Date(item.createdAt));
    return date >= startDate && date <= endDate;
  }).length;
  const message = `确定清理 ${startDate} 到 ${endDate} 的记录吗？预计影响 ${matched} 条，删除后不能恢复。`;
  if (!window.confirm(message)) return;

  cleanupButton.disabled = true;
  setStatus("正在清理记录");

  try {
    const response = await requestJson("/api/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate })
    });
    await refresh();
    setStatus(`已清理 ${response.deletedTotal || 0} 条记录`);
  } finally {
    cleanupButton.disabled = false;
  }
}

function renderFileManager() {
  if (!fileManagerEl) return;

  const files = state.items.filter((item) => item.type === "file");
  syncFileDateOptions(files);

  const category = fileTypeFilter?.value || "all";
  const dateFilter = fileDateFilter?.value || "all";
  const filteredFiles = files.filter((item) => {
    const categoryMatches = category === "all" || getFileCategory(item) === category;
    const dateMatches = dateFilter === "all" || formatDateInput(new Date(item.createdAt)) === dateFilter;
    return categoryMatches && dateMatches;
  });

  if (fileManagerSummary) {
    fileManagerSummary.textContent = `${filteredFiles.length} / ${files.length} 个文件`;
  }

  fileManagerEl.innerHTML = "";
  if (!filteredFiles.length) {
    const empty = document.createElement("div");
    empty.className = "empty compact-empty";
    empty.textContent = "没有符合条件的文件";
    fileManagerEl.append(empty);
    return;
  }

  const groups = groupFilesByDate(filteredFiles);
  for (const [date, groupFiles] of groups) {
    const group = document.createElement("section");
    group.className = "file-day";

    const header = document.createElement("div");
    header.className = "file-day-header";

    const title = document.createElement("h3");
    title.textContent = formatDateLabel(date);

    const count = document.createElement("span");
    count.textContent = `${groupFiles.length} 个文件`;

    const list = document.createElement("div");
    list.className = "file-day-items";

    for (const file of groupFiles) {
      list.append(renderManagedFile(file));
    }

    header.append(title, count);
    group.append(header, list);
    fileManagerEl.append(group);
  }
}

function syncFileDateOptions(files) {
  if (!fileDateFilter) return;

  const current = fileDateFilter.value || "all";
  const dates = [...new Set(files.map((item) => formatDateInput(new Date(item.createdAt))))].sort((a, b) => b.localeCompare(a));
  fileDateFilter.innerHTML = "";
  fileDateFilter.append(new Option("全部日期", "all"));
  for (const date of dates) {
    fileDateFilter.append(new Option(formatDateLabel(date), date));
  }

  fileDateFilter.value = current === "all" || dates.includes(current) ? current : "all";
}

function groupFilesByDate(files) {
  const groups = new Map();
  for (const file of files) {
    const date = formatDateInput(new Date(file.createdAt));
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(file);
  }
  return [...groups.entries()].sort(([left], [right]) => right.localeCompare(left));
}

function renderManagedFile(item) {
  const node = renderFile(item);
  const badge = node.querySelector(".badge");
  if (badge) badge.textContent = getFileCategoryLabel(item);
  return node;
}

function getFileCategory(item) {
  const mimeType = String(item.mimeType || "").toLowerCase();
  const name = String(item.name || "").toLowerCase();

  if (mimeType.startsWith("image/")) return "image";
  if (
    mimeType.includes("pdf")
    || mimeType.includes("word")
    || mimeType.includes("excel")
    || mimeType.includes("spreadsheet")
    || mimeType.includes("powerpoint")
    || /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv|rtf)$/i.test(name)
  ) {
    return "document";
  }
  return "other";
}

function getFileCategoryLabel(item) {
  const category = getFileCategory(item);
  if (category === "image") return "图片";
  if (category === "document") return "文档";
  return "其他";
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

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(year, month - 1, day));
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
