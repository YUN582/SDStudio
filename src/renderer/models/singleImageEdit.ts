import { imageService, workFlowService, sessionService } from '.';
import { appState } from './AppService';
import { variantComboMode } from './comboMode';
import { InpaintScene, Session } from './types';
import { dataUriToBase64 } from './ImageService';
import { extractPromptDataFromBase64 } from './util';
import { runInAction } from 'mobx';

export const SINGLE_IMAGE_EDIT = 'codex.singleImageEdit.v1';
export const SINGLE_IMAGE_BACKUP = 'codex.singleImagePromptBackup.v1';
const KEEP_COMBINATIONS = 'codex.keepImageEditCombinations.v1';
const promptKeys = [
  'prompt',
  'uc',
  'characterPrompts',
  'useCoords',
  'legacyPromptConditioning',
] as const;

export function isSingleImageEdit(work: InpaintScene) {
  return (
    ['SDInpaint', 'SDI2I'].includes(work.workflowType) &&
    !!work.preset.image &&
    !!(work.sourceImage || work.meta.get(SINGLE_IMAGE_EDIT))
  );
}

export function needsSingleImageDecision(work: InpaintScene) {
  return (
    isSingleImageEdit(work) &&
    !!variantComboMode(work) &&
    !work.meta.get(KEEP_COMBINATIONS)
  );
}

/** Older image-entry work could inherit every parent combination. Never discard edits silently. */
export async function ensureSingleImagePrompt(
  session: Session,
  work: InpaintScene,
  isCurrent: () => boolean,
) {
  if (!needsSingleImageDecision(work)) return true;
  const choice = await appState.pushDialogAsync({
    type: 'select',
    text: '이 이미지 편집 작업에는 여러 프롬프트 조합이 들어 있습니다. 원본 이미지의 프롬프트 하나로 생성할까요? 현재 조합은 백업에 보관됩니다.',
    items: [
      { text: '원본 이미지 프롬프트 하나 사용', value: 'single' },
      { text: '현재 조합을 유지하고 조합별 생성', value: 'keep' },
    ],
  });
  if (!choice || !isCurrent()) return false;
  if (choice === 'keep') {
    work.meta.set(KEEP_COMBINATIONS, true);
    sessionService.markDirty(session.name);
    return true;
  }
  const before = JSON.stringify({
    comboMode: work.comboMode,
    preset: work.preset.toJSON?.() ?? { ...work.preset },
    slots: work.slots,
  });
  let data: string | null = null;
  try {
    data = await imageService.fetchInpaintInput(
      session,
      work,
      work.preset,
      false,
    );
  } catch {
    /* Snapshot may retain source metadata. */
  }
  let metadata = data
    ? await extractPromptDataFromBase64(dataUriToBase64(data))
    : undefined;
  if (!metadata?.prompt && /\.(png|webp)$/i.test(work.preset.image)) {
    data = await imageService.fetchVibeImage(session, work.preset.image);
    metadata = data
      ? await extractPromptDataFromBase64(dataUriToBase64(data))
      : undefined;
  }
  if (
    !isCurrent() ||
    before !==
      JSON.stringify({
        comboMode: work.comboMode,
        preset: work.preset.toJSON?.() ?? { ...work.preset },
        slots: work.slots,
      })
  )
    return false;
  if (!metadata?.prompt)
    throw new Error(
      '원본 이미지의 생성 정보를 찾지 못했습니다. 현재 조합을 유지하거나 프롬프트를 직접 확인해 주세요.',
    );
  const restored = workFlowService.createPreset(work.workflowType, metadata);
  runInAction(() => {
    if (!work.meta.has(SINGLE_IMAGE_BACKUP))
      work.meta.set(SINGLE_IMAGE_BACKUP, JSON.parse(before));
    for (const key of promptKeys)
      if (key in restored) work.preset[key] = restored[key];
    work.comboMode = undefined;
    work.meta.set(SINGLE_IMAGE_EDIT, true);
  });
  sessionService.markDirty(session.name);
  return true;
}
