import {
  applyImageAnnotations,
  isPdfBytes,
  isPdfFile,
  loadPdfDocument,
  mergePdfs,
  readFileAsArrayBuffer,
  renderPageToCanvas,
  reorderPdf
} from "./pdfService.js";
import { loadLastPdf, saveLastPdf } from "./storage.js";

const state = {
  originalBytes: null,
  currentBytes: null,
  pdfDoc: null,
  pageCount: 0,
  currentPage: 1,
  pageOrder: [],
  imageAssets: [],
  imageAnnotations: []
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

function createId(prefix) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getImageDimensions(objectUrl) {
  if (typeof Image === "undefined") {
    return Promise.resolve({ width: 200, height: 200 });
  }
  return new Promise((resolve) => {
    const img = new Image();
    const fallback = setTimeout(() => {
      resolve({ width: 200, height: 200 });
    }, 300);
    img.onload = () => {
      clearTimeout(fallback);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      clearTimeout(fallback);
      resolve({ width: 200, height: 200 });
    };
    img.src = objectUrl;
  });
}

function updatePageLabel(pageLabel) {
  if (!state.pageCount) {
    pageLabel.textContent = "No PDF loaded";
    return;
  }
  pageLabel.textContent = `Page ${state.currentPage} of ${state.pageCount}`;
}

async function refreshViewer(canvas, overlay, pageLabel, statusEl) {
  if (!state.pdfDoc || !state.pageCount) {
    return;
  }
  try {
    await renderPageToCanvas(state.pdfDoc, state.currentPage, canvas);
    updatePageLabel(pageLabel);
    renderAnnotations(overlay, statusEl);
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

function renderAssetList(assetList, statusEl) {
  assetList.innerHTML = "";
  if (state.imageAssets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No images yet. Upload a PNG or JPEG.";
    assetList.append(empty);
    return;
  }

  state.imageAssets.forEach((asset) => {
    const item = document.createElement("div");
    item.className = "asset-item";
    item.draggable = true;
    item.dataset.assetId = asset.id;

    const preview = document.createElement("img");
    preview.src = asset.previewUrl;
    preview.alt = asset.name;

    const label = document.createElement("span");
    label.textContent = asset.name;

    item.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) {
        setStatus(statusEl, "Drag-and-drop is not available here.", true);
        return;
      }
      event.dataTransfer.setData("text/plain", asset.id);
    });

    item.append(preview, label);
    assetList.append(item);
  });
}

function renderAnnotations(overlay, statusEl) {
  overlay.innerHTML = "";
  if (!state.imageAnnotations.length) {
    return;
  }
  const current = state.imageAnnotations.filter(
    (annotation) => annotation.pageNumber === state.currentPage
  );
  current.forEach((annotation) => {
    const asset = state.imageAssets.find((item) => item.id === annotation.assetId);
    if (!asset) {
      return;
    }
    const el = document.createElement("div");
    el.className = "annotation";
    el.tabIndex = 0;
    el.style.left = `${annotation.x}px`;
    el.style.top = `${annotation.y}px`;
    el.style.width = `${annotation.width}px`;
    el.style.height = `${annotation.height}px`;
    el.style.backgroundImage = `url(${asset.previewUrl})`;
    el.dataset.annotationId = annotation.id;

    const handle = document.createElement("div");
    handle.className = "resize-handle";
    el.append(handle);

    attachAnnotationInteractions(el, annotation, overlay, statusEl);
    overlay.append(el);
  });
}

function attachAnnotationInteractions(element, annotation, overlay, statusEl) {
  const getBounds = () => {
    const rect = overlay.getBoundingClientRect();
    return {
      width: rect.width || overlay.offsetWidth,
      height: rect.height || overlay.offsetHeight
    };
  };

  const startMove = (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = annotation.x;
    const originY = annotation.y;
    const bounds = getBounds();

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      annotation.x = clamp(originX + dx, 0, bounds.width - annotation.width);
      annotation.y = clamp(originY + dy, 0, bounds.height - annotation.height);
      element.style.left = `${annotation.x}px`;
      element.style.top = `${annotation.y}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startResize = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const originWidth = annotation.width;
    const originHeight = annotation.height;
    const bounds = getBounds();

    const onMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const nextWidth = clamp(originWidth + dx, 24, bounds.width - annotation.x);
      const nextHeight = clamp(originHeight + dy, 24, bounds.height - annotation.y);
      annotation.width = nextWidth;
      annotation.height = nextHeight;
      element.style.width = `${annotation.width}px`;
      element.style.height = `${annotation.height}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  element.addEventListener("pointerdown", (event) => {
    if (event.target.classList.contains("resize-handle")) {
      startResize(event);
      return;
    }
    startMove(event);
  });

  element.addEventListener("keydown", (event) => {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }
    state.imageAnnotations = state.imageAnnotations.filter(
      (item) => item.id !== annotation.id
    );
    element.remove();
    setStatus(statusEl, "Image removed.");
  });
}

