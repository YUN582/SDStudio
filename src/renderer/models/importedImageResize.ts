import { NAI_FREE_PIXEL_LIMIT } from '../backends/genVendors/naiModelCapabilities';
import { base64ToDataUri } from '../componenets/BrushTool';

export interface ImportedImageSize { width: number; height: number }

/** Fill the pixel budget along either axis, then prefer the closest aspect ratio. */
export function importedI2IResizeSize(width: number, height: number): ImportedImageSize | undefined {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) return undefined;
  const grid = 64;
  if (Math.ceil(width / grid) * grid * Math.ceil(height / grid) * grid <= NAI_FREE_PIXEL_LIMIT) return undefined;
  const cells = Math.floor(NAI_FREE_PIXEL_LIMIT / (grid * grid));
  const maxWidth = Math.min(cells, Math.max(1, Math.floor(width / grid)));
  const maxHeight = Math.min(cells, Math.max(1, Math.floor(height / grid)));
  let best: ImportedImageSize | undefined;
  let bestError = Infinity;
  const consider = (w: number, h: number) => {
    const candidate = { width: w * grid, height: h * grid };
    const error = Math.abs(Math.log((candidate.width / candidate.height) / (width / height)));
    const area = candidate.width * candidate.height;
    if (error < bestError - 1e-12 || (Math.abs(error - bestError) <= 1e-12 && area > (best ? best.width * best.height : 0))) {
      best = candidate;
      bestError = error;
    }
  };
  // Budget edges exclude tiny exact-ratio matches; both axes keep rotation symmetric.
  for (let w = 1; w <= maxWidth; w++) consider(w, Math.min(maxHeight, Math.floor(cells / w)));
  for (let h = 1; h <= maxHeight; h++) consider(Math.min(maxWidth, Math.floor(cells / h)), h);
  return best;
}

/** Resize only the in-memory input copy. Never crop, pad, or modify the source file. */
export async function resizeImportedI2IImage(image: string, size: ImportedImageSize): Promise<string> {
  const { width, height } = size;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 64 || height < 64 || width % 64 || height % 64 || width * height > NAI_FREE_PIXEL_LIMIT) {
    throw new Error('축소할 이미지 크기가 올바르지 않습니다.');
  }
  const input = new Image();
  await new Promise<void>((resolve, reject) => {
    input.onload = () => resolve();
    input.onerror = () => reject(new Error('축소할 이미지를 읽지 못했습니다.'));
    input.src = image.startsWith('data:') ? image : base64ToDataUri(image);
  });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이미지를 축소하지 못했습니다.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(input, 0, 0, width, height);
  return canvas.toDataURL('image/png').split(',')[1];
}
