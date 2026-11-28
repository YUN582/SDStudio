import { runInAction } from 'mobx';
import type { InpaintScene, Session } from './types';
import { DETACHED_INPUT_META, PAINT_META, paintCanvas, paintImage } from './inpaintInput';
import { sceneInSession } from './sceneStructureUndo';
import { flushSceneFieldEdit } from './sceneFieldUndo';
import { undoDeepClone, undoRef, undoService, UNDO_TEXT } from './undoService';
import type { UndoService } from './undoService';
import { focusRectPresetPatch, presetFocusRect, presetSupportsFocus, reconcileFocusRect } from './focusedInpaintEditor';

const FOCUS_KEYS = ['focusX', 'focusY', 'focusW', 'focusH'] as const;

interface Access {
  fetchVibeImage(session: Session, path: string): Promise<string | null | undefined>;
  storeWorkImage(session: Session, scene: InpaintScene, role: 'input' | 'mask' | 'drawing', data: string): Promise<string>;
}

/** Replace only this work's input. Keep originals and earlier reservations intact. */
export async function replaceInpaintBaseImage(
  session: Session,
  scene: InpaintScene,
  data: string,
  access: Access,
  options: { before?: () => Promise<void>; isCurrent?: () => boolean; service?: UndoService } = {},
) {
  const bitmap = await paintImage(data);
  const { naturalWidth: width, naturalHeight: height } = bitmap;
  if (!width || !height) throw new Error('이미지 크기를 읽지 못했습니다.');
  const isCurrent = () => options.isCurrent?.() ?? true;
  if (!isCurrent()) return;
  await options.before?.();
  if (!isCurrent()) return;
  const source = scene.preset.image, oldMask = scene.preset.mask;
  const oldPaint = undoDeepClone(scene.meta.get(PAINT_META));
  const png = (image: HTMLImageElement) => {
    const canvas = paintCanvas(width, height);
    canvas.getContext('2d')!.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/png').split(',')[1];
  };
  const copyLayer = async (path: string, role: 'mask' | 'drawing') => {
    const layer = await access.fetchVibeImage(session, path);
    if (!layer) throw new Error(role === 'mask' ? '기존 마스크를 읽지 못했습니다.' : '기존 그리기 레이어를 읽지 못했습니다.');
    const pixels = png(await paintImage(layer));
    return { path: await access.storeWorkImage(session, scene, role, pixels), pixels };
  };
  const image = png(bitmap);
  const path = await access.storeWorkImage(session, scene, 'input', image);
  const mask = oldMask ? await copyLayer(oldMask, 'mask') : undefined;
  const drawing = oldPaint?.source === source && oldPaint.layer ? await copyLayer(oldPaint.layer, 'drawing') : undefined;
  if (!isCurrent() || scene.preset.image !== source || scene.preset.mask !== oldMask) return;

  const service = options.service ?? undoService, ref = undoRef(scene);
  const snapshot = () => ({
    image: ref.current.preset.image, mask: ref.current.preset.mask,
    detached: ref.current.meta.get(DETACHED_INPUT_META),
    drawing: undoDeepClone(ref.current.meta.get(PAINT_META)),
    focus: FOCUS_KEYS.map(key => ref.current.preset[key]),
  });
  flushSceneFieldEdit();
  const pending = service.canRecord(session) && sceneInSession(session, scene)
    ? service.track(session, UNDO_TEXT.variantImageUpload(scene.name), {
        detectConflict: true,
        verify: () => sceneInSession(session, ref.current) && !!ref.current.preset || UNDO_TEXT.sceneGone(ref.current.name),
        snapshot,
        restore: state => runInAction(() => {
          ref.current.preset.image = state.image; ref.current.preset.mask = state.mask;
          FOCUS_KEYS.forEach((key, i) => { if (key in ref.current.preset) ref.current.preset[key] = state.focus[i]; });
          for (const [key, value] of [[DETACHED_INPUT_META, state.detached], [PAINT_META, state.drawing]] as const) {
            if (value === undefined) ref.current.meta.delete(key);
            else ref.current.meta.set(key, undoDeepClone(value));
          }
        }),
      }) : undefined;
  runInAction(() => {
    scene.preset.image = path;
    if (mask) scene.preset.mask = mask.path;
    scene.meta.set(DETACHED_INPUT_META, true);
    if (drawing) scene.meta.set(PAINT_META, { ...oldPaint, source: path, layer: drawing.path, owner: scene.name });
    if (presetSupportsFocus(scene.preset)) {
      const focus = reconcileFocusRect(presetFocusRect(scene.preset), width, height);
      if (focus.kind === 'set') Object.assign(scene.preset, focusRectPresetPatch(focus.rect));
      else if (focus.kind === 'clear') Object.assign(scene.preset, focusRectPresetPatch(null));
    }
  });
  pending?.commit();
  return { image, mask: mask?.pixels, width, height };
}
