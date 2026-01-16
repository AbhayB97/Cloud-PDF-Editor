import {
  applyDrawAnnotations,
  applyHighlightAnnotations,
  applyImageAnnotations,
  applyTextAnnotations,
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
  imageAnnotations: [],
  textAnnotations: [],
  activeTool: "select",
  selectedTextId: null,
  textDefaults: {
    fontSize: 12,
    fontFamily: "Helvetica",
    color: "#111111",
    bold: false,
    italic: false,
    underline: false
  },
  installPromptEvent: null,
  panePositions: {},
  paneOpen: {},
  paneCollapsed: {},
  drawAnnotations: [],
  highlightAnnotations: [],
  selectedTextElement: null,
  toolDefaults: {
    draw: { color: "#2563eb", size: 4 },
    highlight: { color: "#f59e0b", opacity: 0.35 },
    comment: { color: "#111111" },
    stamp: { text: "APPROVED", color: "#111111" },
    mark: { color: "#b91c1c" },
    signature: { name: "" }
  }
};

const TOOL_DEFS = [
  { id: "select", label: "Select" },
  { id: "text", label: "Text" },
  { id: "draw", label: "Draw" },
  { id: "highlight", label: "Highlight" },
  { id: "comment", label: "Comment" },
  { id: "stamp", label: "Stamp" },
  { id: "mark", label: "Mark" },
  { id: "image", label: "Image" },
  { id: "signature", label: "Signature" }
];

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

function getOverlayBounds(overlay) {
  const rect = overlay.getBoundingClientRect();
  return {
    width: rect.width || overlay.offsetWidth,
    height: rect.height || overlay.offsetHeight
  };
}

function createLabeledField(labelText, inputEl) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const label = document.createElement("span");
  label.textContent = labelText;
  wrap.append(label, inputEl);
  return wrap;
}

function getOverlayPoint(event, overlay) {
  const rect = overlay.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function normalizeColor(color, opacity = 1) {
  if (!color) {
    return `rgba(0,0,0,${opacity})`;
  }
  if (color.startsWith("rgba")) {
    return color;
  }
  if (color.startsWith("rgb")) {
    return color.replace("rgb(", "rgba(").replace(")", `,${opacity})`);
  }
  const hex = color.startsWith("#") ? color.slice(1) : color;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) {
    return `rgba(0,0,0,${opacity})`;
  }
  return `rgba(${r},${g},${b},${opacity})`;
}

function serializeTextSpans(contentEl, defaults) {
  const spans = [];
  const pushSpan = (text, styles) => {
    if (!text) {
      return;
    }
    spans.push({
      text,
      bold: styles.bold,
      italic: styles.italic,
      underline: styles.underline,
      fontSize: styles.fontSize,
      color: styles.color
    });
  };

  const walk = (node, currentStyle) => {
    if (node.nodeType === Node.TEXT_NODE) {
      pushSpan(node.textContent, currentStyle);
      return;
    }
    if (node.nodeName === "BR") {
      pushSpan("\n", currentStyle);
      return;
    }
    const nextStyle = { ...currentStyle };
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      if (el.style.fontWeight === "bold") {
        nextStyle.bold = true;
      }
      if (el.style.fontStyle === "italic") {
        nextStyle.italic = true;
      }
      if (el.style.textDecorationLine === "underline") {
        nextStyle.underline = true;
      }
      if (el.style.fontSize) {
        nextStyle.fontSize = Number.parseInt(el.style.fontSize, 10) || currentStyle.fontSize;
      }
      if (el.style.color) {
        nextStyle.color = el.style.color;
      }
    }
    Array.from(node.childNodes).forEach((child) => walk(child, nextStyle));
    if (node.nodeName === "DIV") {
      pushSpan("\n", currentStyle);
    }
  };

  const base = {
    bold: defaults.bold,
    italic: defaults.italic,
    underline: defaults.underline,
    fontSize: defaults.fontSize,
    color: defaults.color
  };
  Array.from(contentEl.childNodes).forEach((node) => walk(node, base));
  return spans.length ? spans : [{ text: "", ...base }];
}

function applyStyleToSelection(style, contentEl, defaults) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return { updatedDefaults: defaults, updated: false };
  }
  const range = selection.getRangeAt(0);
  if (!contentEl.contains(range.commonAncestorContainer)) {
    return { updatedDefaults: defaults, updated: false };
  }
  if (range.collapsed) {
    return { updatedDefaults: { ...defaults, ...style }, updated: false };
  }

  const fragment = range.extractContents();
  const span = document.createElement("span");
  if (style.bold !== undefined) {
    span.style.fontWeight = style.bold ? "bold" : "normal";
  }
  if (style.italic !== undefined) {
    span.style.fontStyle = style.italic ? "italic" : "normal";
  }
  if (style.underline !== undefined) {
    span.style.textDecorationLine = style.underline ? "underline" : "none";
  }
  if (style.fontSize !== undefined) {
    span.style.fontSize = `${style.fontSize}px`;
  }
  if (style.color) {
    span.style.color = style.color;
  }
  span.append(fragment);
  range.insertNode(span);
  range.setStartAfter(span);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return { updatedDefaults: defaults, updated: true };
}

