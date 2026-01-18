import * as pdfjsLib from "pdfjs-dist/build/pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker?worker";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { SIGNATURE_LAYOUT, SIGNATURE_VARIANTS, getSignatureVariant } from "./signatureData.js";

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

export function convertOverlayPointToPdfPoint(point, pageSize, overlaySize) {
  const scaleX = pageSize.width / overlaySize.width;
  const scaleY = pageSize.height / overlaySize.height;
  return {
    x: point.x * scaleX,
    y: pageSize.height - point.y * scaleY
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
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    const r = Number.parseInt(rgbMatch[1], 10);
    const g = Number.parseInt(rgbMatch[2], 10);
    const b = Number.parseInt(rgbMatch[3], 10);
    if ([r, g, b].some((value) => Number.isNaN(value))) {
      return rgb(0, 0, 0);
    }
    return rgb(r / 255, g / 255, b / 255);
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
  Helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    boldItalic: StandardFonts.HelveticaBoldOblique
  },
  Times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesBold,
    italic: StandardFonts.TimesItalic,
    boldItalic: StandardFonts.TimesBoldItalic
  },
  Courier: {
    regular: StandardFonts.Courier,
    bold: StandardFonts.CourierBold,
    italic: StandardFonts.CourierOblique,
    boldItalic: StandardFonts.CourierBoldOblique
  }
};

async function loadSignatureFontBytes(variant) {
  const fallbackVariants = SIGNATURE_VARIANTS.length
    ? SIGNATURE_VARIANTS
    : (await import("./signatureData.js")).SIGNATURE_VARIANTS;
  const fontFile =
    typeof variant === "string"
      ? variant
      : variant?.fontFile ?? fallbackVariants?.[0]?.fontFile ?? "fonts/Allura-Regular.ttf";
  const normalizedFontFile =
    typeof fontFile === "string" && fontFile.trim() !== "undefined" ? fontFile : "";
  let resolvedFontFile =
    normalizedFontFile.trim().length > 0 ? normalizedFontFile : "fonts/Allura-Regular.ttf";
  if (resolvedFontFile.includes("undefined")) {
    resolvedFontFile = "fonts/Allura-Regular.ttf";
  }
  if (typeof window !== "undefined" && typeof fetch === "function") {
    try {
      const url = new URL(`/${resolvedFontFile}`, window.location?.origin ?? undefined);
      const response = await fetch(url);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        return new Uint8Array(buffer);
      }
    } catch {
      // Fall back to filesystem when running in tests or without a server.
    }
  }
  const fs = await import("node:fs/promises");
  const readFont = async (_fontPath) => {
    const path = await import("node:path");
    const fontPath = path.resolve(process.cwd(), "public", "fonts", "Allura-Regular.ttf");
    const buffer = await fs.readFile(fontPath);
    return new Uint8Array(buffer);
  };
  if (typeof window === "undefined") {
    return await readFont("fonts/Allura-Regular.ttf");
  }
  try {
    return await readFont(resolvedFontFile);
  } catch {
    return await readFont("fonts/Allura-Regular.ttf");
  }
}

function fitSignatureFontSize(font, text, width, height, letterSpacingFactor) {
  const paddedWidth = Math.max(10, width - SIGNATURE_LAYOUT.paddingX * 2);
  const paddedHeight = Math.max(10, height - SIGNATURE_LAYOUT.paddingY * 2);
  const maxSize = Math.max(SIGNATURE_LAYOUT.minFontSize, paddedHeight);
  let size = maxSize;
  const spacingFactor = letterSpacingFactor ?? 0;
  while (size > SIGNATURE_LAYOUT.minFontSize) {
    const spacing = size * spacingFactor;
    const textWidth =
      font.widthOfTextAtSize(text, size) + spacing * Math.max(0, text.length - 1);
    if (textWidth <= paddedWidth) {
      return size;
    }
    size -= 1;
  }
  return SIGNATURE_LAYOUT.minFontSize;
}

function resolveFontKey(fontFamily, bold, italic) {
  const family = FONT_MAP[fontFamily] ?? FONT_MAP.Helvetica;
  if (bold && italic) {
    return family.boldItalic;
  }
  if (bold) {
    return family.bold;
  }
  if (italic) {
    return family.italic;
  }
  return family.regular;
}

export async function applyTextAnnotations(bytes, annotations) {
  if (!annotations.length) {
    return bytes;
  }
  const sourceBytes = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const pdfDoc = await PDFDocument.load(sourceBytes);
  const fontCache = new Map();

  for (const annotation of annotations) {
    const spans =
      annotation.spans && annotation.spans.length
        ? annotation.spans
        : [
            {
              text: annotation.text ?? "",
              fontSize: annotation.fontSize,
              color: annotation.color
            }
          ];
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

    const baseFontSize = annotation.fontSize ?? 16;
    const baseColor = annotation.color ?? "#000000";
    let cursorX = pdfRect.x;
    let cursorY = pdfRect.y + pdfRect.height - baseFontSize;
    let lineHeight = baseFontSize * 1.2;

    const advanceLine = () => {
      cursorY -= lineHeight;
      cursorX = pdfRect.x;
      lineHeight = baseFontSize * 1.2;
    };

    for (const span of spans) {
      const fontSize = span.fontSize ?? baseFontSize;
      const color = parseHexColor(span.color ?? baseColor);
      const fontKey = resolveFontKey(annotation.fontFamily, span.bold, span.italic);
      if (!fontCache.has(fontKey)) {
        fontCache.set(fontKey, await pdfDoc.embedFont(fontKey));
      }
      const font = fontCache.get(fontKey);
      const parts = String(span.text ?? "").split("\n");
      parts.forEach((part, index) => {
        if (part) {
          page.drawText(part, {
            x: cursorX,
            y: cursorY,
            size: fontSize,
            font,
            color
          });
          const width = font.widthOfTextAtSize(part, fontSize);
          if (span.underline) {
            const underlineOffset = fontSize * 0.15;
            page.drawLine({
              start: { x: cursorX, y: cursorY - underlineOffset },
              end: { x: cursorX + width, y: cursorY - underlineOffset },
              thickness: Math.max(1, fontSize / 12),
              color
            });
          }
          cursorX += width;
          lineHeight = Math.max(lineHeight, fontSize * 1.2);
        }
        if (index < parts.length - 1) {
          advanceLine();
        }
      });
    }
  }

  return pdfDoc.save();
}

