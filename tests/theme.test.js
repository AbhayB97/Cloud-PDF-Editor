import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/pdfService.js", () => {
  return {
    isPdfBytes: () => true,
    isPdfFile: () => true,
    loadPdfDocument: async () => ({ numPages: 1 }),
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

function setupDom() {
  document.body.innerHTML = "<div id=\"app\"></div>";
  return document.getElementById("app");
}

beforeEach(() => {
  localStorage.clear();
});

describe("theme", () => {
  it("respects OS preference on first run", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { initApp } = await import("../src/app.js");
    const root = setupDom();
    initApp(root);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists selected theme", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const { initApp } = await import("../src/app.js");
    const root = setupDom();
    initApp(root);
    const select = root.querySelector("[data-role=\"theme-select\"]");
    select.value = "contrast";
    select.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("cloud-pdf-theme")).toBe("contrast");
  });
});
