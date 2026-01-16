import {
  isPdfBytes,
  isPdfFile,
  loadPdfDocument,
  mergePdfs,
  readFileAsArrayBuffer,
  renderPageToCanvas,
  reorderPdf
} from "./pdfService.js";

const state = {
  originalBytes: null,
  currentBytes: null,
  pdfDoc: null,
  pageCount: 0,
  currentPage: 1,
  pageOrder: []
};

function createButton(label, onClick, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) {
    button.className = className;
  }
  button.addEventListener("click", onClick);
  return button;
}

function setStatus(statusEl, message, isError = false) {
  statusEl.textContent = message;
  statusEl.dataset.error = isError ? "true" : "false";
}

function updatePageLabel(pageLabel) {
  if (!state.pageCount) {
    pageLabel.textContent = "No PDF loaded";
    return;
  }
  pageLabel.textContent = `Page ${state.currentPage} of ${state.pageCount}`;
}

async function refreshViewer(canvas, pageLabel, statusEl) {
  if (!state.pdfDoc || !state.pageCount) {
    return;
  }
  try {
    await renderPageToCanvas(state.pdfDoc, state.currentPage, canvas);
    updatePageLabel(pageLabel);
  } catch (error) {
    setStatus(statusEl, `Render failed: ${error.message}`, true);
  }
}