export async function applyDrawAnnotations(bytes, annotations) {
  if (!annotations.length) {
    return bytes;
  }
  const sourceBytes = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const pdfDoc = await PDFDocument.load(sourceBytes);

  for (const annotation of annotations) {
    const pageIndex = Math.max(
      0,
      Math.min(annotation.pageNumber - 1, pdfDoc.getPageCount() - 1)
    );
    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    if (!annotation.overlayWidth || !annotation.overlayHeight) {
      throw new Error("Missing overlay size for draw placement.");
    }
    if (!annotation.points || annotation.points.length < 2) {
      continue;
    }
    const overlaySize = {
      width: annotation.overlayWidth,
      height: annotation.overlayHeight
    };
    const scaleX = pageWidth / overlaySize.width;
    const scaleY = pageHeight / overlaySize.height;
    const strokeScale = (scaleX + scaleY) / 2;
    const color = parseHexColor(annotation.strokeColor);
    for (let i = 1; i < annotation.points.length; i += 1) {
      const start = convertOverlayPointToPdfPoint(
        annotation.points[i - 1],
        { width: pageWidth, height: pageHeight },
        overlaySize
      );
      const end = convertOverlayPointToPdfPoint(
        annotation.points[i],
        { width: pageWidth, height: pageHeight },
        overlaySize
      );
      page.drawLine({
        start,
        end,
        thickness: annotation.strokeWidth * strokeScale,
        color,
        opacity: annotation.opacity ?? 1
      });
    }
  }

  return pdfDoc.save();
}

export async function applyHighlightAnnotations(bytes, annotations) {
  if (!annotations.length) {
    return bytes;
  }
  const sourceBytes = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const pdfDoc = await PDFDocument.load(sourceBytes);

  for (const annotation of annotations) {
    const pageIndex = Math.max(
      0,
      Math.min(annotation.pageNumber - 1, pdfDoc.getPageCount() - 1)
    );
    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    if (!annotation.overlayWidth || !annotation.overlayHeight) {
      throw new Error("Missing overlay size for highlight placement.");
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
    page.drawRectangle({
      x: pdfRect.x,
      y: pdfRect.y,
      width: pdfRect.width,
      height: pdfRect.height,
      color: parseHexColor(annotation.color),
      opacity: annotation.opacity ?? 0.3
    });
  }

  return pdfDoc.save();
}

export async function applySignatureAnnotations(bytes, annotations) {
  if (!annotations.length) {
    return bytes;
  }
  const sourceBytes = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  const pdfDoc = await PDFDocument.load(sourceBytes);
  pdfDoc.registerFontkit(fontkit);
  const fontCache = new Map();

  for (const annotation of annotations) {
    const text = String(annotation.text ?? "").trim();
    if (!text) {
      continue;
    }
    const pageIndex = Math.max(
      0,
      Math.min(annotation.pageNumber - 1, pdfDoc.getPageCount() - 1)
    );
    const page = pdfDoc.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    if (!annotation.overlayWidth || !annotation.overlayHeight) {
      throw new Error("Missing overlay size for signature placement.");
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
    const candidate = getSignatureVariant(annotation.fontId);
    const fallbackVariants = SIGNATURE_VARIANTS.length
      ? SIGNATURE_VARIANTS
      : (await import("./signatureData.js")).SIGNATURE_VARIANTS;
    const variant = candidate ?? fallbackVariants?.[0];
    const resolvedVariant = getSignatureVariant(variant?.id ?? annotation.fontId);
    const fontFile = resolvedVariant?.fontFile ?? "fonts/Allura-Regular.ttf";
    const cacheKey = resolvedVariant?.id ?? fontFile;
    if (!fontCache.has(cacheKey)) {
      const fontBytes = await loadSignatureFontBytes(fontFile);
      fontCache.set(cacheKey, await pdfDoc.embedFont(fontBytes));
    }
    const font = fontCache.get(cacheKey);
    const fontSize = fitSignatureFontSize(
      font,
      text,
      pdfRect.width,
      pdfRect.height,
      resolvedVariant?.letterSpacing
    );
    const scaleX = pdfRect.width / annotation.width;
    const paddingX = SIGNATURE_LAYOUT.paddingX * scaleX;
    const paddingY = SIGNATURE_LAYOUT.paddingY * (pdfRect.height / annotation.height);
    const letterSpacing = fontSize * (resolvedVariant?.letterSpacing ?? 0);
    const baselineOffset = pdfRect.height * (resolvedVariant?.baselineOffset ?? 0);
    let cursorX = pdfRect.x + paddingX;
    const cursorY =
      pdfRect.y +
      paddingY +
      (pdfRect.height - paddingY * 2 - fontSize) / 2 +
      baselineOffset;

    for (const char of text) {
      page.drawText(char, {
        x: cursorX,
        y: cursorY,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
      cursorX += font.widthOfTextAtSize(char, fontSize) + letterSpacing;
    }
  }

  return pdfDoc.save();
}
