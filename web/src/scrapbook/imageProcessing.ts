import { boundedImageSize } from "../domain/scrapbook";

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  hasAlpha: boolean;
}

async function decodedImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" });
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dimensions(image: ImageBitmap | HTMLImageElement) {
  return "naturalWidth" in image
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not encode image")),
    type,
    quality
  ));
}

function imageHasAlpha(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 250) return true;
  }
  return false;
}

export async function processPhoto(file: Blob): Promise<ProcessedImage> {
  const source = await decodedImage(file);
  const sourceSize = dimensions(source);
  const target = boundedImageSize(sourceSize.width, sourceSize.height, 1600);
  const canvas = document.createElement("canvas");
  canvas.width = target.x;
  canvas.height = target.y;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(source, 0, 0, target.x, target.y);
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
  return { blob: await canvasBlob(canvas, "image/jpeg", 0.86), width: target.x, height: target.y, hasAlpha: false };
}

export async function processCustomSticker(file: Blob): Promise<ProcessedImage> {
  const source = await decodedImage(file);
  const sourceSize = dimensions(source);
  const target = boundedImageSize(sourceSize.width, sourceSize.height, 1200);
  const probe = document.createElement("canvas");
  probe.width = target.x;
  probe.height = target.y;
  const probeContext = probe.getContext("2d", { willReadFrequently: true });
  if (!probeContext) throw new Error("Canvas is unavailable");
  probeContext.drawImage(source, 0, 0, target.x, target.y);
  const hasAlpha = imageHasAlpha(probeContext, target.x, target.y);

  if (!hasAlpha) {
    if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
    return { blob: await canvasBlob(probe, "image/png"), width: target.x, height: target.y, hasAlpha: false };
  }

  // Transparent sources get the iOS-like die-cut treatment. Opaque images stay rectangular.
  const padding = 16;
  const canvas = document.createElement("canvas");
  canvas.width = target.x + padding * 2;
  canvas.height = target.y + padding * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.shadowColor = "white";
  context.shadowBlur = 12;
  for (const [x, y] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-2, -2], [2, 2]]) {
    context.drawImage(probe, padding + x, padding + y);
  }
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.drawImage(probe, padding, padding);
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
  return {
    blob: await canvasBlob(canvas, "image/png"),
    width: canvas.width,
    height: canvas.height,
    hasAlpha: true
  };
}
