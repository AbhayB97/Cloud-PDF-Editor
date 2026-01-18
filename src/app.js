import {
  applyDrawAnnotations,
  applyHighlightAnnotations,
  applyImageAnnotations,
  applyPageProperties,
  applyShapeAnnotations,
  applySignatureAnnotations,
  applyTextAnnotations,
  isPdfBytes,
  isPdfFile,
  loadPdfDocument,
  mergePdfs,
  readFileAsArrayBuffer,
  renderPageToCanvas,
  reorderPdf,
  splitPdf
} from "./pdfService.js";
import {
  clearSessionHistory,
  clearSignatureProfile,
  loadLastPdf,
  loadSessionHistory,
  loadSignatureProfile,
  saveLastPdf,
  saveSessionHistory,
  saveSignatureProfile
} from "./storage.js";
import { SIGNATURE_LAYOUT, SIGNATURE_VARIANTS, getSignatureVariant } from "./signatureData.js";

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
  shapeAnnotations: [],
  shapeDraft: null,
  selectedTextElement: null,
  toolDefaults: {
    draw: { color: "#2563eb", size: 4 },
    highlight: { color: "#f59e0b", opacity: 0.35 },
    comment: { color: "#111111", text: "Comment" },
    stamp: { text: "APPROVED", color: "#111111" },
    shapes: {
      shapeType: "rect",
      strokeColor: "#2563eb",
      strokeWidth: 3,
      fillColor: "",
      opacity: 1
    },
    signature: { name: "" }
  },
  pageProperties: {
    rotations: {},
    hidden: new Set(),
    deleted: new Set(),
    duplicates: {}
  },
  signatureProfile: null,
  signatureAnnotations: [],
  signaturePlacementMode: "full",
  commentsVisible: true,
  commentAnnotations: [],
  stampAnnotations: [],
  selectedStampId: null,
  sessionEntries: [],
  sessionHistoryEnabled: true,
  currentFileName: "",
  currentFileHash: ""
};

const TOOL_DEFS = [
  { id: "select", label: "Select" },
  { id: "text", label: "Text" },
  { id: "draw", label: "Draw" },
  { id: "highlight", label: "Highlight" },
  { id: "shapes", label: "Shapes" },
  { id: "comment", label: "Comment" },
  { id: "stamp", label: "Stamp" },
  { id: "page-properties", label: "Page Properties" },
  { id: "image", label: "Image" },
  { id: "signature", label: "Signature" },
  { id: "split", label: "Split" }
];

let stampDeleteButton = null;
let pagePropertiesUi = null;

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

function syncStampDeleteButton() {
  if (!stampDeleteButton) {
    return;
  }
  const hasSelection = state.stampAnnotations.some(
    (item) => item.id === state.selectedStampId
  );
  stampDeleteButton.disabled = !hasSelection;
}

function setStatus(statusEl, message, isError = false) {
  statusEl.textContent = message;
  statusEl.dataset.error = isError ? "true" : "false";
}

function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function getRememberHistoryPreference() {
  if (typeof window === "undefined") {
    return true;
  }
  const stored = window.localStorage?.getItem("cloud-pdf-history");
  if (stored === null || stored === undefined) {
    return true;
  }
  return stored === "true";
}

function setRememberHistoryPreference(value) {
  window.localStorage?.setItem("cloud-pdf-history", value ? "true" : "false");
}

async function hashBytes(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    try {
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      // Fall back to a simple hash when SubtleCrypto is unavailable.
    }
  }
  let hash = 0;
  data.forEach((value) => {
    hash = (hash * 31 + value) >>> 0;
  });
  return hash.toString(16);
}

function ensureSignatureFontsLoaded() {
  if (typeof document === "undefined" || !document.fonts?.load) {
    return Promise.resolve();
  }
  const loads = SIGNATURE_VARIANTS.map((variant) =>
    document.fonts.load(`16px ${variant.cssFamily}`)
  );
  return Promise.all(loads).then(() => undefined);
}

function buildExportTextAnnotations() {
  const comments = state.commentAnnotations.map((annotation) => ({
    id: annotation.id,
    pageNumber: annotation.pageNumber,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    text: annotation.text ?? "",
    fontSize: annotation.fontSize ?? 12,
    fontFamily: "Helvetica",
    color: annotation.color ?? "#111111",
    overlayWidth: annotation.overlayWidth,
    overlayHeight: annotation.overlayHeight
  }));
  const stamps = state.stampAnnotations.map((annotation) => ({
    id: annotation.id,
    pageNumber: annotation.pageNumber,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    text: annotation.text ?? state.toolDefaults.stamp.text,
    fontSize: annotation.fontSize ?? 20,
    fontFamily: "Helvetica",
    color: annotation.color ?? "#111111",
    overlayWidth: annotation.overlayWidth,
    overlayHeight: annotation.overlayHeight,
    spans: [{ text: annotation.text ?? state.toolDefaults.stamp.text, bold: true }]
  }));
  return [...state.textAnnotations, ...comments, ...stamps];
}

function fitSignatureFontSize(text, fontFamily, width, height, spacingFactor = 0) {
  if (!text) {
    return SIGNATURE_LAYOUT.minFontSize;
  }
  const paddedWidth = Math.max(10, width - SIGNATURE_LAYOUT.paddingX * 2);
  const paddedHeight = Math.max(10, height - SIGNATURE_LAYOUT.paddingY * 2);
  let size = Math.max(SIGNATURE_LAYOUT.minFontSize, paddedHeight);
  if (typeof document === "undefined") {
    return size;
  }
  const canvas = fitSignatureFontSize.canvas || document.createElement("canvas");
  fitSignatureFontSize.canvas = canvas;
  const context = canvas.getContext("2d");
  if (!context) {
    return size;
  }
  while (size > SIGNATURE_LAYOUT.minFontSize) {
    context.font = `${size}px ${fontFamily}`;
    const spacing = size * spacingFactor;
    const measured = context.measureText(text).width + spacing * Math.max(0, text.length - 1);
    if (measured <= paddedWidth) {
      return size;
    }
    size -= 1;
  }
  return SIGNATURE_LAYOUT.minFontSize;
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

function serializeSessionAnnotations() {
  const annotations = [];
  state.imageAnnotations.forEach((annotation) => {
    const asset = state.imageAssets.find((item) => item.id === annotation.assetId);
    annotations.push({
      type: "image",
      ...annotation,
      asset: asset
        ? {
            id: asset.id,
            name: asset.name,
            imageData:
              asset.imageData instanceof Uint8Array
                ? asset.imageData
                : new Uint8Array(asset.imageData),
            naturalWidth: asset.naturalWidth,
            naturalHeight: asset.naturalHeight
          }
        : null
    });
  });
  state.textAnnotations.forEach((annotation) =>
    annotations.push({ type: "text", ...annotation })
  );
  state.drawAnnotations.forEach((annotation) =>
    annotations.push({ type: "draw", ...annotation })
  );
  state.highlightAnnotations.forEach((annotation) =>
    annotations.push({ type: "highlight", ...annotation })
  );
  state.shapeAnnotations.forEach((annotation) =>
    annotations.push({ type: "shape", ...annotation })
  );
  state.signatureAnnotations.forEach((annotation) =>
    annotations.push({ type: "signature", ...annotation })
  );
  state.commentAnnotations.forEach((annotation) =>
    annotations.push({ type: "comment", ...annotation })
  );
  state.stampAnnotations.forEach((annotation) =>
    annotations.push({ type: "stamp", ...annotation })
  );
  return annotations;
}

function applySessionAnnotations(annotations) {
  const imageAssets = new Map();
  const imageAnnotations = [];
  const textAnnotations = [];
  const drawAnnotations = [];
  const highlightAnnotations = [];
  const shapeAnnotations = [];
  const signatureAnnotations = [];
  const commentAnnotations = [];
  const stampAnnotations = [];

  (annotations ?? []).forEach((annotation) => {
    if (annotation.type === "image") {
      if (annotation.asset) {
        const asset = annotation.asset;
        if (!imageAssets.has(asset.id)) {
          const extension = (asset.name ?? "").toLowerCase();
          const mimeType = extension.endsWith(".png") ? "image/png" : "image/jpeg";
          let previewUrl = "";
          if (typeof URL !== "undefined" && URL.createObjectURL) {
            try {
              previewUrl = URL.createObjectURL(
                new Blob([asset.imageData], { type: mimeType })
              );
            } catch {
              previewUrl = "";
            }
          }
          imageAssets.set(asset.id, {
            id: asset.id,
            name: asset.name,
            imageData: asset.imageData,
            naturalWidth: asset.naturalWidth,
            naturalHeight: asset.naturalHeight,
            previewUrl
          });
        }
      }
      const { type, asset, ...rest } = annotation;
      imageAnnotations.push(rest);
      return;
    }
    if (annotation.type === "text") {
      const { type, ...rest } = annotation;
      textAnnotations.push(rest);
      return;
    }
    if (annotation.type === "draw") {
      const { type, ...rest } = annotation;
      drawAnnotations.push(rest);
      return;
    }
    if (annotation.type === "highlight") {
      const { type, ...rest } = annotation;
      highlightAnnotations.push(rest);
      return;
    }
    if (annotation.type === "shape") {
      const { type, ...rest } = annotation;
      shapeAnnotations.push(rest);
      return;
    }
    if (annotation.type === "signature") {
      const { type, ...rest } = annotation;
      signatureAnnotations.push(rest);
      return;
    }
    if (annotation.type === "comment") {
      const { type, ...rest } = annotation;
      commentAnnotations.push(rest);
      return;
    }
    if (annotation.type === "stamp") {
      const { type, ...rest } = annotation;
      stampAnnotations.push(rest);
      return;
    }
  });

  state.imageAssets = Array.from(imageAssets.values());
  state.imageAnnotations = imageAnnotations;
  state.textAnnotations = textAnnotations;
  state.drawAnnotations = drawAnnotations;
  state.highlightAnnotations = highlightAnnotations;
  state.shapeAnnotations = shapeAnnotations;
  state.signatureAnnotations = signatureAnnotations;
  state.commentAnnotations = commentAnnotations;
  state.stampAnnotations = stampAnnotations;
}

let sessionSaveTimer = null;

function scheduleSessionSave() {
  if (!state.sessionHistoryEnabled || !state.currentBytes || !state.currentFileHash) {
    return;
  }
  if (sessionSaveTimer) {
    window.clearTimeout(sessionSaveTimer);
  }
  sessionSaveTimer = window.setTimeout(async () => {
    sessionSaveTimer = null;
    const entry = {
      id: state.currentFileHash || createId("session"),
      fileName: state.currentFileName || "Untitled.pdf",
      fileHash: state.currentFileHash,
      lastOpened: Date.now(),
      annotations: serializeSessionAnnotations()
    };
    const entries = state.sessionEntries.filter((item) => item.fileHash !== entry.fileHash);
    entries.unshift(entry);
    state.sessionEntries = entries.slice(0, 12);
    await saveSessionHistory(state.sessionEntries);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("session-history-updated"));
    }
  }, 500);
}

