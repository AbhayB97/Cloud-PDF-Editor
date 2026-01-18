import "fake-indexeddb/auto";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { clearSessionHistory } from "../src/storage.js";

vi.mock("../src/pdfService.js", () => {
  return {
    isPdfBytes: () => true,
    isPdfFile: () => true,
    loadPdfDocument: async () => ({ numPages: 2 }),
    mergePdfs: async (bytes) => bytes,
    readFileAsArrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer,
    renderPageToCanvas: async (_doc, _page, canvas) => {
      canvas.width = 600;
      canvas.height = 800;
    },
    reorderPdf: async (bytes) => bytes,
    applyImageAnnotations: async (bytes) => bytes,
    applyPageProperties: async (bytes) => bytes,
    applyShapeAnnotations: async (bytes) => bytes,
    applyTextAnnotations: async (bytes) => bytes,
    applySignatureAnnotations: async (bytes) => bytes,
    applyDrawAnnotations: async (bytes) => bytes,
    applyHighlightAnnotations: async (bytes) => bytes,
    splitPdf: async (bytes, groups) => groups.map(() => bytes)
  };
});

let initApp;

beforeAll(async () => {
  if (typeof URL !== "undefined") {
    if (URL.createObjectURL) {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    } else {
      vi.stubGlobal("URL", {
        ...URL,
        createObjectURL: () => "blob:mock"
      });
    }
  }
  vi.stubGlobal(
    "Image",
    class {
      constructor() {
        this.naturalWidth = 120;
        this.naturalHeight = 90;
        this.onload = null;
        this.onerror = null;
      }
      set src(_value) {
        queueMicrotask(() => {
          if (this.onload) {
            this.onload();
          }
        });
      }
    }
  );
  ({ initApp } = await import("../src/app.js"));
});

function setupDom() {
  document.body.innerHTML = "<div id=\"app\"></div>";
  return document.getElementById("app");
}

function setInputFiles(input, files) {
  Object.defineProperty(input, "files", {
    value: files,
    configurable: true
  });
}

async function waitFor(fn, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    const result = fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return null;
}