function getAnnotationBaseStyle(annotation) {
  const span = annotation.spans?.[0] ?? {};
  return {
    bold: span.bold ?? state.textDefaults.bold,
    italic: span.italic ?? state.textDefaults.italic,
    underline: span.underline ?? state.textDefaults.underline,
    fontSize: span.fontSize ?? annotation.fontSize ?? state.textDefaults.fontSize,
    color: span.color ?? annotation.color ?? state.textDefaults.color
  };
}

function renderTextContent(contentEl, spans, baseStyle) {
  contentEl.innerHTML = "";
  spans.forEach((span) => {
    const effective = {
      bold: span.bold ?? baseStyle.bold,
      italic: span.italic ?? baseStyle.italic,
      underline: span.underline ?? baseStyle.underline,
      fontSize: span.fontSize ?? baseStyle.fontSize,
      color: span.color ?? baseStyle.color
    };
    const spanEl = document.createElement("span");
    if (effective.bold) {
      spanEl.style.fontWeight = "bold";
    }
    if (effective.italic) {
      spanEl.style.fontStyle = "italic";
    }
    if (effective.underline) {
      spanEl.style.textDecorationLine = "underline";
    }
    if (effective.fontSize) {
      spanEl.style.fontSize = `${effective.fontSize}px`;
    }
    if (effective.color) {
      spanEl.style.color = effective.color;
    }
    const parts = String(span.text ?? "").split("\n");
    parts.forEach((part, index) => {
      if (part) {
        spanEl.append(document.createTextNode(part));
      }
      if (index < parts.length - 1) {
        spanEl.append(document.createElement("br"));
      }
    });
    contentEl.append(spanEl);
  });
}

function createSvgElement(tagName) {
  return document.createElementNS("http://www.w3.org/2000/svg", tagName);
}

function getPreferredTheme() {
  if (typeof window === "undefined") {
    return "light";
  }
  const stored = window.localStorage?.getItem("cloud-pdf-theme");
  if (stored) {
    return stored;
  }
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}

function applyTheme(theme) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
  window.localStorage?.setItem("cloud-pdf-theme", theme);
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

