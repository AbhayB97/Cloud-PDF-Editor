import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker?worker";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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

function detectImageType(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "jpg";
  }
  return null;
}

export function convertOverlayRectToPdfRect(overlayRect, pageSize, overlaySize) {
  const scaleX = pageSize.width / overlaySize.width;
  const scaleY = pageSize.height / overlaySize.height;
  return {
    x: overlayRect.x * scaleX,
    y: pageSize.height - (overlayRect.y + overlayRect.height) * scaleY,
    width: overlayRect.width * scaleX,
    height: overlayRect.height * scaleY
  };
}

export async function insertImage(bytes, imageBytes, options = {}) {
  const pdfDoc = await PDFDocument.load(bytes);
  const pageNumber = options.pageNumber ?? 1;
  const pageIndex = Math.max(0, Math.min(pageNumber - 1, pdfDoc.getPageCount() - 1));
  const page = pdfDoc.getPage(pageIndex);
  const pngOrJpg = detectImageType(imageBytes);
  if (!pngOrJpg) {
    throw new Error("Only PNG and JPEG images are supported.");
  }

  const embed = pngOrJpg === "png" ? pdfDoc.embedPng : pdfDoc.embedJpg;
  const image = await embed.call(pdfDoc, imageBytes);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const scale = options.scale ?? (pageWidth * 0.3) / image.width;
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = options.x ?? (pageWidth - drawWidth) / 2;
  const y = options.y ?? (pageHeight - drawHeight) / 2;

  page.drawImage(image, {
    x,
    y,
    width: drawWidth,
    height: drawHeight
  });

  return pdfDoc.save();
}

export async function applyImageAnnotations(bytes, assets, annotations) {
  if (!annotations.length) {
    return bytes;
  }
  const sourceBytes = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

  for (const annotation of annotations) {
    const asset = assetMap.get(annotation.assetId);
    if (!asset) {
      continue;
    }
    const imageData =
      asset.imageData instanceof Uint8Array
        ? asset.imageData
        : new Uint8Array(await asset.imageData.arrayBuffer());
    const pngOrJpg = detectImageType(imageData);
    if (!pngOrJpg) {
      throw new Error("Only PNG and JPEG images are supported.");
    }
    const embed = pngOrJpg === "png" ? pdfDoc.embedPng : pdfDoc.embedJpg;
    const image = await embed.call(pdfDoc, imageData);
    const pageIndex = Math.max(
      0,
      Math.min(annotation.pageNumber - 1, pdfDoc.getPageCount() - 1)
    );
    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    if (!annotation.overlayWidth || !annotation.overlayHeight) {
      throw new Error("Missing overlay size for image placement.");
    }
    const overlaySize = {
      width: annotation.overlayWidth,
      height: annotation.overlayHeight
    };
    const pdfRect = convertOverlayRectToPdfRect(
      {
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height
      },
      { width: pageWidth, height: pageHeight },
      overlaySize
    );

    page.drawImage(image, {
      x: pdfRect.x,
      y: pdfRect.y,
      width: pdfRect.width,
      height: pdfRect.height
    });
  }

  return pdfDoc.save();
}

function parseHexColor(color) {
  if (!color || typeof color !== "string") {
    return rgb(0, 0, 0);
  }
  const cleaned = color.startsWith("#") ? color.slice(1) : color;
  if (cleaned.length !== 6) {
    return rgb(0, 0, 0);
  }
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  if ([r, g, b].some((value) => Number.isNaN(value))) {
    return rgb(0, 0, 0);
  }
  return rgb(r / 255, g / 255, b / 255);
}

const FONT_MAP = {
  Helvetica: StandardFonts.Helvetica,
  Times: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier
};

export async function applyTextAnnotations(bytes, annotations) {
  if (!annotations.length) {
    return bytes;
  }
  const sourceBytes = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const fontCache = new Map();

  for (const annotation of annotations) {
    const pageIndex = Math.max(
      0,
      Math.min(annotation.pageNumber - 1, pdfDoc.getPageCount() - 1)
    );
    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    if (!annotation.overlayWidth || !annotation.overlayHeight) {
      throw new Error("Missing overlay size for text placement.");
    }
    const overlaySize = {
      width: annotation.overlayWidth,
      height: annotation.overlayHeight
    };
    const pdfRect = convertOverlayRectToPdfRect(
      {
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height
      },
      { width: pageWidth, height: pageHeight },
      overlaySize
    );

    const fontKey = FONT_MAP[annotation.fontFamily] ?? StandardFonts.Helvetica;
    if (!fontCache.has(fontKey)) {
      fontCache.set(fontKey, await pdfDoc.embedFont(fontKey));
    }
    const font = fontCache.get(fontKey);
    const fontSize = annotation.fontSize ?? 16;
    const color = parseHexColor(annotation.color);

    page.drawText(annotation.text ?? "", {
      x: pdfRect.x,
      y: pdfRect.y + pdfRect.height - fontSize,
      size: fontSize,
      font,
      color,
      maxWidth: pdfRect.width
    });
  }

  return pdfDoc.save();
}