function toUint8(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

async function loadPdfBytes(
  bytes,
  statusEl,
  canvas,
  overlay,
  pageLabel,
  pageList,
  applyButton
) {
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
  state.imageAnnotations = [];
  state.imageAssets = [];
  renderPageList(pageList, applyButton);
  updatePageLabel(pageLabel);
  await refreshViewer(canvas, overlay, pageLabel, statusEl);
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

  const rememberWrap = document.createElement("label");
  rememberWrap.className = "remember";
  const rememberToggle = document.createElement("input");
  rememberToggle.type = "checkbox";
  const rememberText = document.createElement("span");
  rememberText.textContent = "Remember last session locally";
  rememberWrap.append(rememberToggle, rememberText);

  const restoreButton = createButton("Restore Last Session", async () => {
    try {
      const stored = await loadLastPdf();
      if (!stored) {
        setStatus(status, "No saved session found.", true);
        return;
      }
      await loadPdfBytes(
        stored,
        status,
        canvas,
        overlay,
        pageLabel,
        pageList,
        applyReorderButton
      );
      setStatus(status, "Restored last session.");
    } catch (error) {
      setStatus(status, `Failed to restore session: ${error.message}`, true);
    }
  });

  const loadGroup = document.createElement("section");
  loadGroup.className = "panel";
  const loadLabel = document.createElement("label");
  loadLabel.textContent = "Load a PDF";
  const loadInput = document.createElement("input");
  loadInput.type = "file";
  loadInput.accept = "application/pdf";
  loadInput.dataset.role = "pdf-load";
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
      await loadPdfBytes(
        bytes,
        status,
        canvas,
        overlay,
        pageLabel,
        pageList,
        applyReorderButton
      );
      if (rememberToggle.checked) {
        await saveLastPdf(state.currentBytes.slice());
      }
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
  mergeInput.dataset.role = "pdf-merge";
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
      await loadPdfBytes(
        mergedBytes,
        status,
        canvas,
        overlay,
        pageLabel,
        pageList,
        applyReorderButton
      );
      setStatus(status, "PDFs merged successfully.");
      if (rememberToggle.checked) {
        await saveLastPdf(state.currentBytes.slice());
      }
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

  const overlay = document.createElement("div");
  overlay.className = "page-overlay";
  overlay.dataset.role = "page-overlay";
  overlay.addEventListener("dragover", (event) => {
    event.preventDefault();
    overlay.classList.add("drag-over");
  });
  overlay.addEventListener("dragleave", () => {
    overlay.classList.remove("drag-over");
  });

  overlay.addEventListener("drop", (event) => {
    event.preventDefault();
    overlay.classList.remove("drag-over");
    if (!state.currentBytes) {
      setStatus(status, "Load a PDF before placing images.", true);
      return;
    }
    const assetId = event.dataTransfer?.getData("text/plain");
    if (!assetId) {
      setStatus(status, "Drop an image from the asset pane.", true);
      return;
    }
    const asset = state.imageAssets.find((item) => item.id === assetId);
    if (!asset) {
      setStatus(status, "Image asset not found.", true);
      return;
    }

    const rect = overlay.getBoundingClientRect();
    const overlayWidth = rect.width || overlay.offsetWidth;
    const overlayHeight = rect.height || overlay.offsetHeight;
    if (!overlayWidth || !overlayHeight) {
      setStatus(status, "Overlay not ready yet. Try again.", true);
      return;
    }

    const maxWidth = overlayWidth * 0.3;
    const scale = Math.min(maxWidth / asset.naturalWidth, 1);
    const width = asset.naturalWidth * scale;
    const height = asset.naturalHeight * scale;
    const dropX = event.clientX - rect.left - width / 2;
    const dropY = event.clientY - rect.top - height / 2;
    const x = clamp(dropX, 0, overlayWidth - width);
    const y = clamp(dropY, 0, overlayHeight - height);

    const annotation = {
      id: createId("annotation"),
      assetId,
      pageNumber: state.currentPage,
      x,
      y,
      width,
      height,
      overlayWidth,
      overlayHeight
    };
    state.imageAnnotations = [...state.imageAnnotations, annotation];
    renderAnnotations(overlay, status);
    setStatus(status, "Image placed on page.");
  });

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  canvasWrap.append(canvas, overlay);

  const nav = document.createElement("div");
  nav.className = "nav";
  const prevButton = createButton("Previous", async () => {
    if (state.currentPage > 1) {
      state.currentPage -= 1;
      await refreshViewer(canvas, overlay, pageLabel, status);
    }
  });
  const nextButton = createButton("Next", async () => {
    if (state.currentPage < state.pageCount) {
      state.currentPage += 1;
      await refreshViewer(canvas, overlay, pageLabel, status);
    }
  });
  nav.append(prevButton, nextButton);

  viewerGroup.append(pageLabel, canvasWrap, nav);

  const assetGroup = document.createElement("section");
  assetGroup.className = "panel";
  const assetTitle = document.createElement("p");
  assetTitle.className = "section-title";
  assetTitle.textContent = "Image Assets";
  const assetInput = document.createElement("input");
  assetInput.type = "file";
  assetInput.accept = "image/png,image/jpeg";
  assetInput.multiple = true;
  assetInput.dataset.role = "image-assets";
  const assetList = document.createElement("div");
  assetList.className = "asset-list";

  assetInput.addEventListener("change", async () => {
    const files = Array.from(assetInput.files ?? []);
    if (!files.length) {
      return;
    }
    try {
      for (const file of files) {
        const bytes = await readFileAsArrayBuffer(file);
        let previewUrl = "";
        if (typeof URL !== "undefined" && URL.createObjectURL) {
          try {
            previewUrl = URL.createObjectURL(file);
          } catch {
            previewUrl = "";
          }
        }
        const { width, height } = previewUrl
          ? await getImageDimensions(previewUrl)
          : { width: 200, height: 200 };
        state.imageAssets = [
          ...state.imageAssets,
          {
            id: createId("asset"),
            name: file.name,
            imageData: new Uint8Array(bytes),
            naturalWidth: width,
            naturalHeight: height,
            previewUrl
          }
        ];
      }
      renderAssetList(assetList, status);
      assetInput.value = "";
      setStatus(status, "Image assets ready. Drag onto the page.");
    } catch (error) {
      setStatus(status, `Failed to add image: ${error.message}`, true);
    }
  });

  renderAssetList(assetList, status);
  assetGroup.append(assetTitle, assetInput, assetList);

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
      const currentAssets = state.imageAssets;
      const currentAnnotations = state.imageAnnotations;
      const pageMapping = new Map();
      state.pageOrder.forEach((oldPageNumber, index) => {
        pageMapping.set(oldPageNumber, index + 1);
      });
      const remappedAnnotations = currentAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const reorderedBytes = await reorderPdf(state.currentBytes, state.pageOrder);
      await loadPdfBytes(
        reorderedBytes,
        status,
        canvas,
        overlay,
        pageLabel,
        pageList,
        applyReorderButton
      );
      state.imageAssets = currentAssets;
      state.imageAnnotations = remappedAnnotations;
      renderAssetList(assetList, status);
      renderAnnotations(overlay, status);
      setStatus(status, "Reorder applied.");
      if (rememberToggle.checked) {
        await saveLastPdf(state.currentBytes.slice());
      }
    } catch (error) {
      setStatus(status, `Failed to reorder pages: ${error.message}`, true);
    }
  }, "primary");

  reorderGroup.append(reorderTitle, pageList, applyReorderButton);

  const exportGroup = document.createElement("section");
  exportGroup.className = "panel";
  const exportTitle = document.createElement("p");
  exportTitle.className = "section-title";
  exportTitle.textContent = "Export";
  const exportButton = createButton("Download PDF", async () => {
    if (!state.currentBytes) {
      setStatus(status, "Load a PDF before exporting.", true);
      return;
    }
    try {
      const exportBytes =
        state.imageAnnotations.length > 0
          ? await applyImageAnnotations(
              state.currentBytes,
              state.imageAssets,
              state.imageAnnotations
            )
          : state.currentBytes;
      const blob = new Blob([exportBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "edited.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus(status, "Export started.");
    } catch (error) {
      setStatus(status, `Export failed: ${error.message}`, true);
    }
  }, "primary");
  exportGroup.append(exportTitle, exportButton);

  const workspace = document.createElement("div");
  workspace.className = "workspace";
  workspace.append(assetGroup, viewerGroup);

  container.append(
    title,
    subtitle,
    status,
    rememberWrap,
    restoreButton,
    loadGroup,
    mergeGroup,
    workspace,
    reorderGroup,
    exportGroup
  );
  root.append(container);
}