function renderPageList(listEl, applyButton) {
  listEl.innerHTML = "";
  applyButton.disabled = state.pageOrder.length === 0;

  state.pageOrder.forEach((pageNumber, index) => {
    const item = document.createElement("li");
    item.className = "page-item";

    const label = document.createElement("span");
    label.textContent = `Page ${pageNumber}`;

    const moveUp = createButton("Up", () => {
      if (index === 0) {
        return;
      }
      const newOrder = [...state.pageOrder];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      state.pageOrder = newOrder;
      renderPageList(listEl, applyButton);
    });

    const moveDown = createButton("Down", () => {
      if (index === state.pageOrder.length - 1) {
        return;
      }
      const newOrder = [...state.pageOrder];
      [newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
      state.pageOrder = newOrder;
      renderPageList(listEl, applyButton);
    });

    item.append(label, moveUp, moveDown);
    listEl.append(item);
  });
}

function toUint8(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

async function loadPdfBytes(bytes, statusEl, canvas, pageLabel, pageList, applyButton) {
  const normalized = toUint8(bytes);
  if (!isPdfBytes(normalized)) {
    setStatus(statusEl, "Selected file is not a valid PDF.", true);
    return;
  }
  const renderBytes = normalized.slice();
  const workingBytes = normalized.slice();
  const pdfDoc = await loadPdfDocument(renderBytes);
  state.originalBytes = workingBytes.slice();
  state.currentBytes = workingBytes;
  state.pdfDoc = pdfDoc;
  state.pageCount = pdfDoc.numPages;
  state.currentPage = 1;
  state.pageOrder = Array.from({ length: state.pageCount }, (_, index) => index + 1);
  renderPageList(pageList, applyButton);
  updatePageLabel(pageLabel);
  await refreshViewer(canvas, pageLabel, statusEl);
  setStatus(statusEl, "PDF loaded successfully.");
}

export function initApp(root) {
  if (!root) {
    throw new Error("App root element not found");
  }

  const container = document.createElement("div");
  container.className = "app-shell";

  const title = document.createElement("h1");
  title.textContent = "Cloud PDF Editor";

  const subtitle = document.createElement("p");
  subtitle.className = "app-subtitle";
  subtitle.textContent = "Local-first PDF editing. Files never leave your device.";

  const status = document.createElement("p");
  status.className = "status";
  status.textContent = "Load a PDF to begin.";

  const loadGroup = document.createElement("section");
  loadGroup.className = "panel";
  const loadLabel = document.createElement("label");
  loadLabel.textContent = "Load a PDF";
  const loadInput = document.createElement("input");
  loadInput.type = "file";
  loadInput.accept = "application/pdf";
  const loadButton = createButton("Load PDF", async () => {
    const file = loadInput.files?.[0];
    if (!file) {
      setStatus(status, "Choose a PDF file to load.", true);
      return;
    }
    if (!isPdfFile(file)) {
      setStatus(status, "Only PDF files are supported.", true);
      return;
    }
    try {
      const bytes = await readFileAsArrayBuffer(file);
      await loadPdfBytes(bytes, status, canvas, pageLabel, pageList, applyReorderButton);
    } catch (error) {
      setStatus(status, `Failed to load PDF: ${error.message}`, true);
    }
  });
  loadGroup.append(loadLabel, loadInput, loadButton);

  const mergeGroup = document.createElement("section");
  mergeGroup.className = "panel";
  const mergeLabel = document.createElement("label");
  mergeLabel.textContent = "Merge PDFs";
  const mergeInput = document.createElement("input");
  mergeInput.type = "file";
  mergeInput.accept = "application/pdf";
  mergeInput.multiple = true;
  const mergeButton = createButton("Merge Selected PDFs", async () => {
    const files = Array.from(mergeInput.files ?? []);
    if (files.length < 2) {
      setStatus(status, "Select at least two PDF files to merge.", true);
      return;
    }
    try {
      const buffers = [];
      for (const file of files) {
        if (!isPdfFile(file)) {
          setStatus(status, "All files must be PDFs.", true);
          return;
        }
        buffers.push(await readFileAsArrayBuffer(file));
      }
      const mergedBytes = await mergePdfs(buffers);
      await loadPdfBytes(mergedBytes, status, canvas, pageLabel, pageList, applyReorderButton);
      setStatus(status, "PDFs merged successfully.");
    } catch (error) {
      setStatus(status, `Failed to merge PDFs: ${error.message}`, true);
    }
  });
  mergeGroup.append(mergeLabel, mergeInput, mergeButton);

  const viewerGroup = document.createElement("section");
  viewerGroup.className = "panel viewer";
  const pageLabel = document.createElement("p");
  pageLabel.className = "page-label";
  pageLabel.textContent = "No PDF loaded";

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-canvas";

  const nav = document.createElement("div");
  nav.className = "nav";
  const prevButton = createButton("Previous", async () => {
    if (state.currentPage > 1) {
      state.currentPage -= 1;
      await refreshViewer(canvas, pageLabel, status);
    }
  });
  const nextButton = createButton("Next", async () => {
    if (state.currentPage < state.pageCount) {
      state.currentPage += 1;
      await refreshViewer(canvas, pageLabel, status);
    }
  });
  nav.append(prevButton, nextButton);

  viewerGroup.append(pageLabel, canvas, nav);

  const reorderGroup = document.createElement("section");
  reorderGroup.className = "panel";
  const reorderTitle = document.createElement("p");
  reorderTitle.className = "section-title";
  reorderTitle.textContent = "Reorder Pages";

  const pageList = document.createElement("ul");
  pageList.className = "page-list";

  const applyReorderButton = createButton("Apply Reorder", async () => {
    if (!state.currentBytes || state.pageOrder.length === 0) {
      setStatus(status, "Load a PDF before reordering pages.", true);
      return;
    }
    try {
      const reorderedBytes = await reorderPdf(state.currentBytes, state.pageOrder);
      await loadPdfBytes(reorderedBytes, status, canvas, pageLabel, pageList, applyReorderButton);
      setStatus(status, "Reorder applied.");
    } catch (error) {
      setStatus(status, `Failed to reorder pages: ${error.message}`, true);
    }
  }, "primary");

  reorderGroup.append(reorderTitle, pageList, applyReorderButton);

  container.append(title, subtitle, status, loadGroup, mergeGroup, viewerGroup, reorderGroup);
  root.append(container);
}
