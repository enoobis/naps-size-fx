const input = document.getElementById("file-input");
const gallery = document.getElementById("gallery");
const template = document.getElementById("page-card-template");
const dpiSelect = document.getElementById("dpi-select");
const downloadBtn = document.getElementById("download-btn");
const previewToggle = document.getElementById("preview-toggle");
const PREVIEW_SIZE = 240;

const pdfjs = globalThis.pdfjsLib;
if (pdfjs) {
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.mjs";
}

const state = {
  p: Number(dpiSelect.value),
  showPreview: previewToggle.checked,
  files: [],
  hasSupportedFiles: false,
  isBuildingDownload: false,
  previewObjectUrls: [],
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

previewToggle.addEventListener("change", async () => {
  state.showPreview = previewToggle.checked;
  if (!state.files.length) return;
  await renderFiles(state.files);
});

downloadBtn.addEventListener("click", async () => {
  if (!state.hasSupportedFiles || state.isBuildingDownload) return;

  state.isBuildingDownload = true;
  updateDownloadButton();

  try {
    const outputs = await buildDownloadOutputs(state.files);
    if (!outputs.length) return;

    if (outputs.length === 1) {
      triggerDownload(outputs[0].blob, outputs[0].name);
      return;
    }

    if (!globalThis.JSZip) {
      // Fallback: if zip lib fails, download files one by one.
      outputs.forEach((item) => triggerDownload(item.blob, item.name));
      return;
    }

    const zip = new globalThis.JSZip();
    outputs.forEach((item) => {
      zip.file(item.name, item.blob);
    });

    const zipBlob = await zip.generateAsync({ type: "blob" });
    triggerDownload(zipBlob, `processed-${state.p}p.zip`);
  } finally {
    state.isBuildingDownload = false;
    updateDownloadButton();
  }
});

function isImage(file) {
  return file.type.startsWith("image/");
}

function isPdf(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function renderFiles(files) {
  clearGallery();
  state.hasSupportedFiles = false;

  for (const file of files) {
    if (isImage(file)) {
      state.hasSupportedFiles = true;
      if (state.showPreview) {
        addImagePreview(file);
      }
      continue;
    }

    if (isPdf(file)) {
      state.hasSupportedFiles = true;
      if (state.showPreview) {
        await addPdfPreview(file);
      }
    }
  }

  if (!state.hasSupportedFiles) {
    renderEmptyState("no supported files");
  } else if (!state.showPreview) {
    renderEmptyState("preview off");
  }
  updateDownloadButton();
}

function addImagePreview(file) {
  const frame = createCard(file.name, "preview", PREVIEW_SIZE);
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  state.previewObjectUrls.push(url);
  img.src = url;
  img.alt = file.name;
  img.loading = "lazy";
  frame.appendChild(img);
}

async function addPdfPreview(file) {
  if (!pdfjs) {
    const frame = createCard(file.name, "pdf");
    frame.innerHTML = "<p class='placeholder'>pdf viewer failed to load</p>";
    return;
  }

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const previewScale = Math.min(
      PREVIEW_SIZE / baseViewport.width,
      PREVIEW_SIZE / baseViewport.height,
    );
    const previewViewport = page.getViewport({ scale: Math.max(0.2, previewScale) });

    const frame = createCard(file.name, `preview ${pageNumber}/${doc.numPages}`, PREVIEW_SIZE);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(previewViewport.width));
    canvas.height = Math.max(1, Math.floor(previewViewport.height));
    frame.appendChild(canvas);

    const context = canvas.getContext("2d", { alpha: false });
    await page.render({
      canvasContext: context,
      viewport: previewViewport,
    }).promise;
  }

  doc.cleanup();
}

function createCard(fileName, meta, frameSize = state.p) {
  const node = template.content.cloneNode(true);
  const card = node.querySelector(".card");
  const name = node.querySelector(".file-name");
  const fileMeta = node.querySelector(".file-meta");
  const frame = node.querySelector(".page-frame");

  name.textContent = fileName;
  fileMeta.textContent = meta;
  frame.style.height = `${frameSize}px`;

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

async function buildDownloadOutputs(files) {
  const outputs = [];

  for (const file of files) {
    if (isImage(file)) {
      const blob = await processImageToBlob(file, state.p);
      if (!blob) continue;
      const safeName = getSafeFileName(file.name, "image", ".png");
      outputs.push({
        name: `${safeName}-${state.p}p.png`,
        blob,
      });
      continue;
    }

    if (isPdf(file)) {
      const pdfOutputs = await processPdfToBlobs(file, state.p);
      outputs.push(...pdfOutputs);
    }
  }

  return outputs;
}

async function processImageToBlob(file, size) {
  const bitmap = await createImageBitmap(file);
  const output = createFittedCanvas(bitmap, size);
  return canvasToBlob(output);
}

async function processPdfToBlobs(file, size) {
  if (!pdfjs) return [];

  const outputs = [];
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const baseName = getSafeFileName(file.name, "document", "");

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderScale = Math.min(size / baseViewport.width, size / baseViewport.height);
    const renderViewport = page.getViewport({ scale: Math.max(0.2, renderScale) });

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = Math.max(1, Math.floor(renderViewport.width));
    sourceCanvas.height = Math.max(1, Math.floor(renderViewport.height));
    const sourceContext = sourceCanvas.getContext("2d", { alpha: false });

    await page.render({
      canvasContext: sourceContext,
      viewport: renderViewport,
    }).promise;

    const outputCanvas = createFittedCanvas(sourceCanvas, size);
    const blob = await canvasToBlob(outputCanvas);
    if (!blob) continue;

    outputs.push({
      name: `${baseName}-page-${pageNumber}-${size}p.png`,
      blob,
    });
  }

  doc.cleanup();
  return outputs;
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
  state.previewObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.previewObjectUrls = [];
}

function updateDownloadButton() {
  downloadBtn.disabled = !state.hasSupportedFiles || state.isBuildingDownload;
  downloadBtn.textContent = state.isBuildingDownload ? "building..." : "download";
}

function renderEmptyState(message = "no files loaded yet") {
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.textContent = message;
  gallery.replaceChildren(placeholder);
}