describe("app shell", () => {
  it("bootstraps without errors", () => {
    const root = setupDom();
    expect(() => initApp(root)).not.toThrow();
  });

  it("renders the app title", () => {
    const root = setupDom();
    initApp(root);
    expect(root.textContent).toContain("Cloud PDF Editor");
  });

  it("renders load and merge controls", () => {
    const root = setupDom();
    initApp(root);
    expect(root.textContent).toContain("Load PDF");
    expect(root.textContent).toContain("Merge PDFs");
  });

  it("renders export and settings controls", () => {
    const root = setupDom();
    initApp(root);
    expect(root.textContent).toContain("Export PDF");
    expect(root.textContent).toContain("Settings");
  });

  it("creates an annotation from drag-and-drop", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    const loadButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Load PDF"
    );
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const imageTool = root.querySelector("[data-role=\"tool-image\"]");
    imageTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const assetInput = root.querySelector("[data-role=\"image-assets\"]");
    setInputFiles(assetInput, [new File(["img"], "photo.png", { type: "image/png" })]);
    assetInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const assetItem = root.querySelector(".asset-item");
    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    const dropEvent = new Event("drop", { bubbles: true });
    Object.defineProperty(dropEvent, "clientX", { value: 100 });
    Object.defineProperty(dropEvent, "clientY", { value: 120 });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { getData: () => assetItem.dataset.assetId }
    });
    overlay.dispatchEvent(dropEvent);

    expect(overlay.querySelectorAll(".annotation").length).toBe(1);
  });

  it("keeps annotations on the correct page", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    const loadButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Load PDF"
    );
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const imageTool = root.querySelector("[data-role=\"tool-image\"]");
    imageTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const assetInput = root.querySelector("[data-role=\"image-assets\"]");
    setInputFiles(assetInput, [new File(["img"], "photo.png", { type: "image/png" })]);
    assetInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const assetItem = root.querySelector(".asset-item");
    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    const dropEvent = new Event("drop", { bubbles: true });
    Object.defineProperty(dropEvent, "clientX", { value: 100 });
    Object.defineProperty(dropEvent, "clientY", { value: 120 });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { getData: () => assetItem.dataset.assetId }
    });
    overlay.dispatchEvent(dropEvent);
    expect(overlay.querySelectorAll(".annotation").length).toBe(1);

    const nextButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Next"
    );
    nextButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(overlay.querySelectorAll(".annotation").length).toBe(0);
  });

  it("remaps annotations after reordering pages", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    const loadButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Load PDF"
    );
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const imageTool = root.querySelector("[data-role=\"tool-image\"]");
    imageTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const assetInput = root.querySelector("[data-role=\"image-assets\"]");
    setInputFiles(assetInput, [new File(["img"], "photo.png", { type: "image/png" })]);
    assetInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const assetItem = root.querySelector(".asset-item");
    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    const dropEvent = new Event("drop", { bubbles: true });
    Object.defineProperty(dropEvent, "clientX", { value: 100 });
    Object.defineProperty(dropEvent, "clientY", { value: 120 });
    Object.defineProperty(dropEvent, "dataTransfer", {
      value: { getData: () => assetItem.dataset.assetId }
    });
    overlay.dispatchEvent(dropEvent);
    expect(overlay.querySelectorAll(".annotation").length).toBe(1);

    const propertiesTool = root.querySelector("[data-role=\"tool-page-properties\"]");
    propertiesTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const downButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Down"
    );
    downButton.click();
    const applyButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply Reorder"
    );
    applyButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(overlay.querySelectorAll(".annotation").length).toBe(0);

    const nextButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Next"
    );
    nextButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(overlay.querySelectorAll(".annotation").length).toBe(1);
  });

  it("creates and edits a text annotation", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    const loadButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Load PDF"
    );
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textTool = root.querySelector("[data-role=\"tool-text\"]");
    textTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    const clickEvent = new Event("click", { bubbles: true });
    Object.defineProperty(clickEvent, "clientX", { value: 140 });
    Object.defineProperty(clickEvent, "clientY", { value: 150 });
    overlay.dispatchEvent(clickEvent);

    const annotation = overlay.querySelector("[data-role=\"text-annotation\"]");
    expect(annotation).toBeTruthy();

    const content = annotation.querySelector(".text-content");
    content.textContent = "Hello";
    content.dispatchEvent(new Event("input", { bubbles: true }));
    expect(content.textContent).toBe("Hello");
  });

  it("moves and resizes a text annotation", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    const loadButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Load PDF"
    );
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textTool = root.querySelector("[data-role=\"tool-text\"]");
    textTool.click();

    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    if (overlay.dataset.mode !== "text") {
      textTool.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const clickEvent = new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 130 });
    overlay.dispatchEvent(clickEvent);
    const fallbackClick = new MouseEvent("click", { bubbles: true, clientX: 140, clientY: 150 });
    overlay.dispatchEvent(fallbackClick);

    const annotation = await waitFor(() =>
      overlay.querySelector("[data-role=\"text-annotation\"]")
    );
    expect(annotation).toBeTruthy();
    const startLeft = annotation.style.left;
    const startWidth = annotation.style.width;

    const dragStart = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(dragStart, "clientX", { value: 120 });
    Object.defineProperty(dragStart, "clientY", { value: 130 });
    Object.defineProperty(dragStart, "button", { value: 0 });
    annotation.dispatchEvent(dragStart);

    const dragMove = new Event("pointermove");
    Object.defineProperty(dragMove, "clientX", { value: 180 });
    Object.defineProperty(dragMove, "clientY", { value: 200 });
    window.dispatchEvent(dragMove);
    window.dispatchEvent(new Event("pointerup"));
    expect(annotation.style.left).not.toBe(startLeft);

    const handle = annotation.querySelector(".resize-handle");
    const resizeStart = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(resizeStart, "clientX", { value: 200 });
    Object.defineProperty(resizeStart, "clientY", { value: 220 });
    Object.defineProperty(resizeStart, "button", { value: 0 });
    handle.dispatchEvent(resizeStart);

    const resizeMove = new Event("pointermove");
    Object.defineProperty(resizeMove, "clientX", { value: 260 });
    Object.defineProperty(resizeMove, "clientY", { value: 260 });
    window.dispatchEvent(resizeMove);
    window.dispatchEvent(new Event("pointerup"));
    expect(annotation.style.width).not.toBe(startWidth);
  });

  it("applies default text styling to new annotations", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    const loadButton = Array.from(root.querySelectorAll("button")).find(
      (button) => button.textContent === "Load PDF"
    );
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textTool = root.querySelector("[data-role=\"tool-text\"]");
    textTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fontSizeInput = root.querySelector("[data-role=\"text-font-size\"]");
    fontSizeInput.value = "20";
    fontSizeInput.dispatchEvent(new Event("change"));
    const colorInput = root.querySelector("[data-role=\"text-color\"]");
    colorInput.value = "#2563eb";
    colorInput.dispatchEvent(new Event("input"));

    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    if (overlay.dataset.mode !== "text") {
      textTool.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const clickEvent = new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 130 });
    overlay.dispatchEvent(clickEvent);
    const annotation = await waitFor(() =>
      overlay.querySelector("[data-role=\"text-annotation\"]")
    );
    expect(annotation.style.fontSize).toBe("20px");
    expect(["rgb(37, 99, 235)", "#2563eb"]).toContain(annotation.style.color);
  });

  it("applies per-selection text styling", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textTool = root.querySelector("[data-role=\"tool-text\"]");
    textTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    const clickEvent = new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 130 });
    overlay.dispatchEvent(clickEvent);

    const annotation = await waitFor(() =>
      overlay.querySelector("[data-role=\"text-annotation\"]")
    );
    const content = annotation.querySelector(".text-content");
    content.textContent = "Hello World";
    content.dispatchEvent(new Event("input", { bubbles: true }));
    content.dispatchEvent(new Event("focusin", { bubbles: true }));

    const textNode = content.firstChild;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 5);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const boldButton = root.querySelector("[data-role=\"text-bold\"]");
    boldButton.click();
    const boldSpan = annotation.querySelector(".text-content span");
    expect(boldSpan.style.fontWeight).toBe("bold");

    const tailNode = Array.from(content.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes("World")
    );
    const sizeRange = document.createRange();
    sizeRange.setStart(tailNode, 1);
    sizeRange.setEnd(tailNode, tailNode.textContent.length);
    selection.removeAllRanges();
    selection.addRange(sizeRange);

    const fontSizeInput = root.querySelector("[data-role=\"text-font-size\"]");
    fontSizeInput.value = "22";
    fontSizeInput.dispatchEvent(new Event("change"));

    const sizedSpan = Array.from(annotation.querySelectorAll(".text-content span")).find(
      (node) => node.style.fontSize === "22px"
    );
    expect(sizedSpan).toBeTruthy();
  });

  it("creates draw and highlight annotations", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "test.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });

    const drawTool = root.querySelector("[data-role=\"tool-draw\"]");
    drawTool.click();
    const drawDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(drawDown, "clientX", { value: 120 });
    Object.defineProperty(drawDown, "clientY", { value: 130 });
    Object.defineProperty(drawDown, "button", { value: 0 });
    overlay.dispatchEvent(drawDown);
    const drawMove = new Event("pointermove");
    Object.defineProperty(drawMove, "clientX", { value: 180 });
    Object.defineProperty(drawMove, "clientY", { value: 200 });
    window.dispatchEvent(drawMove);
    window.dispatchEvent(new Event("pointerup"));
    const drawLayer = root.querySelector("[data-role=\"draw-layer\"]");
    expect(drawLayer.querySelectorAll("[data-role=\"draw-path\"]").length).toBe(1);

    const highlightTool = root.querySelector("[data-role=\"tool-highlight\"]");
    highlightTool.click();
    const highlightDown = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(highlightDown, "clientX", { value: 150 });
    Object.defineProperty(highlightDown, "clientY", { value: 160 });
    Object.defineProperty(highlightDown, "button", { value: 0 });
    overlay.dispatchEvent(highlightDown);
    const highlightMove = new Event("pointermove");
    Object.defineProperty(highlightMove, "clientX", { value: 220 });
    Object.defineProperty(highlightMove, "clientY", { value: 210 });
    window.dispatchEvent(highlightMove);
    window.dispatchEvent(new Event("pointerup"));
    const highlightLayer = root.querySelector("[data-role=\"highlight-layer\"]");
    expect(highlightLayer.querySelectorAll("[data-role=\"highlight-rect\"]").length).toBe(1);
  });

  it("creates a shape annotation", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "shape.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const shapeTool = root.querySelector("[data-role=\"tool-shapes\"]");
    shapeTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    const down = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(down, "clientX", { value: 120 });
    Object.defineProperty(down, "clientY", { value: 140 });
    Object.defineProperty(down, "button", { value: 0 });
    overlay.dispatchEvent(down);
    const move = new Event("pointermove");
    Object.defineProperty(move, "clientX", { value: 220 });
    Object.defineProperty(move, "clientY", { value: 240 });
    window.dispatchEvent(move);
    window.dispatchEvent(new Event("pointerup"));

    const shapeLayer = root.querySelector("[data-role=\"shape-layer\"]");
    expect(shapeLayer.querySelectorAll("[data-role=\"shape-rect\"]").length).toBe(1);
  });

  it("switches tools and shows only one pane", async () => {
    const root = setupDom();
    initApp(root);
    const textTool = root.querySelector("[data-role=\"tool-text\"]");
    const imageTool = root.querySelector("[data-role=\"tool-image\"]");

    textTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector("[data-role=\"pane-text\"]")).toBeTruthy();
    expect(root.querySelector("[data-role=\"pane-image\"]")).toBeFalsy();

    imageTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector("[data-role=\"pane-image\"]")).toBeTruthy();
    expect(root.querySelector("[data-role=\"pane-text\"]")).toBeFalsy();
  });

  it("updates pane position when dragged", async () => {
    const root = setupDom();
    initApp(root);
    const textTool = root.querySelector("[data-role=\"tool-text\"]");
    textTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pane = root.querySelector("[data-role=\"pane-text\"]");
    pane.getBoundingClientRect = () => ({
      left: 40,
      top: 120,
      right: 300,
      bottom: 400,
      width: 260,
      height: 200
    });
    const header = pane.querySelector(".pane-header");
    const down = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(down, "clientX", { value: 100 });
    Object.defineProperty(down, "clientY", { value: 150 });
    Object.defineProperty(down, "button", { value: 0 });
    header.dispatchEvent(down);

    const move = new Event("pointermove");
    Object.defineProperty(move, "clientX", { value: 160 });
    Object.defineProperty(move, "clientY", { value: 200 });
    window.dispatchEvent(move);
    window.dispatchEvent(new Event("pointerup"));
    expect(pane.style.left).toBeTruthy();
    expect(pane.style.top).toBeTruthy();
  });

  it("toggles the settings pane", async () => {
    const root = setupDom();
    initApp(root);
    const settingsButton = root.querySelector("[data-role=\"settings-button\"]");
    settingsButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector("[data-role=\"pane-settings\"]")).toBeTruthy();

    settingsButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector("[data-role=\"pane-settings\"]")).toBeFalsy();
  });

  it("renders six signature variants", async () => {
    const root = setupDom();
    initApp(root);
    const signatureTool = root.querySelector("[data-role=\"tool-signature\"]");
    signatureTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const nameInput = root.querySelector("input[placeholder=\"Full name\"]");
    nameInput.value = "Ada Lovelace";
    nameInput.dispatchEvent(new Event("input"));
    const options = root.querySelectorAll(".signature-option");
    expect(options.length).toBe(6);
  });

  it("tracks and restores session history", async () => {
    await clearSessionHistory();
    window.localStorage.setItem("cloud-pdf-history", "true");
    const root = setupDom();
    initApp(root);
    const historyToggle = root.querySelector(".recent-panel input[type=\"checkbox\"]");
    historyToggle.checked = true;
    historyToggle.dispatchEvent(new Event("change"));
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    const status = root.querySelector(".status");
    await waitFor(() => status.textContent.includes("PDF loaded"), 10);

    const textTool = root.querySelector("[data-role=\"tool-text\"]");
    textTool.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    const clickEvent = new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 130 });
    overlay.dispatchEvent(clickEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const annotation = await waitFor(() =>
      overlay.querySelector("[data-role=\"text-annotation\"]")
    );
    expect(annotation).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 700));
    const recentList = root.querySelector("[data-role=\"recent-list\"]");
    await waitFor(() => recentList.textContent.includes("resume.pdf"), 20);
    expect(recentList.textContent).toContain("resume.pdf");

    const openButton = Array.from(recentList.querySelectorAll("button")).find(
      (button) => button.textContent === "Open"
    );
    const resumeInput = root.querySelector("[data-role=\"resume-input\"]");
    setInputFiles(resumeInput, [
      new File(["%PDF-1.4"], "resume.pdf", { type: "application/pdf" })
    ]);
    openButton.click();
    resumeInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const restored = await waitFor(() =>
      overlay.querySelector("[data-role=\"text-annotation\"]")
    );
    expect(restored).toBeTruthy();
  });

  it("toggles comment visibility without affecting other annotations", async () => {
    const root = setupDom();
    initApp(root);
    const loadInput = root.querySelector("[data-role=\"pdf-load\"]");
    setInputFiles(loadInput, [
      new File(["%PDF-1.4"], "comments.pdf", { type: "application/pdf" })
    ]);
    loadInput.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = root.querySelector("[data-role=\"page-overlay\"]");
    overlay.getBoundingClientRect = () => ({
      width: 600,
      height: 800,
      left: 0,
      top: 0,
      right: 600,
      bottom: 800
    });
    const textTool = root.querySelector("[data-role=\"tool-text\"]");
    textTool.click();
    const clickEvent = new MouseEvent("click", { bubbles: true, clientX: 120, clientY: 130 });
    overlay.dispatchEvent(clickEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const textAnnotation = await waitFor(() =>
      overlay.querySelector("[data-role=\"text-annotation\"]")
    );
    expect(textAnnotation).toBeTruthy();

    const toggle = root.querySelector("[data-role=\"comments-toggle\"]");
    toggle.click();
    expect(document.documentElement.dataset.commentsVisible).toBe("false");
    expect(overlay.querySelector("[data-role=\"text-annotation\"]")).toBeTruthy();
  });
});
