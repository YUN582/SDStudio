import { runInAction } from 'mobx';
import { imageService, workFlowService } from '.';
import { appState } from './AppService';
import { GenericScene, ImportableMetadata, InpaintScene, ReferenceItem, Session, VibeItem } from './types';
import { naiCapabilitiesOf } from '../backends/genVendors/naiModelCapabilities';
import { referenceEditorSpec, newReferenceType } from './referenceEditorSpec';
import { editWorkflowFields } from './presetUndo';
import { recordScenesCreated } from './sceneStructureUndo';
import { UNDO_TEXT } from './undoService';
import { inpaintSceneResolutionFields, resolutionFromImage } from './inpaintResolution';
import { SINGLE_IMAGE_EDIT } from './singleImageEdit';
import { openSourceVariant } from './sourceVariant';
import { joinPromptSections } from './sdstudioPromptImport';
import { getOrderedBaseCharacterPrompts } from './sceneCharacterPrompts';

export type ImportedImageUse = 'vibe' | 'reference';
export interface ImportedReferenceDefaults {
  strength: number;
  fidelity: number;
  referenceType: string;
}

function currentTarget(session: Session) {
  const selected = session.selectedWorkflow;
  if (appState.curSession !== session || !selected) throw new Error('이미지를 사용할 프로젝트와 생성 설정을 먼저 선택해 주세요.');
  return { type: selected.workflowType, name: selected.presetName };
}

function checkTarget(session: Session, target: { type: string; name: string | undefined }) {
  const current = currentTarget(session);
  if (current.type !== target.type || current.name !== target.name) throw new Error('생성 설정이 바뀌었습니다. 이미지를 다시 추가해 주세요.');
}

/** Append the uploaded pixels, independently of generation metadata. */
export async function appendImportedImage(
  session: Session,
  image: string,
  use: ImportedImageUse,
  modelVersion: unknown,
  defaults: ImportedReferenceDefaults,
) {
  if (!image) throw new Error('추가할 이미지가 없습니다.');
  const target = currentTarget(session);
  const field = use === 'vibe' ? 'vibes' : 'characterReferences';
  const caps = naiCapabilitiesOf(modelVersion);
  if (!(use === 'vibe' ? caps.supportsVibeTransfer : caps.supportsCharacterReference)) throw new Error('현재 모델에서는 이 이미지 사용 방식을 지원하지 않습니다.');
  if (!workFlowService.getDef(target.type)?.sharedVars.some(variable => variable.name === field)) throw new Error('현재 생성 설정에서는 이 이미지 사용 방식을 지원하지 않습니다.');
  let shared = session.presetShareds.get(target.type);
  const stored = use === 'vibe'
    ? { path: await imageService.storeVibeImage(session, image, false, true) }
    : await imageService.storeReferenceImageWithSize(session, image);
  checkTarget(session, target);
  shared = session.presetShareds.get(target.type);
  const item = use === 'vibe'
    ? VibeItem.fromJSON({ path: stored.path, info: 1, strength: 0.6 })
    : ReferenceItem.fromJSON({
        ...stored,
        info: 1,
        strength: Math.min(caps.referenceStrengthMax, Math.max(0, Number.isFinite(defaults.strength) ? defaults.strength : 0.6)),
        fidelity: Number.isFinite(defaults.fidelity) ? defaults.fidelity : 1,
        referenceType: newReferenceType(referenceEditorSpec(modelVersion), defaults.referenceType as any),
      });
  runInAction(() => {
    if (!shared) {
      shared = workFlowService.buildShared(target.type);
      session.presetShareds.set(target.type, shared);
    }
    editWorkflowFields(session, { shared }, [['shared', field]], use === 'vibe' ? UNDO_TEXT.vibeAdd : UNDO_TEXT.referenceAdd, () => {
      shared[field] = [...(shared[field] ?? []), item];
    });
  });
}

/** Create one editable work. This never queues or starts generation. */
export async function createImportedI2I(
  session: Session,
  image: string,
  metadata?: ImportableMetadata,
  source?: { scene?: GenericScene; path?: string },
): Promise<InpaintScene | undefined> {
  if (!image) throw new Error('편집할 이미지가 없습니다.');
  const target = currentTarget(session);
  const owner = source?.scene && session.getScene(source.scene.type, source.scene.name) === source.scene ? source.scene : undefined;
  if (owner && source?.path && metadata) {
    let created: InpaintScene | undefined;
    await openSourceVariant(session, owner, 'SDInpaint', source.path, work => {
      work.preset.strength = 0.6;
      work.preset.mask = '';
      created = work;
    });
    return created;
  }
  const selected = session.presets.get(target.type)?.find(preset => preset.name === target.name);
  if (!metadata && !selected) throw new Error('현재 생성 설정을 찾을 수 없습니다.');
  const values = selected?.toJSON?.() ?? selected ?? {};
  const shared = session.presetShareds.get(target.type);
  const settings = metadata ?? {
    ...values,
    prompt: joinPromptSections(values.frontPrompt, session.extraPrompt, values.backPrompt),
    characterPrompts: getOrderedBaseCharacterPrompts(values, shared)
      .filter(character => character.enabled !== false)
      .map(character => ({ ...character })),
    vibes: shared?.vibes ?? [],
    characterReferences: shared?.characterReferences ?? [],
  };
  const resolution = await resolutionFromImage(image);
  checkTarget(session, target);
  let suffix = 1;
  const stem = owner ? owner.name + ' I2I' : '가져온 이미지';
  let name = stem;
  while (session.inpaints.has(name)) name = stem + ' ' + suffix++;
  const parent = owner?.type === 'scene' ? owner.name : owner?.sceneRef;
  const linked = !!(owner && source?.path);
  const work = InpaintScene.fromJSON({
    type: 'inpaint', name, workflowType: 'SDInpaint',
    preset: workFlowService.createPreset('SDInpaint', settings as any),
    meta: { [SINGLE_IMAGE_EDIT]: true },
    ...inpaintSceneResolutionFields('SDInpaint', owner ?? { resolution: 'portrait' } as GenericScene, resolution),
    sceneRef: linked ? parent : undefined,
    sourceImage: linked ? source!.path!.split('/').pop() : undefined,
    sourceInpaint: linked && owner?.type === 'inpaint' ? owner.name : undefined,
    outputInSourceScene: linked && parent && session.scenes.has(parent) ? true : undefined,
    imageMap: [], mains: [], slots: [],
  });
  if (!work) throw new Error('I2I 작업을 만들지 못했습니다.');
  // The unified editor sends I2I without a mask, and inpaints once a mask is drawn.
  work.preset.strength = 0.6;
  work.preset.mask = '';
  work.preset.image = await imageService.storeWorkImage(session, work, 'input', image);
  checkTarget(session, target);
  if (session.inpaints.has(name)) throw new Error('같은 이름의 작업이 추가되었습니다. 다시 시도해 주세요.');
  runInAction(() => session.addScene(work));
  recordScenesCreated(session, [work], UNDO_TEXT.variantSceneCreate(name));
  return work;
}
