import { imageService, workFlowService } from '.';
import { appState } from './AppService';
import { GenericScene, InpaintScene, Session } from './types';
import { dataUriToBase64 } from './ImageService';
import { extractPromptDataFromBase64 } from './util';
import { prepareMirrorCanvas } from './workflows/SDWorkFlow';
import {
  workflowUsesImageResolution,
  resolutionFromImage,
  inpaintSceneResolutionFields,
  paidResolutionNotice,
} from './inpaintResolution';
import { recordScenesCreated, mirrorImageHooks } from './sceneStructureUndo';
import { UNDO_TEXT } from './undoService';
import { chooseNewVariantCombo, COMBO_SOURCE_TEXT } from './comboSource';
import { KEEP_COMBINATIONS, SINGLE_IMAGE_EDIT } from './singleImageEdit';

const pendingRequests = new WeakMap<Session, Set<string>>();

export async function openSourceVariant(
  session: Session,
  scene: GenericScene,
  type: string,
  path: string,
  open: (work: InpaintScene) => void,
) {
  let pending = pendingRequests.get(session);
  if (!pending) pendingRequests.set(session, (pending = new Set()));
  const key = JSON.stringify([scene.type, scene.name, type, path]);
  if (pending.has(key)) return;
  pending.add(key);
  try {
    await createSourceVariant(session, scene, type, path, open);
  } finally {
    pending.delete(key);
  }
}

/** Always create a new work; existing work is opened explicitly in the linked-work list. */
export async function createSourceVariant(
  session: Session,
  scene: GenericScene,
  workflowType: string,
  path: string,
  open: (work: InpaintScene) => void,
) {
  // Ask before storing image files, so cancellation leaves no work or orphan snapshot.
  const choice = await chooseNewVariantCombo(session, scene, workflowType, true);
  if (!choice) return;
  const sourceImage = path.split('/').pop();
  let image = await imageService.fetchImage(path);
  image = dataUriToBase64(image!);
  let cnt = 0;
  const newName = () => scene.name + cnt.toString();
  while (session.inpaints.has(newName())) {
    cnt++;
  }
  const name = newName();
  const job = await extractPromptDataFromBase64(image);
  const preset = job
    ? workFlowService.createPreset(workflowType, job)
    : workFlowService.buildPreset(workflowType);

  if (workflowType === 'SDMirror') {
    // 미러: 세션 레벨 이미지 저장 + 합성 캔버스 생성
    const storedPath = await imageService.storeVibeImage(session, image);
    const prevMirrorImage = session.mirrorImage;
    session.mirrorImage = storedPath;
    const result = await prepareMirrorCanvas(
      image,
      session.mirrorMode || 'blank',
    );
    preset.image = await imageService.storeVibeImage(session, result.canvas);
    preset.mask = await imageService.storeVibeImage(session, result.mask);
    const newScene = InpaintScene.fromJSON({
      type: 'inpaint',
      name,
      workflowType,
      preset,
      resolution: 'custom',
      resolutionWidth: result.width,
      resolutionHeight: result.height,
      mirrorCropX: result.cropX,
      sceneRef: scene.type === 'scene' ? scene.name : scene.sceneRef,
      sourceImage,
      sourceInpaint: scene.type === 'inpaint' ? scene.name : undefined,
      imageMap: [],
      mains: [],
      round: undefined,
      game: undefined,
    });
    if (newScene) {
      session.addScene(newScene);
      // 되돌리기(U2a): 씬은 휴지통행, 세션 미러 원본은 이번 값 그대로일 때만 이전 값으로(새 이미지 파일은 남김)
      recordScenesCreated(
        session,
        [newScene],
        UNDO_TEXT.variantSceneCreate(newScene.name),
        {
          ...mirrorImageHooks(session, prevMirrorImage, storedPath),
        },
      );
      open(newScene);
    }
  } else {
    // 해상도 = 첨부 이미지 크기(R-res, SPEC §7-3). 이미 받은 이미지로 생성 전에 정해 씬 등록 1회로 끝낸다.
    // 크기를 모르거나 대상 아닌 워크플로우면 원본 씬 해상도(커스텀 너비·높이 포함 — 예전엔 enum 만 복사).
    const fromImage = workflowUsesImageResolution(workflowType)
      ? await resolutionFromImage(image)
      : undefined;
    preset.image = await imageService.storeVibeImage(session, image);
    const newScene = InpaintScene.fromJSON({
      type: 'inpaint',
      name,
      workflowType,
      preset,
      meta: choice.kind === 'single'
        ? { [SINGLE_IMAGE_EDIT]: true }
        : { [KEEP_COMBINATIONS]: true },
      ...inpaintSceneResolutionFields(workflowType, scene, fromImage),
      sceneRef: scene.type === 'scene' ? scene.name : scene.sceneRef,
      sourceImage,
      sourceInpaint: scene.type === 'inpaint' ? scene.name : undefined,
      outputInSourceScene:
        (workflowType === 'SDInpaint' ||
          workflowType === 'SDI2I' ||
          workflowType === 'Augment') &&
        (scene.type === 'scene' ||
          (scene.sceneRef && session.scenes.has(scene.sceneRef)))
          ? true
          : undefined,
      imageMap: [],
      mains: [],
      round: undefined,
      game: undefined,
    });
    if (newScene) {
      if (choice.kind === 'combo') {
        choice.apply(newScene);
        if (choice.fromCurrent) appState.pushMessage(COMBO_SOURCE_TEXT.currentNotice, 'info');
      }
      session.addScene(newScene);

      // 되돌리기(U2a): 씬은 휴지통행(저장한 첨부 이미지 파일은 남김)
      recordScenesCreated(
        session,
        [newScene],
        UNDO_TEXT.variantSceneCreate(newScene.name),
      );
      open(newScene);
      const notice = fromImage && paidResolutionNotice(fromImage);
      if (notice) appState.pushMessage(notice, 'info');
    }
  }
}
