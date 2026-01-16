import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker?worker";
import { PDFDocument } from "pdf-lib";

if (typeof window !== "undefined") {
  const WorkerCtor =
    typeof pdfjsWorker === "function" ? pdfjsWorker : pdfjsWorker?.default;
  if (typeof WorkerCtor === "function") {
    pdfjsLib.GlobalWorkerOptions.workerPort = new WorkerCtor();
  }
}

export function isPdfFile(file) {
  if (!file) {
    return false;
  }
  const nameOk = file.name?.toLowerCase().endsWith(".pdf");
  const typeOk = file.type === "application/pdf";
  return nameOk || typeOk;
}

export async function readFileAsArrayBuffer(file) {
  if (!file) {
    throw new Error("No file provided");
  }
  return file.arrayBuffer();
}

export function isPdfBytes(bytes) {
  if (!bytes || bytes.byteLength < 4) {
    return false;
  }
  const header = new TextDecoder().decode(bytes.slice(0, 4));
  return header === "%PDF";
}

export async function loadPdfDocument(bytes) {
  const task = pdfjsLib.getDocument({ data: bytes });
  const pdfDoc = await task.promise;
  return pdfDoc;
}

export async function renderPageToCanvas(pdfDoc, pageNumber, canvas, scale = 1.2) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext("2d");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: context, viewport }).promise;
}

export async function reorderPdf(bytes, pageOrder) {
  const source = await PDFDocument.load(bytes);
  const target = await PDFDocument.create();
  const indices = pageOrder.map((pageNumber) => pageNumber - 1);
  const pages = await target.copyPages(source, indices);
  pages.forEach((page) => target.addPage(page));
  return target.save();
}

export async function mergePdfs(listOfBytes) {
  const target = await PDFDocument.create();
  for (const bytes of listOfBytes) {
    const source = await PDFDocument.load(bytes);
    const copied = await target.copyPages(source, source.getPageIndices());
    copied.forEach((page) => target.addPage(page));
  }
  return target.save();
}
