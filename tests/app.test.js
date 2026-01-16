import { describe, expect, it, vi, beforeAll } from "vitest";

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
    applyTextAnnotations: async (bytes) => bytes
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
    expect(root.querySelector("[data-role=\"pdf-load\"]")).toBeTruthy();
    expect(root.textContent).toContain("Merge PDFs");
  });

  it("renders export and image asset controls", () => {
    const root = setupDom();
    initApp(root);
    expect(root.textContent).toContain("Image Assets");
    expect(root.textContent).toContain("Text Tool");
    expect(root.textContent).toContain("Download PDF");
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
    loadButton.click();
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
    loadButton.click();
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
    loadButton.click();
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
    loadButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textToggle = root.querySelector("[data-role=\"text-tool-toggle\"]");
    textToggle.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    loadButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textToggle = root.querySelector("[data-role=\"text-tool-toggle\"]");
    textToggle.click();

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
      textToggle.click();
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
    loadButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fontSizeInput = root.querySelector("[data-role=\"text-font-size\"]");
    fontSizeInput.value = "20";
    fontSizeInput.dispatchEvent(new Event("change"));
    const colorInput = root.querySelector("[data-role=\"text-color\"]");
    colorInput.value = "#2563eb";
    colorInput.dispatchEvent(new Event("input"));

    const textToggle = root.querySelector("[data-role=\"text-tool-toggle\"]");
    textToggle.click();
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
    if (overlay.dataset.mode !== "text") {
      textToggle.click();
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
});
