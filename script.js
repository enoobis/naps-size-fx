const input = document.getElementById("file-input");
const gallery = document.getElementById("gallery");
const template = document.getElementById("page-card-template");
const dpiSelect = document.getElementById("dpi-select");
const downloadBtn = document.getElementById("download-btn");

const pdfjs = globalThis.pdfjsLib;
if (pdfjs) {
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.mjs";
}

const state = {
  p: Number(dpiSelect.value),
  files: [],
  downloads: [],
};

renderEmptyState();

input.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  state.files = files;
  await renderFiles(files);
  input.value = "";
});

dpiSelect.addEventListener("change", async () => {
  state.p = Number(dpiSelect.value);
  if (!state.files.length) return;
  await renderFiles(state.files);
});

downloadBtn.addEventListener("click", async () => {
  if (!state.downloads.length) return;

  if (state.downloads.length === 1) {
    const single = state.downloads[0];
    triggerDownload(single.blob, single.name);
    return;
  }

  if (!globalThis.JSZip) {
    // Fallback: if zip lib fails, download files one by one.
    state.downloads.forEach((item) => triggerDownload(item.blob, item.name));
    return;
  }

  downloadBtn.disabled = true;
  downloadBtn.textContent = "building...";

  const zip = new globalThis.JSZip();
  state.downloads.forEach((item) => {
    zip.file(item.name, item.blob);
  });

  const zipBlob = await zip.generateAsync({ type: "blob" });
  triggerDownload(zipBlob, `processed-${state.p}p.zip`);

  downloadBtn.textContent = "download";
  downloadBtn.disabled = false;
});

function isImage(file) {
  return file.type.startsWith("image/");
}

function isPdf(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function renderFiles(files) {
  clearGallery();
  setDownloadEnabled(false);

  for (const file of files) {
    if (isImage(file)) {
      await addProcessedImage(file);
      continue;
    }

    if (isPdf(file)) {
      await addProcessedPdf(file);
    }
  }

  if (!state.downloads.length) {
    renderEmptyState("no supported files");
    return;
  }

  setDownloadEnabled(true);
}

async function addProcessedImage(file) {
  const bitmap = await createImageBitmap(file);
  const output = createFittedCanvas(bitmap, state.p);
  const frame = createCard(file.name, `${state.p} x ${state.p}`);
  frame.appendChild(output);

  const blob = await canvasToBlob(output);
  if (!blob) return;

  const safeName = getSafeFileName(file.name, "image", ".png");
  state.downloads.push({
    name: `${safeName}-${state.p}p.png`,
    blob,
  });
}

async function addProcessedPdf(file) {
  if (!pdfjs) {
    const frame = createCard(file.name, "pdf");
    frame.innerHTML = "<p class='placeholder'>pdf viewer failed to load</p>";
    return;
  }

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const baseName = getSafeFileName(file.name, "document", "");

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = Math.max(1, Math.floor(viewport.width));
    sourceCanvas.height = Math.max(1, Math.floor(viewport.height));
    const sourceContext = sourceCanvas.getContext("2d", { alpha: false });

    await page.render({
      canvasContext: sourceContext,
      viewport,
    }).promise;

    const output = createFittedCanvas(sourceCanvas, state.p);
    const frame = createCard(file.name, `page ${pageNumber} - ${state.p} x ${state.p}`);
    frame.appendChild(output);

    const blob = await canvasToBlob(output);
    if (!blob) continue;

    state.downloads.push({
      name: `${baseName}-page-${pageNumber}-${state.p}p.png`,
      blob,
    });
  }
}

function createCard(fileName, meta) {
  const node = template.content.cloneNode(true);
  const card = node.querySelector(".card");
  const name = node.querySelector(".file-name");
  const fileMeta = node.querySelector(".file-meta");
  const frame = node.querySelector(".page-frame");

  name.textContent = fileName;
  fileMeta.textContent = meta;
  frame.style.height = `${state.p}px`;

  gallery.appendChild(card);
  return frame;
}

function createFittedCanvas(source, size) {
  const sourceWidth = source.width || source.videoWidth || source.naturalWidth || 1;
  const sourceHeight = source.height || source.videoHeight || source.naturalHeight || 1;

  const output = document.createElement("canvas");
  output.width = size;
  output.height = size;

  const ctx = output.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  const scale = Math.min(size / sourceWidth, size / sourceHeight);
  const targetWidth = Math.max(1, Math.floor(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.floor(sourceHeight * scale));
  const offsetX = Math.floor((size - targetWidth) / 2);
  const offsetY = Math.floor((size - targetHeight) / 2);

  ctx.drawImage(source, offsetX, offsetY, targetWidth, targetHeight);
  return output;
}

async function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png", 0.95);
  });
}

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getSafeFileName(inputName, fallback, forcedExtension) {
  const clean = inputName.replace(/[\\/:*?"<>|]/g, "-");
  const lastDot = clean.lastIndexOf(".");
  const base = lastDot > 0 ? clean.slice(0, lastDot) : clean || fallback;
  return forcedExtension ? `${base}${forcedExtension}` : base;
}

function clearGallery() {
  gallery.replaceChildren();
  state.downloads = [];
}

function setDownloadEnabled(enabled) {
  downloadBtn.disabled = !enabled;
}

function renderEmptyState(message = "no files loaded yet") {
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.textContent = message;
  gallery.replaceChildren(placeholder);
}
