const input = document.getElementById("file-input");
const gallery = document.getElementById("gallery");
const template = document.getElementById("page-card-template");
const dpiSelect = document.getElementById("dpi-select");
const FRAME_HEIGHT = 560;

const pdfjs = globalThis.pdfjsLib;
if (pdfjs) {
  pdfjs.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.5.136/build/pdf.worker.min.mjs";
}

const state = {
  dpi: Number(dpiSelect.value),
  files: [],
  objectUrls: [],
};

renderEmptyState();

input.addEventListener("change", async (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  state.files = files;
  await renderFiles(state.files);
  input.value = "";
});

dpiSelect.addEventListener("change", async () => {
  state.dpi = Number(dpiSelect.value);
  if (!state.files.length) return;
  await renderFiles(state.files);
});

function isImage(file) {
  return file.type.startsWith("image/");
}

function isPdf(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function renderFiles(files) {
  clearGallery();

  for (const file of files) {
    if (isImage(file)) {
      addImageCard(file);
      continue;
    }

    if (isPdf(file)) {
      await addPdfCards(file);
    }
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
  frame.style.height = `${FRAME_HEIGHT}px`;

  gallery.appendChild(card);
  return frame;
}

function addImageCard(file) {
  const url = URL.createObjectURL(file);
  state.objectUrls.push(url);
  const frame = createCard(file.name, "Image");
  const img = document.createElement("img");
  img.alt = file.name;
  img.src = url;
  frame.appendChild(img);
}

async function addPdfCards(file) {
  if (!pdfjs) {
    const frame = createCard(file.name, "PDF");
    frame.innerHTML = "<p class='placeholder'>PDF viewer failed to load.</p>";
    return;
  }

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const qualityFactor = state.dpi / 100;

  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const viewport = page.getViewport({ scale: 1 });
    const scale = Math.min(
      (gallery.clientWidth - 80) / viewport.width,
      FRAME_HEIGHT / viewport.height,
    );
    const finalScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const renderViewport = page.getViewport({ scale: finalScale * qualityFactor });

    const frame = createCard(
      file.name,
      `Page ${index} / ${doc.numPages} - ${state.dpi} p`,
    );
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);

    await page.render({
      canvasContext: context,
      viewport: renderViewport,
    }).promise;

    frame.appendChild(canvas);
  }
}

function clearGallery() {
  gallery.replaceChildren();

  for (const url of state.objectUrls) {
    URL.revokeObjectURL(url);
  }
  state.objectUrls = [];
}

function renderEmptyState() {
  const placeholder = document.createElement("div");
  placeholder.className = "placeholder";
  placeholder.textContent =
    "No files loaded yet. Use Choose files to upload PDFs or images.";
  gallery.replaceChildren(placeholder);
}
