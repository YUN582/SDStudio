import type { GenericScene, InpaintScene, Session } from './types';

export const PAINT_META = 'codex.inpaintDrawing.v1';
export const DETACHED_INPUT_META = 'codex.detachedInpaintInput';

export function paintCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function paintImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('그림 이미지를 읽지 못했습니다.'));
    image.src = src.startsWith('data:') ? src : 'data:image/png;base64,' + src;
  });
}

export interface InpaintInputAccess {
  getOutputDir(session: Session, scene: GenericScene): string;
  fetchImage(path: string): Promise<string | undefined | null>;
  fetchVibeImage(
    session: Session,
    name: string,
  ): Promise<string | undefined | null>;
}

export function linkedInpaintInputPath(
  access: Pick<InpaintInputAccess, 'getOutputDir'>,
  session: Session,
  scene: InpaintScene,
): string | undefined {
  if (
    !['SDInpaint', 'SDI2I'].includes(scene.workflowType) ||
    !scene.sceneRef ||
    !scene.sourceImage ||
    scene.meta.get(DETACHED_INPUT_META)
  )
    return;
  const parent = session.scenes.get(scene.sceneRef);
  if (!parent) throw new Error('연결된 원본 씬을 찾을 수 없습니다.');
  return access.getOutputDir(session, parent) + '/' + scene.sourceImage;
}

export async function fetchInpaintInput(
  access: InpaintInputAccess,
  session: Session,
  scene: InpaintScene,
  preset = scene.preset,
  includeDrawing = true,
): Promise<string> {
  const linked =
    preset.image === scene.preset.image
      ? linkedInpaintInputPath(access, session, scene)
      : undefined;
  const data = linked
    ? await access.fetchImage(linked)
    : /\.(png|webp)$/i.test(preset.image)
      ? await access.fetchVibeImage(session, preset.image)
      : preset.image.startsWith('data:')
        ? preset.image
        : 'data:image/png;base64,' + preset.image;
  if (!data)
    throw new Error(
      linked
        ? '연결된 원본 이미지를 찾을 수 없습니다. 휴지통에서 복원하거나 입력 이미지를 다시 선택해 주세요.'
        : '인페인트 입력 이미지를 읽지 못했습니다.',
    );
  const drawing = scene.meta.get(PAINT_META);
  if (
    !includeDrawing ||
    !drawing?.layer ||
    drawing.source !== scene.preset.image ||
    preset.image !== scene.preset.image
  )
    return data;
  const layerData = await access.fetchVibeImage(session, drawing.layer);
  if (!layerData) throw new Error('저장된 밑그림을 읽지 못했습니다.');
  const [base, layer] = await Promise.all([
    paintImage(data),
    paintImage(layerData),
  ]);
  const canvas = paintCanvas(base.naturalWidth, base.naturalHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  ctx.drawImage(layer, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export function maskPixelsHavePaint(pixels: Uint8ClampedArray): boolean {
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] && (pixels[i] || pixels[i + 1] || pixels[i + 2]))
      return true;
  }
  return false;
}

export async function maskHasPaint(data: string): Promise<boolean> {
  if (!data) return false;
  const image = await paintImage(data);
  const canvas = paintCanvas(image.naturalWidth, image.naturalHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  return maskPixelsHavePaint(
    ctx.getImageData(0, 0, canvas.width, canvas.height).data,
  );
}