async function trackSessionOnOpen(fileName, bytes, enabled = state.sessionHistoryEnabled) {
  if (!enabled || !bytes) {
    return;
  }
  state.currentFileName = fileName;
  state.currentFileHash = await hashBytes(bytes);
  const entry = {
    id: state.currentFileHash,
    fileName: fileName || "Untitled.pdf",
    fileHash: state.currentFileHash,
    lastOpened: Date.now(),
    annotations: serializeSessionAnnotations()
  };
  const entries = state.sessionEntries.filter((item) => item.fileHash !== entry.fileHash);
  entries.unshift(entry);
  state.sessionEntries = entries.slice(0, 12);
  await saveSessionHistory(state.sessionEntries);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("session-history-updated"));
  }
}

function updatePageLabel(pageLabel) {
  if (!state.pageCount) {
    pageLabel.textContent = "No PDF loaded";
    return;
  }
  const visiblePages = getVisiblePages();
  const totalVisible = visiblePages.length;
  pageLabel.textContent =
    totalVisible > 0
      ? `Page ${state.currentPage} of ${state.pageCount} (visible: ${totalVisible})`
      : `Page ${state.currentPage} of ${state.pageCount}`;
}

function isPageHidden(pageNumber) {
  return state.pageProperties.hidden.has(pageNumber);
}

function isPageDeleted(pageNumber) {
  return state.pageProperties.deleted.has(pageNumber);
}

function getVisiblePages() {
  const pages = [];
  for (let page = 1; page <= state.pageCount; page += 1) {
    if (isPageHidden(page) || isPageDeleted(page)) {
      continue;
    }
    pages.push(page);
  }
  return pages;
}

function buildExportPageOrder() {
  const order = [];
  for (let page = 1; page <= state.pageCount; page += 1) {
    if (isPageHidden(page) || isPageDeleted(page)) {
      continue;
    }
    order.push(page);
    const duplicateCount = state.pageProperties.duplicates[page] ?? 0;
    if (duplicateCount > 0) {
      for (let i = 0; i < duplicateCount; i += 1) {
        order.push(page);
      }
    }
  }
  return order;
}

function remapAnnotationsForExport(annotations, exportPageOrder) {
  if (!annotations.length) {
    return [];
  }
  const indexMap = new Map();
  exportPageOrder.forEach((pageNumber, index) => {
    if (!indexMap.has(pageNumber)) {
      indexMap.set(pageNumber, []);
    }
    indexMap.get(pageNumber).push(index + 1);
  });
  const mapped = [];
  annotations.forEach((annotation) => {
    const targets = indexMap.get(annotation.pageNumber);
    if (!targets?.length) {
      return;
    }
    targets.forEach((targetPage) => {
      mapped.push({ ...annotation, pageNumber: targetPage });
    });
  });
  return mapped;
}

function parsePageGroups(input, mode, pageCount) {
  const parts = input
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return { groups: [], error: "Enter at least one page or range." };
  }
  const toNumber = (value) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > pageCount) {
      return null;
    }
    return parsed;
  };
  if (mode === "range") {
    const groups = [];
    for (const part of parts) {
      if (!part.includes("-")) {
        const page = toNumber(part);
        if (!page) {
          return { groups: [], error: `Invalid page "${part}".` };
        }
        groups.push([page]);
        continue;
      }
      const [startRaw, endRaw] = part.split("-").map((item) => item.trim());
      const start = toNumber(startRaw);
      const end = toNumber(endRaw);
      if (!start || !end || start > end) {
        return { groups: [], error: `Invalid range "${part}".` };
      }
      const range = [];
      for (let page = start; page <= end; page += 1) {
        range.push(page);
      }
      groups.push(range);
    }
    return { groups, error: null };
  }

  const pages = [];
  const seen = new Set();
  for (const part of parts) {
    if (part.includes("-")) {
      const [startRaw, endRaw] = part.split("-").map((item) => item.trim());
      const start = toNumber(startRaw);
      const end = toNumber(endRaw);
      if (!start || !end || start > end) {
        return { groups: [], error: `Invalid range "${part}".` };
      }
      for (let page = start; page <= end; page += 1) {
        if (!seen.has(page)) {
          seen.add(page);
          pages.push(page);
        }
      }
    } else {
      const page = toNumber(part);
      if (!page) {
        return { groups: [], error: `Invalid page "${part}".` };
      }
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
    }
  }
  return { groups: [pages], error: null };
}

function resolveVisiblePage(targetPage) {
  if (!state.pageCount) {
    return targetPage;
  }
  if (!isPageHidden(targetPage) && !isPageDeleted(targetPage)) {
    return targetPage;
  }
  const visible = getVisiblePages();
  if (!visible.length) {
    return targetPage;
  }
  const next = visible.find((page) => page >= targetPage);
  return next ?? visible[visible.length - 1];
}

function getNeighborVisiblePage(current, direction) {
  const visible = getVisiblePages();
  if (!visible.length) {
    return current;
  }
  const index = visible.indexOf(current);
  if (index === -1) {
    return resolveVisiblePage(current);
  }
  const nextIndex = clamp(index + direction, 0, visible.length - 1);
  return visible[nextIndex];
}

