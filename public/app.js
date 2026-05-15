const state = {
  items: [],
  qrUrl: "",
  fileManager: {
    category: "all",
    date: "all",
    search: ""
  }
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
const fileManagerButton = document.querySelector("#fileManagerButton");
const fileExplorer = document.querySelector("#fileExplorer");
const fileExplorerClose = document.querySelector("#fileExplorerClose");
const fileManagerEl = document.querySelector("#fileManager");
const fileManagerSummary = document.querySelector("#fileManagerSummary");
const fileManagerFolders = document.querySelector("#fileManagerFolders");
const fileManagerBreadcrumb = document.querySelector("#fileManagerBreadcrumb");
const fileSearch = document.querySelector("#fileSearch");

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
fileManagerButton?.addEventListener("click", openFileExplorer);
fileExplorerClose?.addEventListener("click", closeFileExplorer);
fileExplorer?.addEventListener("click", (event) => {
  if (event.target === fileExplorer) closeFileExplorer();
});
fileManagerFolders?.addEventListener("click", handleFolderClick);
fileSearch?.addEventListener("input", () => {
  state.fileManager.search = fileSearch.value.trim().toLowerCase();
  renderFileManager();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && fileExplorer && !fileExplorer.hidden) {
    closeFileExplorer();
  }
});

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

function openFileExplorer() {
  if (!fileExplorer) return;
  fileExplorer.hidden = false;
  document.body.classList.add("explorer-open");
  renderFileManager();
  fileSearch?.focus();
}

function closeFileExplorer() {
  if (!fileExplorer) return;
  fileExplorer.hidden = true;
  document.body.classList.remove("explorer-open");
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
  const visibleFiles = filterManagedFiles(files);
  renderFileFolders(files);

  if (fileManagerSummary) {
    fileManagerSummary.textContent = `${visibleFiles.length} / ${files.length} 个文件`;
  }
  if (fileManagerBreadcrumb) {
    fileManagerBreadcrumb.textContent = getFileManagerTitle();
  }

  fileManagerEl.innerHTML = "";
  if (!visibleFiles.length) {
    const empty = document.createElement("div");
    empty.className = "empty compact-empty";
    empty.textContent = "没有符合条件的文件";
    fileManagerEl.append(empty);
    return;
  }

  for (const file of visibleFiles) {
    fileManagerEl.append(renderManagedFile(file));
  }
}

function filterManagedFiles(files) {
  return files.filter((item) => {
    const categoryMatches = state.fileManager.category === "all" || getFileCategory(item) === state.fileManager.category;
    const dateMatches = state.fileManager.date === "all" || formatDateInput(new Date(item.createdAt)) === state.fileManager.date;
    const searchMatches = !state.fileManager.search || String(item.name || "").toLowerCase().includes(state.fileManager.search);
    return categoryMatches && dateMatches && searchMatches;
  });
}

function renderFileFolders(files) {
  if (!fileManagerFolders) return;

  const folders = [
    { type: "category", value: "all", label: "全部文件", count: files.length },
    { type: "category", value: "image", label: "图片", count: countFilesByCategory(files, "image") },
    { type: "category", value: "document", label: "文档", count: countFilesByCategory(files, "document") },
    { type: "category", value: "other", label: "其他", count: countFilesByCategory(files, "other") }
  ];
  const dates = [...new Set(files.map((item) => formatDateInput(new Date(item.createdAt))))].sort((a, b) => b.localeCompare(a));

  fileManagerFolders.innerHTML = "";
  fileManagerFolders.append(renderFolderGroup("分类", folders));

  const dateFolders = [
    { type: "date", value: "all", label: "全部日期", count: files.length },
    ...dates.map((date) => ({
      type: "date",
      value: date,
      label: formatDateLabel(date),
      count: files.filter((item) => formatDateInput(new Date(item.createdAt)) === date).length
    }))
  ];
  fileManagerFolders.append(renderFolderGroup("日期", dateFolders));
}

function renderFolderGroup(title, folders) {
  const group = document.createElement("div");
  group.className = "folder-group";

  const heading = document.createElement("div");
  heading.className = "folder-heading";
  heading.textContent = title;
  group.append(heading);

  for (const folder of folders) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-button";
    button.dataset.folderType = folder.type;
    button.dataset.folderValue = folder.value;
    button.classList.toggle("active", isFolderActive(folder));

    const name = document.createElement("span");
    name.textContent = folder.label;

    const count = document.createElement("small");
    count.textContent = folder.count;

    button.append(name, count);
    group.append(button);
  }

  return group;
}

function handleFolderClick(event) {
  const button = event.target.closest("[data-folder-type]");
  if (!button) return;

  if (button.dataset.folderType === "category") {
    state.fileManager.category = button.dataset.folderValue || "all";
  }
  if (button.dataset.folderType === "date") {
    state.fileManager.date = button.dataset.folderValue || "all";
  }
  renderFileManager();
}

function isFolderActive(folder) {
  if (folder.type === "category") return state.fileManager.category === folder.value;
  if (folder.type === "date") return state.fileManager.date === folder.value;
  return false;
}

function countFilesByCategory(files, category) {
  return files.filter((item) => getFileCategory(item) === category).length;
}

function getFileManagerTitle() {
  const categoryMap = new Map([
    ["all", "全部文件"],
    ["image", "图片"],
    ["document", "文档"],
    ["other", "其他"]
  ]);
  const parts = [categoryMap.get(state.fileManager.category) || "全部文件"];
  if (state.fileManager.date !== "all") parts.push(formatDateLabel(state.fileManager.date));
  if (state.fileManager.search) parts.push(`搜索：${state.fileManager.search}`);
  return parts.join(" / ");
}

function renderManagedFile(item) {
  const node = document.createElement("article");
  node.className = "item explorer-file";
  node.dataset.id = item.id;

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (item.mimeType?.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.name;
    thumb.append(img);
  }

  const main = document.createElement("div");
  main.className = "item-main";

  const badge = document.createElement("div");
  badge.className = "badge";
  badge.textContent = getFileCategoryLabel(item);

  const filename = document.createElement("p");
  filename.className = "filename";
  filename.textContent = item.name;

  const meta = document.createElement("time");
  meta.textContent = formatSize(item.size);

  const date = document.createElement("time");
  date.className = "file-date";
  date.textContent = formatTime(item.createdAt);

  const actions = document.createElement("div");
  actions.className = "actions";

  const download = document.createElement("a");
  download.dataset.action = "download";
  download.href = item.url;
  download.download = item.name;
  download.textContent = "下载";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.dataset.action = "delete";
  remove.textContent = "删除";

  main.append(badge, filename, meta);
  actions.append(download, remove);
  node.append(thumb, main, date, actions);
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
