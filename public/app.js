const form = document.querySelector("#uploadForm");
const fileInput = document.querySelector("#files");
const folderInput = document.querySelector("#folder");
const dropZone = document.querySelector("#dropZone");
const fileCount = document.querySelector("#fileCount");
const fileList = document.querySelector("#fileList");
const submit = document.querySelector("#submit");
const progress = document.querySelector("#progress");
const statusText = document.querySelector("#status");
const target = document.querySelector("#target");

let selectedFiles = [];

fetch("api/config")
  .then((response) => response.json())
  .then((config) => {
    const warning = config.hashUrlWarning ? " - revisar endpoint real, el # no se envía al servidor" : "";
    if (config.targetMode === "local") {
      target.textContent = `Abre en ${config.publicUrl}. Guarda en carpeta local montada: ${config.uploadDir}`;
      return;
    }

    target.textContent = `Abre en ${config.publicUrl}. Sube por ${config.targetMode.toUpperCase()} -> ${config.targetUrl}${warning}`;
  })
  .catch(() => {
    target.textContent = "No se pudo leer la configuración.";
  });

fileInput.addEventListener("change", () => setFiles([...fileInput.files]));
folderInput.addEventListener("change", () => setFiles([...folderInput.files]));

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", async (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");

  const files = event.dataTransfer.items
    ? await filesFromItems([...event.dataTransfer.items])
    : [...event.dataTransfer.files];

  setFiles(files);
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!selectedFiles.length) return;

  const data = new FormData();
  const relativePaths = selectedFiles.map((file) => file.webkitRelativePath || file.relativePath || file.name);

  selectedFiles.forEach((file) => data.append("files", file, file.name));
  data.set("relativePaths", JSON.stringify(relativePaths));
  data.set("user", document.querySelector("#user").value);
  data.set("pass", document.querySelector("#pass").value);

  submit.disabled = true;
  progress.value = 4;
  statusText.textContent = "Subiendo...";

  const request = new XMLHttpRequest();
  request.open("POST", "api/upload");
  request.upload.addEventListener("progress", (uploadEvent) => {
    if (!uploadEvent.lengthComputable) return;
    progress.value = Math.max(4, Math.round((uploadEvent.loaded / uploadEvent.total) * 100));
  });
  request.addEventListener("load", () => {
    submit.disabled = false;
    progress.value = request.status >= 200 && request.status < 300 ? 100 : 0;

    const payload = parseJson(request.responseText);
    if (request.status >= 200 && request.status < 300) {
      statusText.textContent = `Listo: ${payload.uploaded} archivo(s) subido(s).`;
      renderResults(payload.results || []);
      return;
    }

    statusText.textContent = payload.error || `Error al subir. HTTP ${request.status}`;
    renderResults(payload.results || []);
  });
  request.addEventListener("error", () => {
    submit.disabled = false;
    progress.value = 0;
    statusText.textContent = "No se pudo conectar con el uploader.";
  });
  request.send(data);
});

function setFiles(files) {
  selectedFiles = files.filter((file) => file.size >= 0);
  submit.disabled = selectedFiles.length === 0;
  fileCount.textContent = selectedFiles.length
    ? `${selectedFiles.length} archivo(s) seleccionados`
    : "Sin archivos seleccionados";
  renderFileList(selectedFiles);
}

function renderFileList(files) {
  fileList.innerHTML = "";
  files.slice(0, 200).forEach((file) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const size = document.createElement("span");

    name.textContent = file.webkitRelativePath || file.relativePath || file.name;
    size.textContent = formatBytes(file.size);
    item.append(name, size);
    fileList.append(item);
  });
}

function renderResults(results) {
  fileList.innerHTML = "";
  results.forEach((result) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    const state = document.createElement("span");

    name.textContent = result.path;
    state.textContent = result.ok
      ? `OK${result.savedTo ? ` -> ${result.savedTo}` : ""}`
      : `Error ${result.status || ""}`;
    item.append(name, state);
    fileList.append(item);
  });
}

async function filesFromItems(items) {
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);

  const files = [];
  for (const entry of entries) {
    files.push(...(await readEntry(entry)));
  }
  return files;
}

async function readEntry(entry, prefix = "") {
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    file.relativePath = `${prefix}${file.name}`;
    return [file];
  }

  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const children = await readAllDirectoryEntries(reader);
  const nested = await Promise.all(children.map((child) => readEntry(child, `${prefix}${entry.name}/`)));
  return nested.flat();
}

async function readAllDirectoryEntries(reader) {
  const entries = [];
  let batch = [];

  do {
    batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    entries.push(...batch);
  } while (batch.length);

  return entries;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
