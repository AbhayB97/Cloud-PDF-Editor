import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

vi.mock("pdfjs-dist/build/pdf", () => {
  return {
    getDocument: vi.fn(() => ({
      promise: Promise.resolve({
        numPages: 3,
        getPage: vi.fn()
      })
    })),
    GlobalWorkerOptions: {}
  };
});

vi.mock("pdfjs-dist/build/pdf.worker?worker", () => {
  return {
    default: class FakeWorker {}
  };
});

async function createPdfWithPageSizes(sizes) {
  const doc = await PDFDocument.create();
  sizes.forEach(([width, height]) => {
    doc.addPage([width, height]);
  });
  return doc.save();
}

describe("pdfService", () => {
  it("accepts valid PDF bytes", async () => {
    const { isPdfBytes } = await import("../src/pdfService.js");
    const bytes = await createPdfWithPageSizes([[200, 200]]);
    expect(isPdfBytes(bytes)).toBe(true);
  });

  it("rejects non-PDF bytes", async () => {
    const { isPdfBytes } = await import("../src/pdfService.js");
    const bytes = new TextEncoder().encode("not a pdf");
    expect(isPdfBytes(bytes)).toBe(false);
  });

  it("loads a PDF and exposes page count", async () => {
    const { loadPdfDocument } = await import("../src/pdfService.js");
    const doc = await loadPdfDocument(new Uint8Array([37, 80, 68, 70]));
    expect(doc.numPages).toBe(3);
  });

  it("reorders pages without changing page count", async () => {
    const { reorderPdf } = await import("../src/pdfService.js");
    const bytes = await createPdfWithPageSizes([
      [300, 300],
      [400, 400],
      [500, 500]
    ]);
    const reordered = await reorderPdf(bytes, [3, 1, 2]);
    const doc = await PDFDocument.load(reordered);
    const sizes = doc.getPages().map((page) => [page.getWidth(), page.getHeight()]);
    expect(sizes).toEqual([
      [500, 500],
      [300, 300],
      [400, 400]
    ]);
  });

  it("merges PDFs and preserves order", async () => {
    const { mergePdfs } = await import("../src/pdfService.js");
    const first = await createPdfWithPageSizes([
      [200, 300],
      [250, 250]
    ]);
    const second = await createPdfWithPageSizes([[600, 800]]);
    const merged = await mergePdfs([first, second]);
    const doc = await PDFDocument.load(merged);
    const sizes = doc.getPages().map((page) => [page.getWidth(), page.getHeight()]);
    expect(sizes).toEqual([
      [200, 300],
      [250, 250],
      [600, 800]
    ]);
  });

  it("handles larger PDFs without throwing", async () => {
    const { reorderPdf } = await import("../src/pdfService.js");
    const sizes = Array.from({ length: 30 }, () => [612, 792]);
    const bytes = await createPdfWithPageSizes(sizes);
    const pageOrder = sizes.map((_, index) => index + 1);
    await expect(reorderPdf(bytes, pageOrder)).resolves.toBeTruthy();
  });
});