async function refreshViewer(
  canvas,
  overlay,
  drawLayer,
  highlightLayer,
  pageLabel,
  statusEl
) {
  if (!state.pdfDoc || !state.pageCount) {
    return;
  }
  try {
    await renderPageToCanvas(state.pdfDoc, state.currentPage, canvas);
    renderInkLayers(drawLayer, highlightLayer, overlay);
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

function renderInkLayers(drawLayer, highlightLayer, overlay) {
  if (!drawLayer || !highlightLayer || !overlay) {
    return;
  }
  const { width, height } = getOverlayBounds(overlay);
  const layers = [drawLayer, highlightLayer];
  layers.forEach((layer) => {
    layer.setAttribute("viewBox", `0 0 ${width} ${height}`);
    layer.setAttribute("width", width);
    layer.setAttribute("height", height);
    layer.innerHTML = "";
  });

  const highlightItems = state.highlightAnnotations.filter(
    (annotation) => annotation.pageNumber === state.currentPage
  );
  highlightItems.forEach((annotation) => {
    const rect = createSvgElement("rect");
    rect.setAttribute("x", annotation.x);
    rect.setAttribute("y", annotation.y);
    rect.setAttribute("width", annotation.width);
    rect.setAttribute("height", annotation.height);
    rect.setAttribute("fill", annotation.color);
    rect.setAttribute("fill-opacity", annotation.opacity ?? 0.3);
    rect.dataset.role = "highlight-rect";
    highlightLayer.append(rect);
  });

  const drawItems = state.drawAnnotations.filter(
    (annotation) => annotation.pageNumber === state.currentPage
  );
  drawItems.forEach((annotation) => {
    if (!annotation.points || annotation.points.length < 2) {
      return;
    }
    const path = createSvgElement("path");
    const d = annotation.points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" ");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", annotation.strokeColor);
    path.setAttribute("stroke-width", annotation.strokeWidth);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    if (annotation.opacity !== undefined) {
      path.setAttribute("stroke-opacity", annotation.opacity);
    }
    path.dataset.role = "draw-path";
    drawLayer.append(path);
  });
}

function renderAnnotations(overlay, statusEl) {
  overlay.innerHTML = "";
  if (!state.imageAnnotations.length) {
    renderTextAnnotations(overlay, statusEl);
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

  renderTextAnnotations(overlay, statusEl);
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

function renderTextAnnotations(overlay, statusEl) {
  const current = state.textAnnotations.filter(
    (annotation) => annotation.pageNumber === state.currentPage
  );
  current.forEach((annotation) => {
    const baseStyle = getAnnotationBaseStyle(annotation);
    if (annotation.fontSize === undefined) {
      annotation.fontSize = baseStyle.fontSize;
    }
    if (!annotation.color) {
      annotation.color = baseStyle.color;
    }
    if (!annotation.fontFamily) {
      annotation.fontFamily = state.textDefaults.fontFamily;
    }
    const spans =
      annotation.spans && annotation.spans.length
        ? annotation.spans
        : [{ text: annotation.text ?? "", ...baseStyle }];
    const wrapper = document.createElement("div");
    wrapper.className = "text-annotation";
    wrapper.tabIndex = 0;
    wrapper.dataset.annotationId = annotation.id;
    wrapper.dataset.role = "text-annotation";
    wrapper.style.left = `${annotation.x}px`;
    wrapper.style.top = `${annotation.y}px`;
    wrapper.style.width = `${annotation.width}px`;
    wrapper.style.height = `${annotation.height}px`;
    wrapper.style.fontSize = `${annotation.fontSize}px`;
    wrapper.style.fontFamily = annotation.fontFamily;
    wrapper.style.color = annotation.color;

    const content = document.createElement("div");
    content.className = "text-content";
    content.contentEditable = state.activeTool === "text";
    content.spellcheck = false;
    renderTextContent(content, spans, baseStyle);

    const handle = document.createElement("div");
    handle.className = "resize-handle";

    wrapper.append(content, handle);
    attachTextInteractions(wrapper, content, annotation, overlay, statusEl);
    overlay.append(wrapper);
  });
}

function attachTextInteractions(wrapper, content, annotation, overlay, statusEl) {
  const getBounds = () => getOverlayBounds(overlay);

  const startMove = (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target.classList.contains("resize-handle")) {
      return;
    }
    if (event.target.classList.contains("text-content")) {
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
      wrapper.style.left = `${annotation.x}px`;
      wrapper.style.top = `${annotation.y}px`;
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
      const nextWidth = clamp(originWidth + dx, 60, bounds.width - annotation.x);
      const nextHeight = clamp(originHeight + dy, 24, bounds.height - annotation.y);
      annotation.width = nextWidth;
      annotation.height = nextHeight;
      wrapper.style.width = `${annotation.width}px`;
      wrapper.style.height = `${annotation.height}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  wrapper.addEventListener("pointerdown", (event) => {
    if (event.target.classList.contains("resize-handle")) {
      startResize(event);
      return;
    }
    startMove(event);
  });

  wrapper.addEventListener("focusin", () => {
    state.selectedTextId = annotation.id;
    state.selectedTextElement = content;
  });

  content.addEventListener("input", () => {
    const baseStyle = getAnnotationBaseStyle(annotation);
    annotation.text = content.textContent ?? "";
    annotation.spans = serializeTextSpans(content, baseStyle);
  });

  content.addEventListener("focus", () => {
    state.selectedTextElement = content;
  });

  content.addEventListener("blur", () => {
    if (state.selectedTextElement === content) {
      state.selectedTextElement = null;
    }
  });

  wrapper.addEventListener("keydown", (event) => {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }
    state.textAnnotations = state.textAnnotations.filter((item) => item.id !== annotation.id);
    if (state.selectedTextId === annotation.id) {
      state.selectedTextId = null;
      state.selectedTextElement = null;
    }
    wrapper.remove();
    setStatus(statusEl, "Text removed.");
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
  drawLayer,
  highlightLayer,
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
  state.textAnnotations = [];
  state.selectedTextId = null;
  state.selectedTextElement = null;
  state.drawAnnotations = [];
  state.highlightAnnotations = [];
  state.textDefaults = {
    fontSize: 12,
    fontFamily: "Helvetica",
    color: "#111111",
    bold: false,
    italic: false,
    underline: false
  };
  state.toolDefaults = {
    draw: { color: "#2563eb", size: 4 },
    highlight: { color: "#f59e0b", opacity: 0.35 },
    comment: { color: "#111111" },
    stamp: { text: "APPROVED", color: "#111111" },
    mark: { color: "#b91c1c" },
    signature: { name: "" }
  };
  renderPageList(pageList, applyButton);
  updatePageLabel(pageLabel);
  await refreshViewer(canvas, overlay, drawLayer, highlightLayer, pageLabel, statusEl);
  setStatus(statusEl, "PDF loaded successfully.");
}

export function initApp(root) {
  if (!root) {
    throw new Error("App root element not found");
  }
  applyTheme(getPreferredTheme());

  const container = document.createElement("div");
  container.className = "app-shell";

  const topBar = document.createElement("div");
  topBar.className = "top-bar";

  const brand = document.createElement("div");
  brand.className = "brand";
  const title = document.createElement("h1");
  title.textContent = "Cloud PDF Editor";
  brand.append(title);

  const fileActions = document.createElement("div");
  fileActions.className = "file-actions";

  const loadInput = document.createElement("input");
  loadInput.type = "file";
  loadInput.accept = "application/pdf";
  loadInput.dataset.role = "pdf-load";
  loadInput.hidden = true;

  const mergeInput = document.createElement("input");
  mergeInput.type = "file";
  mergeInput.accept = "application/pdf";
  mergeInput.multiple = true;
  mergeInput.dataset.role = "pdf-merge";
  mergeInput.hidden = true;

  const loadButton = createButton("Load PDF", () => {
    loadInput.click();
  }, "primary");

  const mergeButton = createButton("Merge PDFs", () => {
    mergeInput.click();
  });

  fileActions.append(loadButton, mergeButton, loadInput, mergeInput);

  const toolBar = document.createElement("div");
  toolBar.className = "tool-bar";

  const toolButtons = new Map();
  let renderPanes = () => {};
  TOOL_DEFS.forEach((tool) => {
    const button = createButton(tool.label, () => {
      setActiveTool(tool.id);
      state.paneOpen[tool.id] = tool.id !== "select";
      renderPanes();
    });
    button.dataset.role = `tool-${tool.id}`;
    toolButtons.set(tool.id, button);
    toolBar.append(button);
  });

  function setActiveTool(toolId) {
    state.activeTool = toolId;
    toolButtons.forEach((button, id) => {
      button.dataset.active = id === toolId ? "true" : "false";
    });
    if (overlay) {
      overlay.dataset.mode = toolId;
      const editable = toolId === "text";
      overlay.querySelectorAll(".text-content").forEach((node) => {
        node.contentEditable = editable;
      });
    }
  }

  const actions = document.createElement("div");
  actions.className = "top-actions";

  const trustBox = document.createElement("div");
  trustBox.className = "trust-box";
  const trustLines = [
    "All PDF viewing and editing happens on your device.",
    "Files are never uploaded.",
    "Nothing is saved unless you export or explicitly enable session restore."
  ];
  trustLines.forEach((line) => {
    const row = document.createElement("p");
    row.textContent = line;
    trustBox.append(row);
  });

  const status = document.createElement("p");
  status.className = "status";
  status.textContent = "Load a PDF to begin.";

  const exportButton = createButton("Export PDF", async () => {
    if (!state.currentBytes) {
      setStatus(status, "Load a PDF before exporting.", true);
      return;
    }
    try {
      let exportBytes = state.currentBytes;
      if (state.highlightAnnotations.length > 0) {
        exportBytes = await applyHighlightAnnotations(exportBytes, state.highlightAnnotations);
      }
      if (state.imageAnnotations.length > 0) {
        exportBytes = await applyImageAnnotations(
          exportBytes,
          state.imageAssets,
          state.imageAnnotations
        );
      }
      if (state.textAnnotations.length > 0) {
        exportBytes = await applyTextAnnotations(exportBytes, state.textAnnotations);
      }
      if (state.drawAnnotations.length > 0) {
        exportBytes = await applyDrawAnnotations(exportBytes, state.drawAnnotations);
      }
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
  exportButton.dataset.role = "export-button";

  const settingsPanel = document.createElement("div");
  settingsPanel.className = "settings-panel";
  settingsPanel.hidden = true;

  const settingsButton = createButton("Settings", () => {
    settingsPanel.hidden = !settingsPanel.hidden;
  });
  settingsButton.dataset.role = "settings-button";

  actions.append(exportButton, settingsButton);

  const rememberWrap = document.createElement("label");
  rememberWrap.className = "remember";
  const rememberToggle = document.createElement("input");
  rememberToggle.type = "checkbox";
  const rememberText = document.createElement("span");
  rememberText.textContent = "Remember last session locally (optional)";
  rememberWrap.append(rememberToggle, rememberText);

  const themeGroup = document.createElement("section");
  themeGroup.className = "panel";
  const themeTitle = document.createElement("p");
  themeTitle.className = "section-title";
  themeTitle.textContent = "Theme";
  const themeSelect = document.createElement("select");
  themeSelect.dataset.role = "theme-select";
  [
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" },
    { label: "High Contrast", value: "contrast" }
  ].forEach((theme) => {
    const option = document.createElement("option");
    option.value = theme.value;
    option.textContent = theme.label;
    themeSelect.append(option);
  });
  themeSelect.value = getPreferredTheme();
  themeSelect.addEventListener("change", () => {
    applyTheme(themeSelect.value);
  });
  themeGroup.append(themeTitle, themeSelect);

  const installGroup = document.createElement("section");
  installGroup.className = "panel";
  const installTitle = document.createElement("p");
  installTitle.className = "section-title";
  installTitle.textContent = "Install App";
  const installButton = createButton("Install App", async () => {
    if (!state.installPromptEvent) {
      installHint.hidden = false;
      return;
    }
    const promptEvent = state.installPromptEvent;
    state.installPromptEvent = null;
    installButton.disabled = true;
    await promptEvent.prompt();
  }, "primary");
  installButton.disabled = true;
  installButton.hidden = true;
  installButton.dataset.role = "install-button";
  const installHelp = createButton("Install Instructions", () => {
    installHint.hidden = false;
  });
  installHelp.className = "secondary";
  const installHint = document.createElement("p");
  installHint.className = "muted";
  installHint.textContent = "Use browser menu → Install app";
  installHint.hidden = true;
  installGroup.append(installTitle, installButton, installHelp, installHint);

  window.addEventListener("pwa-install-available", (event) => {
    state.installPromptEvent = event.detail;
    installButton.disabled = false;
    installButton.hidden = false;
    installHint.hidden = true;
  });

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
        drawLayer,
        highlightLayer,
        pageLabel,
        pageList,
        applyReorderButton
      );
      setStatus(status, "Restored last session.");
    } catch (error) {
      setStatus(status, `Failed to restore session: ${error.message}`, true);
    }
  });

  settingsPanel.append(rememberWrap, restoreButton, themeGroup, installGroup);

  loadInput.addEventListener("change", async () => {
    const file = loadInput.files?.[0];
    if (!file) {
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
        drawLayer,
        highlightLayer,
        pageLabel,
        pageList,
        applyReorderButton
      );
      if (rememberToggle.checked) {
        await saveLastPdf(state.currentBytes.slice());
      }
    } catch (error) {
      setStatus(status, `Failed to load PDF: ${error.message}`, true);
    } finally {
      loadInput.value = "";
    }
  });

  mergeInput.addEventListener("change", async () => {
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
        drawLayer,
        highlightLayer,
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
    } finally {
      mergeInput.value = "";
    }
  });

  const viewerGroup = document.createElement("section");
  viewerGroup.className = "document-workspace";
  const pageLabel = document.createElement("p");
  pageLabel.className = "page-label";
  pageLabel.textContent = "No PDF loaded";

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-canvas";

  const highlightLayer = createSvgElement("svg");
  highlightLayer.classList.add("ink-layer", "highlight-layer");
  highlightLayer.dataset.role = "highlight-layer";
  highlightLayer.setAttribute("aria-hidden", "true");

  const drawLayer = createSvgElement("svg");
  drawLayer.classList.add("ink-layer", "draw-layer");
  drawLayer.dataset.role = "draw-layer";
  drawLayer.setAttribute("aria-hidden", "true");

  const overlay = document.createElement("div");
  overlay.className = "page-overlay";
  overlay.dataset.role = "page-overlay";
  overlay.dataset.mode = state.activeTool;
  let activeDraw = null;
  let activeHighlight = null;
  overlay.addEventListener("dragover", (event) => {
    event.preventDefault();
    overlay.classList.add("drag-over");
  });
  overlay.addEventListener("dragleave", () => {
    overlay.classList.remove("drag-over");
  });

  overlay.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    if (state.activeTool !== "draw" && state.activeTool !== "highlight") {
      return;
    }
    event.preventDefault();
    if (!state.currentBytes) {
      setStatus(status, "Load a PDF before drawing.", true);
      return;
    }
    const bounds = getOverlayBounds(overlay);
    if (!bounds.width || !bounds.height) {
      setStatus(status, "Overlay not ready yet. Try again.", true);
      return;
    }
    const start = getOverlayPoint(event, overlay);
    if (state.activeTool === "draw") {
      activeDraw = {
        id: createId("draw"),
        pageNumber: state.currentPage,
        points: [start],
        strokeColor: state.toolDefaults.draw.color,
        strokeWidth: state.toolDefaults.draw.size,
        opacity: 1,
        overlayWidth: bounds.width,
        overlayHeight: bounds.height
      };
      state.drawAnnotations = [...state.drawAnnotations, activeDraw];
    } else if (state.activeTool === "highlight") {
      activeHighlight = {
        id: createId("highlight"),
        pageNumber: state.currentPage,
        x: start.x,
        y: start.y,
        width: 0,
        height: 0,
        color: state.toolDefaults.highlight.color,
        opacity: state.toolDefaults.highlight.opacity,
        overlayWidth: bounds.width,
        overlayHeight: bounds.height
      };
      state.highlightAnnotations = [...state.highlightAnnotations, activeHighlight];
    }
    renderInkLayers(drawLayer, highlightLayer, overlay);

    const onMove = (moveEvent) => {
      if (state.activeTool === "draw" && activeDraw) {
        activeDraw.points.push(getOverlayPoint(moveEvent, overlay));
        renderInkLayers(drawLayer, highlightLayer, overlay);
      }
      if (state.activeTool === "highlight" && activeHighlight) {
        const current = getOverlayPoint(moveEvent, overlay);
        activeHighlight.x = Math.min(start.x, current.x);
        activeHighlight.y = Math.min(start.y, current.y);
        activeHighlight.width = Math.abs(current.x - start.x);
        activeHighlight.height = Math.abs(current.y - start.y);
        renderInkLayers(drawLayer, highlightLayer, overlay);
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (activeHighlight && (activeHighlight.width < 2 || activeHighlight.height < 2)) {
        state.highlightAnnotations = state.highlightAnnotations.filter(
          (item) => item.id !== activeHighlight.id
        );
      }
      activeDraw = null;
      activeHighlight = null;
      renderInkLayers(drawLayer, highlightLayer, overlay);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  overlay.addEventListener("click", (event) => {
    if (state.activeTool !== "text") {
      return;
    }
    if (!state.currentBytes) {
      setStatus(status, "Load a PDF before adding text.", true);
      return;
    }
    if (event.target.closest(".text-annotation") || event.target.closest(".annotation")) {
      return;
    }
    const rect = overlay.getBoundingClientRect();
    const overlayWidth = rect.width || overlay.offsetWidth;
    const overlayHeight = rect.height || overlay.offsetHeight;
    if (!overlayWidth || !overlayHeight) {
      setStatus(status, "Overlay not ready yet. Try again.", true);
      return;
    }
    const x = clamp(event.clientX - rect.left, 0, overlayWidth - 160);
    const y = clamp(event.clientY - rect.top, 0, overlayHeight - 32);
    const baseStyle = {
      bold: state.textDefaults.bold,
      italic: state.textDefaults.italic,
      underline: state.textDefaults.underline,
      fontSize: state.textDefaults.fontSize,
      color: state.textDefaults.color
    };
    const annotation = {
      id: createId("text"),
      pageNumber: state.currentPage,
      x,
      y,
      width: 160,
      height: 32,
      text: "",
      fontSize: state.textDefaults.fontSize,
      fontFamily: state.textDefaults.fontFamily,
      color: state.textDefaults.color,
      spans: [{ text: "", ...baseStyle }],
      overlayWidth,
      overlayHeight
    };
    state.textAnnotations = [...state.textAnnotations, annotation];
    state.selectedTextId = annotation.id;
    renderAnnotations(overlay, status);
    const created = overlay.querySelector(`[data-annotation-id="${annotation.id}"]`);
    const content = created?.querySelector(".text-content");
    if (content) {
      content.focus();
    }
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
  canvasWrap.append(canvas, highlightLayer, overlay, drawLayer);

  const nav = document.createElement("div");
  nav.className = "nav";
  const prevButton = createButton("Previous", async () => {
    if (state.currentPage > 1) {
      state.currentPage -= 1;
      await refreshViewer(canvas, overlay, drawLayer, highlightLayer, pageLabel, status);
    }
  });
  const nextButton = createButton("Next", async () => {
    if (state.currentPage < state.pageCount) {
      state.currentPage += 1;
      await refreshViewer(canvas, overlay, drawLayer, highlightLayer, pageLabel, status);
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

  const textToolGroup = document.createElement("section");
  textToolGroup.className = "panel";
  const textTitle = document.createElement("p");
  textTitle.className = "section-title";
  textTitle.textContent = "Text Tool";

  const fontSizeInput = document.createElement("input");
  fontSizeInput.type = "number";
  fontSizeInput.min = "8";
  fontSizeInput.max = "72";
  fontSizeInput.value = String(state.textDefaults.fontSize);
  fontSizeInput.dataset.role = "text-font-size";

  const fontFamilySelect = document.createElement("select");
  fontFamilySelect.dataset.role = "text-font-family";
  ["Helvetica", "Times", "Courier"].forEach((family) => {
    const option = document.createElement("option");
    option.value = family;
    option.textContent = family;
    fontFamilySelect.append(option);
  });

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = state.textDefaults.color;
  colorInput.dataset.role = "text-color";

  const styleRow = document.createElement("div");
  styleRow.className = "text-style-controls";
  const boldButton = createButton("B", () => {
    applyTextStyleChange({ bold: boldButton.dataset.active !== "true" });
  });
  boldButton.dataset.role = "text-bold";
  boldButton.className = "text-style-toggle";
  const italicButton = createButton("I", () => {
    applyTextStyleChange({ italic: italicButton.dataset.active !== "true" });
  });
  italicButton.dataset.role = "text-italic";
  italicButton.className = "text-style-toggle";
  const underlineButton = createButton("U", () => {
    applyTextStyleChange({ underline: underlineButton.dataset.active !== "true" });
  });
  underlineButton.dataset.role = "text-underline";
  underlineButton.className = "text-style-toggle";
  styleRow.append(boldButton, italicButton, underlineButton);

  const removeTextButton = createButton("Remove Text", () => {
    if (!state.selectedTextId) {
      setStatus(status, "Select a text annotation to remove.", true);
      return;
    }
    state.textAnnotations = state.textAnnotations.filter(
      (item) => item.id !== state.selectedTextId
    );
    state.selectedTextId = null;
    state.selectedTextElement = null;
    renderAnnotations(overlay, status);
    setStatus(status, "Text removed.");
  });

  const setToggleState = (button, isActive) => {
    button.dataset.active = isActive ? "true" : "false";
  };

  const updateTextControls = (style) => {
    fontSizeInput.value = String(style.fontSize);
    colorInput.value = style.color;
    setToggleState(boldButton, !!style.bold);
    setToggleState(italicButton, !!style.italic);
    setToggleState(underlineButton, !!style.underline);
  };

  const applyTextStyleChange = (style) => {
    const annotation = state.textAnnotations.find((item) => item.id === state.selectedTextId);
    if (!annotation) {
      if (style.bold !== undefined) {
        state.textDefaults.bold = style.bold;
      }
      if (style.italic !== undefined) {
        state.textDefaults.italic = style.italic;
      }
      if (style.underline !== undefined) {
        state.textDefaults.underline = style.underline;
      }
      if (style.fontSize !== undefined) {
        state.textDefaults.fontSize = style.fontSize;
      }
      if (style.color) {
        state.textDefaults.color = style.color;
      }
      updateTextControls(state.textDefaults);
      return;
    }

    const contentEl = state.selectedTextElement;
    const selection = window.getSelection();
    if (
      contentEl &&
      selection &&
      selection.rangeCount > 0 &&
      contentEl.contains(selection.getRangeAt(0).commonAncestorContainer) &&
      !selection.isCollapsed
    ) {
      applyStyleToSelection(style, contentEl, getAnnotationBaseStyle(annotation));
      annotation.text = contentEl.textContent ?? "";
      annotation.spans = serializeTextSpans(contentEl, getAnnotationBaseStyle(annotation));
      return;
    }

    if (!annotation.spans || annotation.spans.length === 0) {
      const baseStyle = getAnnotationBaseStyle(annotation);
      annotation.spans = [{ text: annotation.text ?? "", ...baseStyle }];
    }

    const applyToSpan = (span) => {
      const next = { ...span };
      if (style.bold !== undefined) {
        next.bold = style.bold;
      }
      if (style.italic !== undefined) {
        next.italic = style.italic;
      }
      if (style.underline !== undefined) {
        next.underline = style.underline;
      }
      if (style.fontSize !== undefined) {
        next.fontSize = style.fontSize;
      }
      if (style.color) {
        next.color = style.color;
      }
      return next;
    };

    annotation.spans = (annotation.spans ?? []).map(applyToSpan);
    if (style.fontSize !== undefined) {
      annotation.fontSize = style.fontSize;
    }
    if (style.color) {
      annotation.color = style.color;
    }
    renderAnnotations(overlay, status);
    state.selectedTextElement = overlay.querySelector(
      `[data-annotation-id="${annotation.id}"] .text-content`
    );
    updateTextControls(getAnnotationBaseStyle(annotation));
  };

  fontSizeInput.addEventListener("change", () => {
    const value = Number.parseInt(fontSizeInput.value, 10);
    if (Number.isFinite(value)) {
      applyTextStyleChange({ fontSize: value });
    }
  });

  fontFamilySelect.addEventListener("change", () => {
    const annotation = state.textAnnotations.find((item) => item.id === state.selectedTextId);
    if (annotation) {
      annotation.fontFamily = fontFamilySelect.value;
      renderAnnotations(overlay, status);
      return;
    }
    state.textDefaults.fontFamily = fontFamilySelect.value;
  });

  colorInput.addEventListener("input", () => {
    applyTextStyleChange({ color: colorInput.value });
  });

  const palette = document.createElement("div");
  palette.className = "color-palette";
  ["#111111", "#1f2937", "#2563eb", "#0f766e", "#b91c1c"].forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "color-swatch";
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.addEventListener("click", () => {
      colorInput.value = color;
      colorInput.dispatchEvent(new Event("input"));
    });
    palette.append(swatch);
  });

  overlay.addEventListener("focusin", (event) => {
    const wrapper = event.target.closest(".text-annotation");
    if (!wrapper) {
      return;
    }
    const annotation = state.textAnnotations.find((item) => item.id === wrapper.dataset.annotationId);
    if (!annotation) {
      return;
    }
    state.selectedTextId = annotation.id;
    state.selectedTextElement = wrapper.querySelector(".text-content");
    fontFamilySelect.value = annotation.fontFamily ?? state.textDefaults.fontFamily;
    updateTextControls(getAnnotationBaseStyle(annotation));
  });

  updateTextControls(state.textDefaults);

  textToolGroup.append(
    textTitle,
    fontSizeInput,
    styleRow,
    fontFamilySelect,
    colorInput,
    palette,
    removeTextButton
  );

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
      const currentImageAnnotations = state.imageAnnotations;
      const currentTextAnnotations = state.textAnnotations;
      const currentDrawAnnotations = state.drawAnnotations;
      const currentHighlightAnnotations = state.highlightAnnotations;
      const pageMapping = new Map();
      state.pageOrder.forEach((oldPageNumber, index) => {
        pageMapping.set(oldPageNumber, index + 1);
      });
      const remappedImageAnnotations = currentImageAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const remappedTextAnnotations = currentTextAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const remappedDrawAnnotations = currentDrawAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const remappedHighlightAnnotations = currentHighlightAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const reorderedBytes = await reorderPdf(state.currentBytes, state.pageOrder);
      await loadPdfBytes(
        reorderedBytes,
        status,
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        pageLabel,
        pageList,
        applyReorderButton
      );
      state.imageAssets = currentAssets;
      state.imageAnnotations = remappedImageAnnotations;
      state.textAnnotations = remappedTextAnnotations;
      state.drawAnnotations = remappedDrawAnnotations;
      state.highlightAnnotations = remappedHighlightAnnotations;
      renderAssetList(assetList, status);
      renderInkLayers(drawLayer, highlightLayer, overlay);
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

  const workspace = document.createElement("div");
  workspace.className = "workspace";

  const paneRoot = document.createElement("div");
  paneRoot.className = "pane-root";

  const createPane = (id, titleText, content) => {
    const pane = document.createElement("section");
    pane.className = "floating-pane";
    pane.dataset.role = `pane-${id}`;
    const header = document.createElement("div");
    header.className = "pane-header";
    const title = document.createElement("span");
    title.textContent = titleText;
    const controls = document.createElement("div");
    controls.className = "pane-controls";
    const collapseButton = createButton("–", () => {
      state.paneCollapsed[id] = !state.paneCollapsed[id];
      body.hidden = !!state.paneCollapsed[id];
    });
    collapseButton.className = "pane-control";
    const closeButton = createButton("×", () => {
      state.paneOpen[id] = false;
      renderPanes();
    });
    closeButton.className = "pane-control";
    controls.append(collapseButton, closeButton);
    header.append(title, controls);

    const body = document.createElement("div");
    body.className = "pane-body";
    body.append(content);

    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const rect = pane.getBoundingClientRect();
      const originLeft = rect.left;
      const originTop = rect.top;

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const left = Math.max(16, originLeft + dx);
        const top = Math.max(16, originTop + dy);
        pane.style.left = `${left}px`;
        pane.style.top = `${top}px`;
        state.panePositions[id] = { left, top };
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    pane.append(header, body);
    return pane;
  };

  const placeholderPane = (text, fields = []) => {
    const panel = document.createElement("div");
    panel.className = "panel";
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = text;
    panel.append(message);
    fields.forEach((field) => panel.append(field));
    return panel;
  };

  const drawPane = () => {
    const color = document.createElement("input");
    color.type = "color";
    color.value = state.toolDefaults.draw.color;
    color.addEventListener("input", () => {
      state.toolDefaults.draw.color = color.value;
    });
    const size = document.createElement("input");
    size.type = "number";
    size.min = "1";
    size.max = "20";
    size.value = String(state.toolDefaults.draw.size);
    size.addEventListener("change", () => {
      const next = Number.parseInt(size.value, 10);
      if (Number.isFinite(next)) {
        state.toolDefaults.draw.size = next;
      }
    });
    return placeholderPane("Click and drag on the page to draw.", [
      createLabeledField("Stroke color", color),
      createLabeledField("Stroke size", size)
    ]);
  };

  const highlightPane = () => {
    const color = document.createElement("input");
    color.type = "color";
    color.value = state.toolDefaults.highlight.color;
    color.addEventListener("input", () => {
      state.toolDefaults.highlight.color = color.value;
    });
    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0.1";
    opacity.max = "0.8";
    opacity.step = "0.05";
    opacity.value = String(state.toolDefaults.highlight.opacity);
    opacity.addEventListener("input", () => {
      state.toolDefaults.highlight.opacity = Number(opacity.value);
    });
    return placeholderPane("Click and drag on the page to highlight.", [
      createLabeledField("Tint color", color),
      createLabeledField("Opacity", opacity)
    ]);
  };

  const commentPane = () => {
    const color = document.createElement("input");
    color.type = "color";
    color.value = state.toolDefaults.comment.color;
    color.addEventListener("input", () => {
      state.toolDefaults.comment.color = color.value;
    });
    return placeholderPane("Comment tools will appear here.", [
      createLabeledField("Text color", color)
    ]);
  };

  const stampPane = () => {
    const text = document.createElement("input");
    text.type = "text";
    text.value = state.toolDefaults.stamp.text;
    text.addEventListener("input", () => {
      state.toolDefaults.stamp.text = text.value;
    });
    const color = document.createElement("input");
    color.type = "color";
    color.value = state.toolDefaults.stamp.color;
    color.addEventListener("input", () => {
      state.toolDefaults.stamp.color = color.value;
    });
    return placeholderPane("Stamp presets are stored locally.", [
      createLabeledField("Stamp text", text),
      createLabeledField("Stamp color", color)
    ]);
  };

  const markPane = () => {
    const color = document.createElement("input");
    color.type = "color";
    color.value = state.toolDefaults.mark.color;
    color.addEventListener("input", () => {
      state.toolDefaults.mark.color = color.value;
    });
    return placeholderPane("Page order tools live here.", [
      createLabeledField("Marker color", color),
      reorderGroup
    ]);
  };

  const signaturePane = () => {
    const name = document.createElement("input");
    name.type = "text";
    name.value = state.toolDefaults.signature.name;
    name.addEventListener("input", () => {
      state.toolDefaults.signature.name = name.value;
    });
    return placeholderPane("Signature setup will be added later.", [
      createLabeledField("Signer name", name)
    ]);
  };

  const panes = new Map();
  panes.set("text", createPane("text", "Text", textToolGroup));
  panes.set("image", createPane("image", "Images", assetGroup));
  panes.set("draw", createPane("draw", "Draw", drawPane()));
  panes.set("highlight", createPane("highlight", "Highlight", highlightPane()));
  panes.set("comment", createPane("comment", "Comment", commentPane()));
  panes.set("stamp", createPane("stamp", "Stamp", stampPane()));
  panes.set("mark", createPane("mark", "Mark", markPane()));
  panes.set("signature", createPane("signature", "Signature", signaturePane()));

  renderPanes = () => {
    paneRoot.innerHTML = "";
    const activePaneId =
      state.activeTool !== "select" && state.paneOpen[state.activeTool]
        ? state.activeTool
        : null;
    if (!activePaneId) {
      return;
    }
    const pane = panes.get(activePaneId);
    if (!pane) {
      return;
    }
    const position = state.panePositions[activePaneId] ?? { left: 32, top: 140 };
    pane.style.left = `${position.left}px`;
    pane.style.top = `${position.top}px`;
    paneRoot.append(pane);
  };

  workspace.append(viewerGroup, paneRoot);

  topBar.append(brand, fileActions, toolBar, actions, settingsPanel);

  setActiveTool("select");
  renderPanes();

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setActiveTool("select");
      renderPanes();
    }
  });

  container.append(topBar, trustBox, status, workspace);
  root.append(container);
}
