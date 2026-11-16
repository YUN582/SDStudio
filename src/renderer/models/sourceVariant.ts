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

const pendingRequests = new WeakMap<Session, Set<string>>();

export async function openSourceVariant(
  session: Session,
  scene: GenericScene,
  type: string,
  path: string,
  open: (work: InpaintScene) => void,
) {
  const filename = path.split('/').pop();
  if (type === 'SDInpaint' && scene.type === 'scene' && filename) {
    const linked = [...session.inpaints.values()].filter(
      (work) =>
        work.workflowType === type &&
        work.sceneRef === scene.name &&
        work.sourceImage === filename &&
        work.preset.image,
    );
    const existing = linked.find((work) => work.imageMap.length) || linked[0];
    if (existing) {
      open(existing);
      return;
    }
  }
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

/** An image already resolved one prompt; do not inherit its parent scene's combinations. */
export async function createSourceVariant(
  session: Session,
  scene: GenericScene,
  workflowType: string,
  path: string,
  open: (work: InpaintScene) => void,
) {
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
      sceneRef: scene.type === 'scene' ? scene.name : undefined,
      sourceImage: scene.type === 'scene' ? sourceImage : undefined,
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
      meta: { 'codex.singleImageEdit.v1': true },
      ...inpaintSceneResolutionFields(workflowType, scene, fromImage),
      sceneRef: scene.type === 'scene' ? scene.name : scene.sceneRef,
      sourceImage: scene.type === 'scene' ? sourceImage : undefined,
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
