import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO0W6cQAAAAASUVORK5CYII=";

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

  it("inserts a PNG image", async () => {
    const { insertImage } = await import("../src/pdfService.js");
    const bytes = await createPdfWithPageSizes([[600, 800]]);
    const imageBytes = Uint8Array.from(Buffer.from(PNG_BASE64, "base64"));
    const updated = await insertImage(bytes, imageBytes, { pageNumber: 1 });
    const doc = await PDFDocument.load(updated);
    expect(doc.getPageCount()).toBe(1);
  });

  it("inserts a JPEG image", async () => {
    const { insertImage } = await import("../src/pdfService.js");
    const bytes = await createPdfWithPageSizes([[600, 800]]);
    const imageBytes = new Uint8Array(readFileSync(resolve("tests/fixtures/1x1.jpg")));
    const updated = await insertImage(bytes, imageBytes, { pageNumber: 1 });
    const doc = await PDFDocument.load(updated);
    expect(doc.getPageCount()).toBe(1);
  });

  it("converts overlay coordinates to PDF coordinates", async () => {
    const { convertOverlayRectToPdfRect } = await import("../src/pdfService.js");
    const rect = convertOverlayRectToPdfRect(
      { x: 60, y: 80, width: 120, height: 160 },
      { width: 600, height: 800 },
      { width: 300, height: 400 }
    );
    expect(rect).toEqual({ x: 120, y: 320, width: 240, height: 320 });
  });

  it("applies annotations without mutating original bytes", async () => {
    const { applyImageAnnotations } = await import("../src/pdfService.js");
    const bytes = await createPdfWithPageSizes([[600, 800]]);
    const original = new Uint8Array(bytes);
    const assetId = "asset-1";
    const assets = [
      {
        id: assetId,
        name: "pixel.png",
        imageData: Uint8Array.from(Buffer.from(PNG_BASE64, "base64")),
        naturalWidth: 1,
        naturalHeight: 1
      }
    ];
    const annotations = [
      {
        id: "annotation-1",
        assetId,
        pageNumber: 1,
        x: 10,
        y: 20,
        width: 50,
        height: 60,
        overlayWidth: 300,
        overlayHeight: 400
      }
    ];
    const updated = await applyImageAnnotations(bytes, assets, annotations);
    expect(Array.from(new Uint8Array(bytes))).toEqual(Array.from(original));
    expect(updated.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it("applies JPEG annotations", async () => {
    const { applyImageAnnotations } = await import("../src/pdfService.js");
    const bytes = await createPdfWithPageSizes([[600, 800]]);
    const assetId = "asset-2";
    const assets = [
      {
        id: assetId,
        name: "pixel.jpg",
        imageData: new Uint8Array(readFileSync(resolve("tests/fixtures/1x1.jpg"))),
        naturalWidth: 1,
        naturalHeight: 1
      }
    ];
    const annotations = [
      {
        id: "annotation-2",
        assetId,
        pageNumber: 1,
        x: 40,
        y: 40,
        width: 30,
        height: 30,
        overlayWidth: 300,
        overlayHeight: 400
      }
    ];
    const updated = await applyImageAnnotations(bytes, assets, annotations);
    expect(updated.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it("applies text annotations and keeps original bytes intact", async () => {
    const { applyTextAnnotations } = await import("../src/pdfService.js");
    const bytes = await createPdfWithPageSizes([[600, 800]]);
    const original = new Uint8Array(bytes);
    const annotations = [
      {
        id: "text-1",
        pageNumber: 1,
        x: 20,
        y: 40,
        width: 200,
        height: 40,
        text: "Hello",
        fontSize: 18,
        fontFamily: "Helvetica",
        color: "#111111",
        overlayWidth: 300,
        overlayHeight: 400
      }
    ];
    const updated = await applyTextAnnotations(bytes, annotations);
    expect(Array.from(new Uint8Array(bytes))).toEqual(Array.from(original));
    expect(updated.byteLength).toBeGreaterThan(bytes.byteLength);
  });

  it("embeds a monospaced font for text annotations", async () => {
    const { applyTextAnnotations } = await import("../src/pdfService.js");
    const bytes = await createPdfWithPageSizes([[600, 800]]);
    const annotations = [
      {
        id: "text-2",
        pageNumber: 1,
        x: 30,
        y: 60,
        width: 240,
        height: 50,
        text: "Mono",
        fontSize: 14,
        fontFamily: "Courier",
        color: "#000000",
        overlayWidth: 300,
        overlayHeight: 400
      }
    ];
    const updated = await applyTextAnnotations(bytes, annotations);
    expect(updated.byteLength).toBeGreaterThan(bytes.byteLength);
  });
});