async function refreshViewer(
  canvas,
  overlay,
  drawLayer,
  highlightLayer,
  shapeLayer,
  pageLabel,
  statusEl
) {
  if (!state.pdfDoc || !state.pageCount) {
    return;
  }
  try {
    state.currentPage = resolveVisiblePage(state.currentPage);
    const rotation = state.pageProperties.rotations[state.currentPage] ?? 0;
    await renderPageToCanvas(state.pdfDoc, state.currentPage, canvas, 1.2, rotation);
    renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
    updatePageLabel(pageLabel);
    if (pagePropertiesUi?.update) {
      pagePropertiesUi.update();
    }
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

function renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer) {
  if (!drawLayer || !highlightLayer || !overlay) {
    return;
  }
  const { width, height } = getOverlayBounds(overlay);
  const layers = [drawLayer, highlightLayer];
  if (shapeLayer) {
    layers.push(shapeLayer);
  }
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

  if (shapeLayer) {
    renderShapeLayer(shapeLayer, overlay);
  }
}

function renderShapeLayer(shapeLayer, overlay) {
  const currentShapes = state.shapeAnnotations.filter(
    (annotation) => annotation.pageNumber === state.currentPage
  );
  const draft = state.shapeDraft && state.shapeDraft.pageNumber === state.currentPage
    ? state.shapeDraft
    : null;
  const items = draft ? [...currentShapes, draft] : currentShapes;

  items.forEach((annotation) => {
    const { shapeType, geometry, style } = annotation;
    const strokeColor = style?.strokeColor ?? "#111111";
    const strokeWidth = style?.strokeWidth ?? 2;
    const fillColor = style?.fillColor ?? "";
    const opacity = style?.opacity ?? 1;
    if (shapeType === "rect") {
      const rect = createSvgElement("rect");
      rect.setAttribute("x", geometry.x ?? 0);
      rect.setAttribute("y", geometry.y ?? 0);
      rect.setAttribute("width", geometry.width ?? 0);
      rect.setAttribute("height", geometry.height ?? 0);
      rect.setAttribute("fill", fillColor || "none");
      rect.setAttribute("stroke", strokeColor);
      rect.setAttribute("stroke-width", strokeWidth);
      rect.setAttribute("opacity", opacity);
      rect.dataset.role = "shape-rect";
      shapeLayer.append(rect);
      return;
    }
    if (shapeType === "ellipse") {
      const ellipse = createSvgElement("ellipse");
      const cx = (geometry.x ?? 0) + (geometry.width ?? 0) / 2;
      const cy = (geometry.y ?? 0) + (geometry.height ?? 0) / 2;
      ellipse.setAttribute("cx", cx);
      ellipse.setAttribute("cy", cy);
      ellipse.setAttribute("rx", Math.abs(geometry.width ?? 0) / 2);
      ellipse.setAttribute("ry", Math.abs(geometry.height ?? 0) / 2);
      ellipse.setAttribute("fill", fillColor || "none");
      ellipse.setAttribute("stroke", strokeColor);
      ellipse.setAttribute("stroke-width", strokeWidth);
      ellipse.setAttribute("opacity", opacity);
      ellipse.dataset.role = "shape-ellipse";
      shapeLayer.append(ellipse);
      return;
    }
    if (shapeType === "line" || shapeType === "arrow") {
      const points = geometry.points ?? [];
      if (points.length < 2) {
        return;
      }
      const line = createSvgElement("line");
      line.setAttribute("x1", points[0].x);
      line.setAttribute("y1", points[0].y);
      line.setAttribute("x2", points[points.length - 1].x);
      line.setAttribute("y2", points[points.length - 1].y);
      line.setAttribute("stroke", strokeColor);
      line.setAttribute("stroke-width", strokeWidth);
      line.setAttribute("opacity", opacity);
      line.dataset.role = "shape-line";
      shapeLayer.append(line);

      if (shapeType === "arrow") {
        const arrow = createSvgElement("path");
        const end = points[points.length - 1];
        const start = points[points.length - 2] ?? points[0];
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const size = Math.max(10, strokeWidth * 3);
        const leftX = end.x - size * Math.cos(angle - Math.PI / 6);
        const leftY = end.y - size * Math.sin(angle - Math.PI / 6);
        const rightX = end.x - size * Math.cos(angle + Math.PI / 6);
        const rightY = end.y - size * Math.sin(angle + Math.PI / 6);
        arrow.setAttribute(
          "d",
          `M ${leftX} ${leftY} L ${end.x} ${end.y} L ${rightX} ${rightY}`
        );
        arrow.setAttribute("fill", "none");
        arrow.setAttribute("stroke", strokeColor);
        arrow.setAttribute("stroke-width", strokeWidth);
        arrow.setAttribute("opacity", opacity);
        arrow.dataset.role = "shape-arrow";
        shapeLayer.append(arrow);
      }
      return;
    }
    if (shapeType === "polygon" || shapeType === "cloud") {
      const points = geometry.points ?? [];
      const previewPoint = annotation.previewPoint;
      const pathPoints = previewPoint ? [...points, previewPoint] : points;
      if (points.length < 2) {
        return;
      }
      const path = createSvgElement("path");
      const pathData = buildShapePath(pathPoints, shapeType === "cloud");
      path.setAttribute("d", pathData);
      path.setAttribute("fill", fillColor || "none");
      path.setAttribute("stroke", strokeColor);
      path.setAttribute("stroke-width", strokeWidth);
      path.setAttribute("opacity", opacity);
      path.dataset.role = shapeType === "cloud" ? "shape-cloud" : "shape-polygon";
      shapeLayer.append(path);
    }
  });
}

function buildShapePath(points, isCloud) {
  if (!points.length) {
    return "";
  }
  if (!isCloud) {
    return (
      `M ${points[0].x} ${points[0].y} ` +
      points
        .slice(1)
        .map((point) => `L ${point.x} ${point.y}`)
        .join(" ") +
      " Z"
    );
  }
  const segments = [];
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    const offsetX = (next.y - current.y) * 0.15;
    const offsetY = (current.x - next.x) * 0.15;
    const controlX = midX + offsetX;
    const controlY = midY + offsetY;
    if (i === 0) {
      segments.push(`M ${current.x} ${current.y}`);
    }
    segments.push(`Q ${controlX} ${controlY} ${next.x} ${next.y}`);
  }
  return `${segments.join(" ")} Z`;
}

function renderAnnotations(overlay, statusEl) {
  overlay.innerHTML = "";
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
  renderSignatureAnnotations(overlay, statusEl);
  renderStampAnnotations(overlay, statusEl);
  renderCommentAnnotations(overlay, statusEl);
  syncStampDeleteButton();
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
      scheduleSessionSave();
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
      scheduleSessionSave();
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
    scheduleSessionSave();
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

function renderSignatureAnnotations(overlay, statusEl) {
  const current = state.signatureAnnotations.filter(
    (annotation) => annotation.pageNumber === state.currentPage
  );
  current.forEach((annotation) => {
    const variant = getSignatureVariant(annotation.fontId);
    const wrapper = document.createElement("div");
    wrapper.className = "signature-annotation";
    wrapper.tabIndex = 0;
    wrapper.dataset.annotationId = annotation.id;
    wrapper.dataset.role = "signature-annotation";
    wrapper.style.left = `${annotation.x}px`;
    wrapper.style.top = `${annotation.y}px`;
    wrapper.style.width = `${annotation.width}px`;
    wrapper.style.height = `${annotation.height}px`;
    wrapper.style.fontFamily = variant.cssFamily;
    wrapper.style.letterSpacing = `${(annotation.height * (variant.letterSpacing ?? 0)).toFixed(
      2
    )}px`;

    const text = document.createElement("div");
    text.className = "signature-text";
    text.textContent = annotation.text;
    const fontSize = fitSignatureFontSize(
      annotation.text,
      variant.cssFamily,
      annotation.width,
      annotation.height,
      variant.letterSpacing ?? 0
    );
    text.style.fontSize = `${fontSize}px`;
    text.style.transform = `translateY(${(annotation.height * (variant.baselineOffset ?? 0)).toFixed(
      2
    )}px)`;

    const handle = document.createElement("div");
    handle.className = "resize-handle";

    wrapper.append(text, handle);
    attachSignatureInteractions(wrapper, annotation, overlay, statusEl);
    overlay.append(wrapper);
  });
}

function renderCommentAnnotations(overlay, statusEl) {
  if (!state.commentsVisible) {
    return;
  }
  const current = state.commentAnnotations.filter(
    (annotation) => annotation.pageNumber === state.currentPage
  );
  current.forEach((annotation) => {
    const wrapper = document.createElement("div");
    wrapper.className = "comment-annotation";
    wrapper.tabIndex = 0;
    wrapper.dataset.role = "comment-annotation";
    wrapper.dataset.annotationId = annotation.id;
    wrapper.style.left = `${annotation.x}px`;
    wrapper.style.top = `${annotation.y}px`;
    wrapper.style.width = `${annotation.width}px`;
    wrapper.style.height = `${annotation.height}px`;
    wrapper.style.color = annotation.color ?? state.toolDefaults.comment.color;

    const content = document.createElement("div");
    content.className = "comment-content";
    content.contentEditable = true;
    content.spellcheck = false;
    content.textContent = annotation.text ?? state.toolDefaults.comment.text;
    content.style.fontSize = `${annotation.fontSize ?? 12}px`;

    const handle = document.createElement("div");
    handle.className = "resize-handle";

    wrapper.append(content, handle);
    attachCommentInteractions(wrapper, content, annotation, overlay, statusEl);
    overlay.append(wrapper);
  });
}

function renderStampAnnotations(overlay, statusEl) {
  const current = state.stampAnnotations.filter(
    (annotation) => annotation.pageNumber === state.currentPage
  );
  current.forEach((annotation) => {
    const wrapper = document.createElement("div");
    wrapper.className = "stamp-annotation";
    wrapper.tabIndex = 0;
    wrapper.dataset.annotationId = annotation.id;
    wrapper.dataset.role = "stamp-annotation";
    wrapper.dataset.selected =
      annotation.id === state.selectedStampId ? "true" : "false";
    wrapper.style.left = `${annotation.x}px`;
    wrapper.style.top = `${annotation.y}px`;
    wrapper.style.width = `${annotation.width}px`;
    wrapper.style.height = `${annotation.height}px`;
    wrapper.style.color = annotation.color ?? state.toolDefaults.stamp.color;
    wrapper.style.fontSize = `${annotation.fontSize ?? 20}px`;

    const text = document.createElement("div");
    text.className = "stamp-text";
    text.textContent = annotation.text ?? state.toolDefaults.stamp.text;

    const handle = document.createElement("div");
    handle.className = "resize-handle";

    wrapper.append(text, handle);
    attachStampInteractions(wrapper, annotation, overlay, statusEl);
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
      scheduleSessionSave();
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
      scheduleSessionSave();
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
    scheduleSessionSave();
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
    scheduleSessionSave();
    setStatus(statusEl, "Text removed.");
  });
}

function attachSignatureInteractions(wrapper, annotation, overlay, statusEl) {
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
      wrapper.style.left = `${annotation.x}px`;
      wrapper.style.top = `${annotation.y}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scheduleSessionSave();
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
      annotation.width = clamp(originWidth + dx, 80, bounds.width - annotation.x);
      annotation.height = clamp(originHeight + dy, 40, bounds.height - annotation.y);
      wrapper.style.width = `${annotation.width}px`;
      wrapper.style.height = `${annotation.height}px`;
      const variant = getSignatureVariant(annotation.fontId);
      const textEl = wrapper.querySelector(".signature-text");
      if (textEl) {
        const fontSize = fitSignatureFontSize(
          annotation.text,
          variant.cssFamily,
          annotation.width,
          annotation.height,
          variant.letterSpacing ?? 0
        );
        textEl.style.fontSize = `${fontSize}px`;
        textEl.style.transform = `translateY(${(
          annotation.height * (variant.baselineOffset ?? 0)
        ).toFixed(2)}px)`;
      }
      wrapper.style.letterSpacing = `${(
        annotation.height * (variant.letterSpacing ?? 0)
      ).toFixed(2)}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scheduleSessionSave();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  wrapper.addEventListener("pointerdown", (event) => {
    if (event.target.classList.contains("resize-handle")) {
      startResize(event);
      return;
    }
    wrapper.focus();
    startMove(event);
  });

  wrapper.addEventListener("keydown", (event) => {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }
    state.signatureAnnotations = state.signatureAnnotations.filter(
      (item) => item.id !== annotation.id
    );
    wrapper.remove();
    scheduleSessionSave();
    setStatus(statusEl, "Signature removed.");
  });
}

