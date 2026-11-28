import { loadImageFromBase64 } from './focusedInpaintCanvas';

/** Also used when an empty inpaint mask switches the request to I2I. */
export async function prepareI2IRequestPixels(
  image: string,
  resolution: { width: number; height: number },
): Promise<string> {
  return resizeRequestPixels(image, resolution, false);
}

async function resizeRequestPixels(
  data: string,
  { width, height }: { width: number; height: number },
  isMask: boolean,
): Promise<string> {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('생성 이미지 크기가 올바르지 않습니다.');
  }
  if (!data) throw new Error(isMask ? '마스크가 없습니다.' : '입력 이미지가 없습니다.');
  const base64 = data.replace(/^data:[^,]+,/, '');
  const bitmap = await loadImageFromBase64(base64);
  if (bitmap.naturalWidth === width && bitmap.naturalHeight === height) return base64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이미지 크기를 조절하지 못했습니다.');
  // A mask is discrete coverage: interpolation must not introduce gray edges.
  context.imageSmoothingEnabled = !isMask;
  if (!isMask) context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** Match infill pixels to the frozen request size without changing stored editing inputs. */
export async function prepareInpaintRequestPixels(
  image: string,
  mask: string,
  resolution: { width: number; height: number },
): Promise<{ image: string; mask: string }> {
  return {
    image: await resizeRequestPixels(image, resolution, false),
    mask: await resizeRequestPixels(mask, resolution, true),
  };
}
