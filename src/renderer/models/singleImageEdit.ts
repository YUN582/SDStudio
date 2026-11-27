import { imageService, sessionService } from '.';
import { appState } from './AppService';
import { variantComboMode } from './comboMode';
import { InpaintScene, Session } from './types';
import { dataUriToBase64 } from './ImageService';
import { extractPromptDataFromBase64 } from './util';
import { runInAction } from 'mobx';
import { combinationCount } from './PromptService';
import {
  applySourceImageCombination,
  sourceImageCombination,
  SOURCE_IMAGE_COMBINATION,
} from './sourceImageCombination';

export const SINGLE_IMAGE_EDIT = 'codex.singleImageEdit.v1';
export const SINGLE_IMAGE_BACKUP = 'codex.singleImagePromptBackup.v1';
export const KEEP_COMBINATIONS = 'codex.keepImageEditCombinations.v1';
export const EXPLICIT_COMBINATIONS = 'sdstudio.explicitImageEditCombinations.v1';

export function isSingleImageEdit(work: InpaintScene) {
  return (
    ['SDInpaint', 'SDI2I'].includes(work.workflowType) &&
    !!(work.sourceImage || work.meta?.get(SINGLE_IMAGE_EDIT)) &&
    !!work.preset?.image &&
    !work.meta?.get(EXPLICIT_COMBINATIONS)
  );
}

export function needsSingleImageDecision(work: InpaintScene) {
  return (
    isSingleImageEdit(work) &&
    !!variantComboMode(work) &&
    !(
      work.meta.get(SOURCE_IMAGE_COMBINATION) &&
      combinationCount(work as any) === 1
    )
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
    text: '이 이미지 편집 작업에는 원본 씬의 조합들이 들어 있습니다. 설정 공유 방식을 유지하면서 원본 이미지의 조합 1개만 사용할까요? 현재 조합은 백업에 보관됩니다.',
    items: [
      { text: '원본 이미지의 조합 1개만 사용', value: 'single' },
      { text: '현재 조합을 유지하고 조합별 생성', value: 'keep' },
    ],
  });
  if (!choice || !isCurrent()) return false;
  if (choice === 'keep') {
    work.meta.set(KEEP_COMBINATIONS, true);
    work.meta.set(EXPLICIT_COMBINATIONS, true);
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
  const middle = await sourceImageCombination(session, work, metadata);
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
  runInAction(() => {
    if (!work.meta.has(SINGLE_IMAGE_BACKUP))
      work.meta.set(SINGLE_IMAGE_BACKUP, JSON.parse(before));
    applySourceImageCombination(work, middle, metadata);
    work.meta.delete(KEEP_COMBINATIONS);
    work.meta.set(SINGLE_IMAGE_EDIT, true);
  });
  sessionService.markDirty(session.name);
  return true;
}