function attachCommentInteractions(wrapper, content, annotation, overlay, statusEl) {
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
      wrapper.style.left = `${annotation.x}px`;
      wrapper.style.top = `${annotation.y}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scheduleSessionSave();
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
      annotation.width = clamp(originWidth + dx, 120, bounds.width - annotation.x);
      annotation.height = clamp(originHeight + dy, 60, bounds.height - annotation.y);
      wrapper.style.width = `${annotation.width}px`;
      wrapper.style.height = `${annotation.height}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scheduleSessionSave();
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

  content.addEventListener("input", () => {
    annotation.text = content.textContent ?? "";
    scheduleSessionSave();
  });

  wrapper.addEventListener("keydown", (event) => {
    if (event.key !== "Backspace" && event.key !== "Delete") {
      return;
    }
    state.commentAnnotations = state.commentAnnotations.filter(
      (item) => item.id !== annotation.id
    );
    wrapper.remove();
    scheduleSessionSave();
    setStatus(statusEl, "Comment removed.");
  });
}

function attachStampInteractions(wrapper, annotation, overlay, statusEl) {
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
      wrapper.style.left = `${annotation.x}px`;
      wrapper.style.top = `${annotation.y}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scheduleSessionSave();
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
      annotation.width = clamp(originWidth + dx, 120, bounds.width - annotation.x);
      annotation.height = clamp(originHeight + dy, 40, bounds.height - annotation.y);
      wrapper.style.width = `${annotation.width}px`;
      wrapper.style.height = `${annotation.height}px`;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      scheduleSessionSave();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  wrapper.addEventListener("pointerdown", (event) => {
    state.selectedStampId = annotation.id;
    overlay.querySelectorAll(".stamp-annotation").forEach((item) => {
      item.dataset.selected = item === wrapper ? "true" : "false";
    });
    syncStampDeleteButton();
    if (event.target.classList.contains("resize-handle")) {
      startResize(event);
      return;
    }
    startMove(event);
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
  shapeLayer,
  pageLabel,
  pageList,
  applyButton,
  sessionData = null
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
  state.currentFileName = "";
  state.currentFileHash = "";
  state.pageOrder = Array.from({ length: state.pageCount }, (_, index) => index + 1);
  state.imageAnnotations = [];
  state.imageAssets = [];
  state.textAnnotations = [];
  state.selectedTextId = null;
  state.selectedTextElement = null;
  state.drawAnnotations = [];
  state.highlightAnnotations = [];
  state.shapeAnnotations = [];
  state.shapeDraft = null;
  state.signatureAnnotations = [];
  state.commentAnnotations = [];
  state.stampAnnotations = [];
  state.selectedStampId = null;
  state.commentsVisible = true;
  state.pageProperties = {
    rotations: {},
    hidden: new Set(),
    deleted: new Set(),
    duplicates: {}
  };
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
    comment: { color: "#111111", text: "Comment" },
    stamp: { text: "APPROVED", color: "#111111" },
    shapes: {
      shapeType: "rect",
      strokeColor: "#2563eb",
      strokeWidth: 3,
      fillColor: "",
      opacity: 1
    },
    signature: { name: "" }
  };
  state.signaturePlacementMode = "full";
  if (sessionData?.annotations) {
    applySessionAnnotations(sessionData.annotations);
  }
  renderPageList(pageList, applyButton);
  updatePageLabel(pageLabel);
  await refreshViewer(
    canvas,
    overlay,
    drawLayer,
    highlightLayer,
    shapeLayer,
    pageLabel,
    statusEl
  );
  setStatus(statusEl, "PDF loaded successfully.");
}

export function initApp(root) {
  if (!root) {
    throw new Error("App root element not found");
  }
  applyTheme(getPreferredTheme());
  document.documentElement.dataset.commentsVisible = "true";

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
    state.paneOpen.settings = false;
    if (toolId !== "shapes") {
      state.shapeDraft = null;
    }
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

  const recentPanel = document.createElement("section");
  recentPanel.className = "recent-panel";
  const recentTitle = document.createElement("p");
  recentTitle.className = "section-title";
  recentTitle.textContent = "Recent Documents";
  const recentCopy = document.createElement("p");
  recentCopy.className = "muted";
  recentCopy.textContent = "Recent documents are stored locally on this device only.";
  const rememberHistoryWrap = document.createElement("label");
  rememberHistoryWrap.className = "remember";
  const rememberHistoryToggle = document.createElement("input");
  rememberHistoryToggle.type = "checkbox";
  rememberHistoryToggle.checked = getRememberHistoryPreference();
  state.sessionHistoryEnabled = rememberHistoryToggle.checked;
  const rememberHistoryText = document.createElement("span");
  rememberHistoryText.textContent = "Remember recent documents";
  rememberHistoryWrap.append(rememberHistoryToggle, rememberHistoryText);
  const recentList = document.createElement("ul");
  recentList.className = "recent-list";
  recentList.dataset.role = "recent-list";
  const clearHistoryButton = createButton("Clear History", async () => {
    state.sessionEntries = [];
    await clearSessionHistory();
    renderSessionList();
    setStatus(status, "History cleared.");
  });
  clearHistoryButton.className = "secondary";
  const resumeInput = document.createElement("input");
  resumeInput.type = "file";
  resumeInput.accept = "application/pdf";
  resumeInput.hidden = true;
  resumeInput.dataset.role = "resume-input";
  let pendingSession = null;

  const renderSessionList = () => {
    recentList.innerHTML = "";
    if (!state.sessionEntries.length) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "No recent documents yet.";
      recentList.append(empty);
      return;
    }
    state.sessionEntries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "recent-item";
      const label = document.createElement("div");
      label.className = "recent-meta";
      const name = document.createElement("span");
      name.textContent = entry.fileName;
      const time = document.createElement("span");
      time.className = "muted";
      time.textContent = new Date(entry.lastOpened).toLocaleString();
      label.append(name, time);
      const actionsRow = document.createElement("div");
      actionsRow.className = "recent-actions";
      const openButton = createButton("Open", () => {
        pendingSession = entry;
        resumeInput.click();
      });
      const removeButton = createButton("Remove", async () => {
        state.sessionEntries = state.sessionEntries.filter(
          (itemEntry) => itemEntry.id !== entry.id
        );
        await saveSessionHistory(state.sessionEntries);
        renderSessionList();
        setStatus(status, "Removed from history.");
      });
      actionsRow.append(openButton, removeButton);
      item.append(label, actionsRow);
      recentList.append(item);
    });
  };

  window.addEventListener("session-history-updated", renderSessionList);

  resumeInput.addEventListener("change", async () => {
    const file = resumeInput.files?.[0];
    if (!file || !pendingSession) {
      return;
    }
    if (!isPdfFile(file)) {
      setStatus(status, "Only PDF files are supported.", true);
      return;
    }
    try {
      const bytes = await readFileAsArrayBuffer(file);
      const hash = await hashBytes(bytes);
      if (hash !== pendingSession.fileHash) {
        setStatus(status, "Selected file does not match this session. Please reselect.", true);
        return;
      }
      state.currentFileName = pendingSession.fileName;
      state.currentFileHash = pendingSession.fileHash;
      await loadPdfBytes(
        bytes,
        status,
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        pageList,
        applyReorderButton,
        pendingSession
      );
      renderAssetList(assetList, status);
      renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
      renderAnnotations(overlay, status);
      setStatus(status, "Session restored.");
    } catch (error) {
      setStatus(status, `Failed to restore session: ${error.message}`, true);
    } finally {
      resumeInput.value = "";
      pendingSession = null;
    }
  });

  rememberHistoryToggle.addEventListener("change", () => {
    state.sessionHistoryEnabled = rememberHistoryToggle.checked;
    setRememberHistoryPreference(rememberHistoryToggle.checked);
  });

  recentPanel.append(
    recentTitle,
    rememberHistoryWrap,
    recentCopy,
    recentList,
    clearHistoryButton,
    resumeInput
  );

  const exportButton = createButton("Export PDF", async () => {
    if (!state.currentBytes) {
      setStatus(status, "Load a PDF before exporting.", true);
      return;
    }
    try {
      const exportPageOrder = buildExportPageOrder();
      if (!exportPageOrder.length) {
        setStatus(status, "No visible pages to export.", true);
        return;
      }
      let exportBytes = await applyPageProperties(
        state.currentBytes,
        exportPageOrder,
        state.pageProperties.rotations
      );
      const exportHighlights = remapAnnotationsForExport(
        state.highlightAnnotations,
        exportPageOrder
      );
      if (exportHighlights.length > 0) {
        exportBytes = await applyHighlightAnnotations(exportBytes, exportHighlights);
      }
      const exportImages = remapAnnotationsForExport(
        state.imageAnnotations,
        exportPageOrder
      );
      if (exportImages.length > 0) {
        exportBytes = await applyImageAnnotations(exportBytes, state.imageAssets, exportImages);
      }
      const exportTextAnnotations = remapAnnotationsForExport(
        buildExportTextAnnotations(),
        exportPageOrder
      );
      if (exportTextAnnotations.length > 0) {
        exportBytes = await applyTextAnnotations(exportBytes, exportTextAnnotations);
      }
      const exportSignatures = remapAnnotationsForExport(
        state.signatureAnnotations,
        exportPageOrder
      );
      if (exportSignatures.length > 0) {
        exportBytes = await applySignatureAnnotations(exportBytes, exportSignatures);
      }
      const exportDraws = remapAnnotationsForExport(state.drawAnnotations, exportPageOrder);
      if (exportDraws.length > 0) {
        exportBytes = await applyDrawAnnotations(exportBytes, exportDraws);
      }
      const exportShapes = remapAnnotationsForExport(state.shapeAnnotations, exportPageOrder);
      if (exportShapes.length > 0) {
        exportBytes = await applyShapeAnnotations(exportBytes, exportShapes);
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

  const settingsButton = createButton("Settings", () => {
    state.paneOpen.settings = !state.paneOpen.settings;
    renderPanes();
  });
  settingsButton.dataset.role = "settings-button";

  actions.append(exportButton, settingsButton);

  const commentToggle = createButton("Comments: On", () => {
    state.commentsVisible = !state.commentsVisible;
    document.documentElement.dataset.commentsVisible = state.commentsVisible ? "true" : "false";
    commentToggle.textContent = state.commentsVisible ? "Comments: On" : "Comments: Off";
    renderAnnotations(overlay, status);
  });
  commentToggle.className = "secondary";
  commentToggle.dataset.role = "comments-toggle";

  actions.insertBefore(commentToggle, settingsButton);

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
        shapeLayer,
        pageLabel,
        pageList,
        applyReorderButton
      );
      await trackSessionOnOpen("Restored Session", stored, rememberHistoryToggle.checked);
      renderSessionList();
      setStatus(status, "Restored last session.");
    } catch (error) {
      setStatus(status, `Failed to restore session: ${error.message}`, true);
    }
  });

  const signatureGroup = document.createElement("section");
  signatureGroup.className = "panel";
  const signatureTitle = document.createElement("p");
  signatureTitle.className = "section-title";
  signatureTitle.textContent = "Signature";
  const clearSignatureButton = createButton("Clear Saved Signature", async () => {
    await clearSignatureProfile();
    state.signatureProfile = null;
    if (signatureUi) {
      signatureUi.nameInput.value = "";
      signatureUi.initialsInput.value = "";
      signatureUi.renderVariants();
    }
    setStatus(status, "Signature cleared.");
  });
  clearSignatureButton.className = "secondary";
  signatureGroup.append(signatureTitle, clearSignatureButton);

  settingsPanel.append(rememberWrap, restoreButton, themeGroup, installGroup, signatureGroup);

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
        shapeLayer,
        pageLabel,
        pageList,
        applyReorderButton
      );
      await trackSessionOnOpen(file.name, bytes, rememberHistoryToggle.checked);
      renderSessionList();
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
        shapeLayer,
        pageLabel,
        pageList,
        applyReorderButton
      );
      setStatus(status, "PDFs merged successfully.");
      await trackSessionOnOpen("Merged.pdf", mergedBytes, rememberHistoryToggle.checked);
      renderSessionList();
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

  const shapeLayer = createSvgElement("svg");
  shapeLayer.classList.add("ink-layer", "shape-layer");
  shapeLayer.dataset.role = "shape-layer";
  shapeLayer.setAttribute("aria-hidden", "true");

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
  let activeShape = null;
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
    if (
      state.activeTool !== "draw" &&
      state.activeTool !== "highlight" &&
      state.activeTool !== "shapes"
    ) {
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
    } else if (state.activeTool === "shapes") {
      const shapeType = state.toolDefaults.shapes.shapeType;
      if (shapeType === "polygon" || shapeType === "cloud") {
        if (!state.shapeDraft || state.shapeDraft.shapeType !== shapeType) {
          state.shapeDraft = {
            id: createId("shape"),
            pageNumber: state.currentPage,
            shapeType,
            geometry: { points: [start] },
            style: { ...state.toolDefaults.shapes },
            previewPoint: start,
            overlayWidth: bounds.width,
            overlayHeight: bounds.height
          };
        } else {
          state.shapeDraft.geometry.points.push(start);
        }
        renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
        return;
      }
      activeShape = {
        id: createId("shape"),
        pageNumber: state.currentPage,
        shapeType,
        geometry: {
          x: start.x,
          y: start.y,
          width: 0,
          height: 0,
          points: [start, start]
        },
        style: { ...state.toolDefaults.shapes },
        overlayWidth: bounds.width,
        overlayHeight: bounds.height
      };
      state.shapeDraft = activeShape;
    }
    renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);

    const onMove = (moveEvent) => {
      if (state.activeTool === "draw" && activeDraw) {
        activeDraw.points.push(getOverlayPoint(moveEvent, overlay));
        renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
      }
      if (state.activeTool === "highlight" && activeHighlight) {
        const current = getOverlayPoint(moveEvent, overlay);
        activeHighlight.x = Math.min(start.x, current.x);
        activeHighlight.y = Math.min(start.y, current.y);
        activeHighlight.width = Math.abs(current.x - start.x);
        activeHighlight.height = Math.abs(current.y - start.y);
        renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
      }
      if (state.activeTool === "shapes") {
        const current = getOverlayPoint(moveEvent, overlay);
        if (activeShape && activeShape.geometry) {
          const minX = Math.min(start.x, current.x);
          const minY = Math.min(start.y, current.y);
          const maxX = Math.max(start.x, current.x);
          const maxY = Math.max(start.y, current.y);
          if (activeShape.shapeType === "line" || activeShape.shapeType === "arrow") {
            activeShape.geometry.points = [start, current];
          } else {
            activeShape.geometry.x = minX;
            activeShape.geometry.y = minY;
            activeShape.geometry.width = maxX - minX;
            activeShape.geometry.height = maxY - minY;
          }
          renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
        }
        if (
          state.shapeDraft &&
          (state.shapeDraft.shapeType === "polygon" ||
            state.shapeDraft.shapeType === "cloud")
        ) {
          state.shapeDraft.previewPoint = current;
          renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
        }
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
      if (activeShape && activeShape.shapeType !== "polygon" && activeShape.shapeType !== "cloud") {
        const isLine = activeShape.shapeType === "line" || activeShape.shapeType === "arrow";
        const hasSize = isLine
          ? activeShape.geometry.points?.length === 2
          : activeShape.geometry.width > 2 && activeShape.geometry.height > 2;
        if (hasSize) {
          state.shapeAnnotations = [...state.shapeAnnotations, activeShape];
        }
        state.shapeDraft = null;
        activeShape = null;
      }
      renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
      scheduleSessionSave();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  overlay.addEventListener("click", (event) => {
    if (!state.currentBytes) {
      if (
        state.activeTool === "text" ||
        state.activeTool === "signature" ||
        state.activeTool === "comment" ||
        state.activeTool === "stamp"
      ) {
        setStatus(status, "Load a PDF before adding annotations.", true);
      }
      return;
    }
    if (state.activeTool === "text") {
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
      scheduleSessionSave();
      return;
    }
    if (state.activeTool === "signature") {
      if (
        event.target.closest(".signature-annotation") ||
        event.target.closest(".text-annotation") ||
        event.target.closest(".annotation")
      ) {
        return;
      }
      if (!state.signatureProfile?.name || !state.signatureProfile?.fontId) {
        setStatus(status, "Create and select a signature style first.", true);
        return;
      }
      const rect = overlay.getBoundingClientRect();
      const overlayWidth = rect.width || overlay.offsetWidth;
      const overlayHeight = rect.height || overlay.offsetHeight;
      if (!overlayWidth || !overlayHeight) {
        setStatus(status, "Overlay not ready yet. Try again.", true);
        return;
      }
      const signatureText =
        state.signaturePlacementMode === "initials" && state.signatureProfile.initials
          ? state.signatureProfile.initials
          : state.signatureProfile.name;
      const width = 220;
      const height = 72;
      const x = clamp(event.clientX - rect.left - width / 2, 0, overlayWidth - width);
      const y = clamp(event.clientY - rect.top - height / 2, 0, overlayHeight - height);
      const annotation = {
        id: createId("signature"),
        pageNumber: state.currentPage,
        x,
        y,
        width,
        height,
        text: signatureText,
        fontId: state.signatureProfile.fontId,
        overlayWidth,
        overlayHeight
      };
      state.signatureAnnotations = [...state.signatureAnnotations, annotation];
      renderAnnotations(overlay, status);
      scheduleSessionSave();
      return;
    }
    if (state.activeTool === "comment") {
      if (event.target.closest(".comment-annotation")) {
        return;
      }
      const rect = overlay.getBoundingClientRect();
      const overlayWidth = rect.width || overlay.offsetWidth;
      const overlayHeight = rect.height || overlay.offsetHeight;
      if (!overlayWidth || !overlayHeight) {
        setStatus(status, "Overlay not ready yet. Try again.", true);
        return;
      }
      const width = 180;
      const height = 80;
      const x = clamp(event.clientX - rect.left, 0, overlayWidth - width);
      const y = clamp(event.clientY - rect.top, 0, overlayHeight - height);
      const annotation = {
        id: createId("comment"),
        pageNumber: state.currentPage,
        x,
        y,
        width,
        height,
        text: state.toolDefaults.comment.text,
        color: state.toolDefaults.comment.color,
        fontSize: 12,
        overlayWidth,
        overlayHeight
      };
      state.commentAnnotations = [...state.commentAnnotations, annotation];
      renderAnnotations(overlay, status);
      scheduleSessionSave();
      return;
    }
    if (state.activeTool === "stamp") {
      if (event.target.closest(".stamp-annotation")) {
        return;
      }
      const rect = overlay.getBoundingClientRect();
      const overlayWidth = rect.width || overlay.offsetWidth;
      const overlayHeight = rect.height || overlay.offsetHeight;
      if (!overlayWidth || !overlayHeight) {
        setStatus(status, "Overlay not ready yet. Try again.", true);
        return;
      }
      const width = 200;
      const height = 60;
      const x = clamp(event.clientX - rect.left, 0, overlayWidth - width);
      const y = clamp(event.clientY - rect.top, 0, overlayHeight - height);
      const annotation = {
        id: createId("stamp"),
        pageNumber: state.currentPage,
        x,
        y,
        width,
        height,
        text: state.toolDefaults.stamp.text,
        color: state.toolDefaults.stamp.color,
        fontSize: 20,
        overlayWidth,
        overlayHeight
      };
      state.stampAnnotations = [...state.stampAnnotations, annotation];
      state.selectedStampId = annotation.id;
      renderAnnotations(overlay, status);
      scheduleSessionSave();
    }
  });

  overlay.addEventListener("pointermove", (event) => {
    if (state.activeTool !== "shapes") {
      return;
    }
    if (
      state.shapeDraft &&
      (state.shapeDraft.shapeType === "polygon" || state.shapeDraft.shapeType === "cloud")
    ) {
      state.shapeDraft.previewPoint = getOverlayPoint(event, overlay);
      renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
    }
  });

  overlay.addEventListener("dblclick", (event) => {
    if (state.activeTool !== "shapes") {
      return;
    }
    if (
      !state.shapeDraft ||
      (state.shapeDraft.shapeType !== "polygon" && state.shapeDraft.shapeType !== "cloud")
    ) {
      return;
    }
    event.preventDefault();
    const points = state.shapeDraft.geometry.points ?? [];
    if (points.length < 3) {
      return;
    }
    const finalized = {
      ...state.shapeDraft,
      previewPoint: null
    };
    state.shapeAnnotations = [...state.shapeAnnotations, finalized];
    state.shapeDraft = null;
    renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
    scheduleSessionSave();
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
    scheduleSessionSave();
    setStatus(status, "Image placed on page.");
  });

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "canvas-wrap";
  canvasWrap.append(canvas, highlightLayer, shapeLayer, overlay, drawLayer);

  const nav = document.createElement("div");
  nav.className = "nav";
  const prevButton = createButton("Previous", async () => {
    const nextPage = getNeighborVisiblePage(state.currentPage, -1);
    if (nextPage !== state.currentPage) {
      state.currentPage = nextPage;
      await refreshViewer(
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        status
      );
    }
  });
  const nextButton = createButton("Next", async () => {
    const nextPage = getNeighborVisiblePage(state.currentPage, 1);
    if (nextPage !== state.currentPage) {
      state.currentPage = nextPage;
      await refreshViewer(
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        status
      );
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
    scheduleSessionSave();
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
      scheduleSessionSave();
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
    scheduleSessionSave();
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
      scheduleSessionSave();
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
      const currentSignatureAnnotations = state.signatureAnnotations;
      const currentShapeAnnotations = state.shapeAnnotations;
      const currentCommentAnnotations = state.commentAnnotations;
      const currentStampAnnotations = state.stampAnnotations;
      const currentPageProperties = state.pageProperties;
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
      const remappedShapeAnnotations = currentShapeAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const remappedSignatureAnnotations = currentSignatureAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const remappedCommentAnnotations = currentCommentAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const remappedStampAnnotations = currentStampAnnotations.map((annotation) => ({
        ...annotation,
        pageNumber: pageMapping.get(annotation.pageNumber) ?? annotation.pageNumber
      }));
      const remappedRotations = {};
      Object.entries(currentPageProperties.rotations ?? {}).forEach(([page, rotation]) => {
        const mapped = pageMapping.get(Number(page));
        if (mapped) {
          remappedRotations[mapped] = rotation;
        }
      });
      const remappedHidden = new Set();
      currentPageProperties.hidden?.forEach((page) => {
        const mapped = pageMapping.get(page);
        if (mapped) {
          remappedHidden.add(mapped);
        }
      });
      const remappedDeleted = new Set();
      currentPageProperties.deleted?.forEach((page) => {
        const mapped = pageMapping.get(page);
        if (mapped) {
          remappedDeleted.add(mapped);
        }
      });
      const remappedDuplicates = {};
      Object.entries(currentPageProperties.duplicates ?? {}).forEach(([page, count]) => {
        const mapped = pageMapping.get(Number(page));
        if (mapped) {
          remappedDuplicates[mapped] = count;
        }
      });
      const reorderedBytes = await reorderPdf(state.currentBytes, state.pageOrder);
      await loadPdfBytes(
        reorderedBytes,
        status,
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        pageList,
        applyReorderButton
      );
      state.imageAssets = currentAssets;
      state.imageAnnotations = remappedImageAnnotations;
      state.textAnnotations = remappedTextAnnotations;
      state.drawAnnotations = remappedDrawAnnotations;
      state.highlightAnnotations = remappedHighlightAnnotations;
      state.shapeAnnotations = remappedShapeAnnotations;
      state.signatureAnnotations = remappedSignatureAnnotations;
      state.commentAnnotations = remappedCommentAnnotations;
      state.stampAnnotations = remappedStampAnnotations;
      state.pageProperties = {
        rotations: remappedRotations,
        hidden: remappedHidden,
        deleted: remappedDeleted,
        duplicates: remappedDuplicates
      };
      renderAssetList(assetList, status);
      renderInkLayers(drawLayer, highlightLayer, overlay, shapeLayer);
      renderAnnotations(overlay, status);
      setStatus(status, "Reorder applied.");
      scheduleSessionSave();
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

  const shapesPane = () => {
    const shapeSelect = document.createElement("select");
    [
      { label: "Rectangle", value: "rect" },
      { label: "Ellipse", value: "ellipse" },
      { label: "Line", value: "line" },
      { label: "Arrow", value: "arrow" },
      { label: "Polygon", value: "polygon" },
      { label: "Cloud", value: "cloud" }
    ].forEach((shape) => {
      const option = document.createElement("option");
      option.value = shape.value;
      option.textContent = shape.label;
      shapeSelect.append(option);
    });
    shapeSelect.value = state.toolDefaults.shapes.shapeType;
    shapeSelect.addEventListener("change", () => {
      state.toolDefaults.shapes.shapeType = shapeSelect.value;
      state.shapeDraft = null;
    });

    const strokeColor = document.createElement("input");
    strokeColor.type = "color";
    strokeColor.value = state.toolDefaults.shapes.strokeColor;
    strokeColor.addEventListener("input", () => {
      state.toolDefaults.shapes.strokeColor = strokeColor.value;
    });

    const strokeWidth = document.createElement("input");
    strokeWidth.type = "number";
    strokeWidth.min = "1";
    strokeWidth.max = "20";
    strokeWidth.value = String(state.toolDefaults.shapes.strokeWidth);
    strokeWidth.addEventListener("change", () => {
      const next = Number.parseInt(strokeWidth.value, 10);
      if (Number.isFinite(next)) {
        state.toolDefaults.shapes.strokeWidth = next;
      }
    });

    const fillToggle = document.createElement("input");
    fillToggle.type = "checkbox";
    fillToggle.checked = !!state.toolDefaults.shapes.fillColor;
    const fillColor = document.createElement("input");
    fillColor.type = "color";
    fillColor.value = state.toolDefaults.shapes.fillColor || "#ffffff";
    fillColor.disabled = !fillToggle.checked;
    fillToggle.addEventListener("change", () => {
      fillColor.disabled = !fillToggle.checked;
      state.toolDefaults.shapes.fillColor = fillToggle.checked ? fillColor.value : "";
    });
    fillColor.addEventListener("input", () => {
      if (fillToggle.checked) {
        state.toolDefaults.shapes.fillColor = fillColor.value;
      }
    });

    const opacity = document.createElement("input");
    opacity.type = "range";
    opacity.min = "0.2";
    opacity.max = "1";
    opacity.step = "0.05";
    opacity.value = String(state.toolDefaults.shapes.opacity ?? 1);
    opacity.addEventListener("input", () => {
      state.toolDefaults.shapes.opacity = Number(opacity.value);
    });

    const fillRow = document.createElement("div");
    fillRow.className = "field";
    const fillLabel = document.createElement("span");
    fillLabel.textContent = "Fill enabled";
    fillRow.append(fillLabel, fillToggle);

    return placeholderPane("Click and drag to draw a shape.", [
      createLabeledField("Shape type", shapeSelect),
      createLabeledField("Stroke color", strokeColor),
      createLabeledField("Stroke width", strokeWidth),
      fillRow,
      createLabeledField("Fill color", fillColor),
      createLabeledField("Opacity", opacity)
    ]);
  };

  const commentPane = () => {
    const text = document.createElement("input");
    text.type = "text";
    text.value = state.toolDefaults.comment.text;
    text.addEventListener("input", () => {
      state.toolDefaults.comment.text = text.value || "Comment";
    });
    const color = document.createElement("input");
    color.type = "color";
    color.value = state.toolDefaults.comment.color;
    color.addEventListener("input", () => {
      state.toolDefaults.comment.color = color.value;
    });
    return placeholderPane("Click on the page to add a comment.", [
      createLabeledField("Comment text", text),
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
    const deleteButton = createButton("Delete selected stamp", () => {
      if (!state.selectedStampId) {
        return;
      }
      state.stampAnnotations = state.stampAnnotations.filter(
        (item) => item.id !== state.selectedStampId
      );
      state.selectedStampId = null;
      renderAnnotations(overlay, status);
      syncStampDeleteButton();
      scheduleSessionSave();
      setStatus(status, "Stamp removed.");
    });
    stampDeleteButton = deleteButton;
    syncStampDeleteButton();
    return placeholderPane("Stamp presets are stored locally.", [
      createLabeledField("Stamp text", text),
      createLabeledField("Stamp color", color),
      deleteButton
    ]);
  };

  const pagePropertiesPane = () => {
    const panel = document.createElement("div");
    panel.className = "panel";

    const info = document.createElement("p");
    info.className = "muted";

    const rotationValue = document.createElement("span");
    rotationValue.className = "muted";

    const rotateLeft = createButton("Rotate Left", async () => {
      const current = state.pageProperties.rotations[state.currentPage] ?? 0;
      state.pageProperties.rotations[state.currentPage] = (current - 90 + 360) % 360;
      updatePagePropertiesUi();
      await refreshViewer(
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        status
      );
    });
    const rotateRight = createButton("Rotate Right", async () => {
      const current = state.pageProperties.rotations[state.currentPage] ?? 0;
      state.pageProperties.rotations[state.currentPage] = (current + 90) % 360;
      updatePagePropertiesUi();
      await refreshViewer(
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        status
      );
    });

    const hideToggle = document.createElement("input");
    hideToggle.type = "checkbox";
    hideToggle.addEventListener("change", async () => {
      if (hideToggle.checked) {
        state.pageProperties.hidden.add(state.currentPage);
      } else {
        state.pageProperties.hidden.delete(state.currentPage);
      }
      updatePagePropertiesUi();
      await refreshViewer(
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        status
      );
    });
    const hideRow = createLabeledField("Hide in preview", hideToggle);

    const deleteButton = createButton("Delete Page", async () => {
      const confirmed = window.confirm("Delete this page from the export?");
      if (!confirmed) {
        return;
      }
      state.pageProperties.deleted.add(state.currentPage);
      state.pageProperties.hidden.delete(state.currentPage);
      updatePagePropertiesUi();
      await refreshViewer(
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        status
      );
    });
    deleteButton.className = "secondary";

    const restoreButton = createButton("Restore Page", async () => {
      state.pageProperties.deleted.delete(state.currentPage);
      updatePagePropertiesUi();
      await refreshViewer(
        canvas,
        overlay,
        drawLayer,
        highlightLayer,
        shapeLayer,
        pageLabel,
        status
      );
    });
    restoreButton.className = "secondary";

    const duplicateCount = document.createElement("span");
    duplicateCount.className = "muted";

    const duplicateButton = createButton("Duplicate Page", () => {
      const current = state.pageProperties.duplicates[state.currentPage] ?? 0;
      state.pageProperties.duplicates[state.currentPage] = current + 1;
      updatePagePropertiesUi();
      setStatus(status, "Page duplicated for export.");
    });

    const removeDuplicateButton = createButton("Remove Duplicate", () => {
      const current = state.pageProperties.duplicates[state.currentPage] ?? 0;
      if (current <= 0) {
        return;
      }
      const next = current - 1;
      if (next === 0) {
        delete state.pageProperties.duplicates[state.currentPage];
      } else {
        state.pageProperties.duplicates[state.currentPage] = next;
      }
      updatePagePropertiesUi();
    });
    removeDuplicateButton.className = "secondary";

    const updatePagePropertiesUi = () => {
      info.textContent = `Page ${state.currentPage}`;
      const rotation = state.pageProperties.rotations[state.currentPage] ?? 0;
      rotationValue.textContent = `Rotation: ${rotation}°`;
      const isHidden = state.pageProperties.hidden.has(state.currentPage);
      const isDeleted = state.pageProperties.deleted.has(state.currentPage);
      hideToggle.checked = isHidden;
      hideToggle.disabled = isDeleted;
      deleteButton.disabled = isDeleted;
      restoreButton.hidden = !isDeleted;
      const duplicates = state.pageProperties.duplicates[state.currentPage] ?? 0;
      duplicateCount.textContent = `Duplicates queued: ${duplicates}`;
      removeDuplicateButton.disabled = duplicates === 0;
    };

    pagePropertiesUi = { update: updatePagePropertiesUi };
    updatePagePropertiesUi();

    panel.append(
      info,
      rotationValue,
      rotateLeft,
      rotateRight,
      hideRow,
      deleteButton,
      restoreButton,
      duplicateCount,
      duplicateButton,
      removeDuplicateButton,
      reorderGroup
    );
    return panel;
  };

  let signatureUi = null;
  const signaturePane = () => {
    const panel = document.createElement("div");
    panel.className = "panel";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Full name";

    const initialsInput = document.createElement("input");
    initialsInput.type = "text";
    initialsInput.placeholder = "Initials (optional)";

    const fullGroupTitle = document.createElement("p");
    fullGroupTitle.className = "section-title";
    fullGroupTitle.textContent = "Full Name Styles";
    const fullGrid = document.createElement("div");
    fullGrid.className = "signature-grid";

    const initialsGroupTitle = document.createElement("p");
    initialsGroupTitle.className = "section-title";
    initialsGroupTitle.textContent = "Initials Styles";
    const initialsGrid = document.createElement("div");
    initialsGrid.className = "signature-grid";

    const placementSelect = document.createElement("select");
    const fullOption = document.createElement("option");
    fullOption.value = "full";
    fullOption.textContent = "Place full name";
    const initialsOption = document.createElement("option");
    initialsOption.value = "initials";
    initialsOption.textContent = "Place initials";
    placementSelect.append(fullOption, initialsOption);
    placementSelect.value = state.signaturePlacementMode;
    placementSelect.addEventListener("change", () => {
      state.signaturePlacementMode = placementSelect.value;
    });

    const legalCopy = document.createElement("p");
    legalCopy.className = "muted";
    legalCopy.textContent =
      "This adds a visual signature only. It does not apply cryptographic or digital signing.";

    const updateSelection = () => {
      const selectedId = state.signatureProfile?.fontId;
      const updateGrid = (grid) => {
        Array.from(grid.children).forEach((item) => {
          item.dataset.selected =
            selectedId && item.dataset.fontId === selectedId ? "true" : "false";
        });
      };
      updateGrid(fullGrid);
      updateGrid(initialsGrid);
      if (state.signatureProfile?.initials) {
        initialsOption.disabled = false;
      } else {
        initialsOption.disabled = true;
        placementSelect.value = "full";
        state.signaturePlacementMode = "full";
      }
    };

    const renderVariants = () => {
      const name = nameInput.value.trim();
      const initials = initialsInput.value.trim();
      fullGrid.innerHTML = "";
      initialsGrid.innerHTML = "";
      if (!name) {
        const hint = document.createElement("p");
        hint.className = "muted";
        hint.textContent = "Enter a name to generate signatures.";
        fullGrid.append(hint);
        initialsGroupTitle.hidden = true;
        initialsGrid.hidden = true;
        updateSelection();
        return;
      }

      SIGNATURE_VARIANTS.forEach((variant) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "signature-option";
        button.dataset.fontId = variant.id;
        button.style.fontFamily = variant.cssFamily;
        button.style.letterSpacing = `${(16 * (variant.letterSpacing ?? 0)).toFixed(2)}px`;
        button.textContent = name;
        button.addEventListener("click", async () => {
          state.signatureProfile = {
            name,
            initials: initials || undefined,
            fontId: variant.id
          };
          await saveSignatureProfile(state.signatureProfile);
          updateSelection();
        });
        fullGrid.append(button);
      });

      if (initials) {
        initialsGroupTitle.hidden = false;
        initialsGrid.hidden = false;
        SIGNATURE_VARIANTS.forEach((variant) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "signature-option";
          button.dataset.fontId = variant.id;
          button.style.fontFamily = variant.cssFamily;
          button.style.letterSpacing = `${(16 * (variant.letterSpacing ?? 0)).toFixed(2)}px`;
          button.textContent = initials;
          button.addEventListener("click", async () => {
            state.signatureProfile = {
              name,
              initials,
              fontId: variant.id
            };
            await saveSignatureProfile(state.signatureProfile);
            updateSelection();
          });
          initialsGrid.append(button);
        });
      } else {
        initialsGroupTitle.hidden = true;
        initialsGrid.hidden = true;
      }
      updateSelection();
    };

    nameInput.addEventListener("input", renderVariants);
    initialsInput.addEventListener("input", renderVariants);

    signatureUi = {
      nameInput,
      initialsInput,
      fullGrid,
      initialsGrid,
      initialsGroupTitle,
      placementSelect,
      renderVariants,
      updateSelection
    };

    panel.append(
      createLabeledField("Full name", nameInput),
      createLabeledField("Initials", initialsInput),
      fullGroupTitle,
      fullGrid,
      initialsGroupTitle,
      initialsGrid,
      createLabeledField("Placement", placementSelect),
      legalCopy
    );
    renderVariants();
    return panel;
  };

  const splitPane = () => {
    const panel = document.createElement("div");
    panel.className = "panel";

    const modeSelect = document.createElement("select");
    [
      { label: "Split by page ranges", value: "range" },
      { label: "Extract selected pages", value: "pages" }
    ].forEach((mode) => {
      const option = document.createElement("option");
      option.value = mode.value;
      option.textContent = mode.label;
      modeSelect.append(option);
    });

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "1-3, 4-7";

    const hint = document.createElement("p");
    hint.className = "muted";
    hint.textContent = "Use commas to separate ranges.";

    const results = document.createElement("div");
    results.className = "split-results";

    const updateHint = () => {
      if (modeSelect.value === "range") {
        input.placeholder = "1-3, 4-7";
        hint.textContent = "Each range becomes a new PDF.";
      } else {
        input.placeholder = "1, 3, 5-7";
        hint.textContent = "Selected pages will be combined into one PDF.";
      }
    };
    updateHint();
    modeSelect.addEventListener("change", updateHint);

    const splitButton = createButton("Split", async () => {
      if (!state.currentBytes) {
        setStatus(status, "Load a PDF before splitting.", true);
        return;
      }
      const mode = modeSelect.value;
      const { groups, error } = parsePageGroups(
        input.value || "",
        mode === "range" ? "range" : "pages",
        state.pageCount
      );
      if (error) {
        setStatus(status, error, true);
        return;
      }
      try {
        const outputs = await splitPdf(state.currentBytes, groups);
        results.innerHTML = "";
        outputs.forEach((bytes, index) => {
          const row = document.createElement("div");
          row.className = "split-row";
          const label = document.createElement("span");
          label.textContent =
            mode === "range" ? `Range ${index + 1}` : "Extracted Pages";
          const download = createButton("Download", () => {
            const name =
              mode === "range" ? `split-${index + 1}.pdf` : "extracted-pages.pdf";
            downloadPdfBytes(bytes, name);
          });
          download.className = "secondary";
          row.append(label, download);
          results.append(row);
        });
        setStatus(status, "Split ready. Download each result.");
      } catch (error) {
        setStatus(status, `Split failed: ${error.message}`, true);
      }
    }, "primary");

    panel.append(
      createLabeledField("Split mode", modeSelect),
      createLabeledField("Pages", input),
      hint,
      splitButton,
      results
    );

    return panel;
  };

  const panes = new Map();
  panes.set("text", createPane("text", "Text", textToolGroup));
  panes.set("image", createPane("image", "Images", assetGroup));
  panes.set("draw", createPane("draw", "Draw", drawPane()));
  panes.set("highlight", createPane("highlight", "Highlight", highlightPane()));
  panes.set("shapes", createPane("shapes", "Shapes", shapesPane()));
  panes.set("comment", createPane("comment", "Comment", commentPane()));
  panes.set("stamp", createPane("stamp", "Stamp", stampPane()));
  panes.set("page-properties", createPane("page-properties", "Page Properties", pagePropertiesPane()));
  panes.set("signature", createPane("signature", "Signature", signaturePane()));
  panes.set("split", createPane("split", "Split", splitPane()));
  panes.set("settings", createPane("settings", "Settings", settingsPanel));

  renderPanes = () => {
    paneRoot.innerHTML = "";
    const activePaneId = state.paneOpen.settings
      ? "settings"
      : state.activeTool !== "select" && state.paneOpen[state.activeTool]
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

  topBar.append(brand, fileActions, toolBar, actions);

  setActiveTool("select");
  renderPanes();

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setActiveTool("select");
      renderPanes();
    }
  });

  ensureSignatureFontsLoaded();
  loadSignatureProfile().then((profile) => {
    if (profile) {
      state.signatureProfile = profile;
      if (signatureUi) {
        signatureUi.nameInput.value = profile.name ?? "";
        signatureUi.initialsInput.value = profile.initials ?? "";
        signatureUi.renderVariants();
      }
    }
  });
  loadSessionHistory().then((entries) => {
    if (state.sessionEntries.length === 0) {
      state.sessionEntries = entries ?? [];
      renderSessionList();
    }
  });

  container.append(topBar, trustBox, status, recentPanel, workspace);
  root.append(container);
}
