import { PromptPiece } from './types';
import { v4 as uuidv4 } from 'uuid';
import type {
  ImportableMetadata,
  InpaintScene,
  PromptNode,
  Session,
} from './types';
import { reformat } from './PromptService';
import { expandVariantCombos, variantComboSource } from './variantCombo';

export const SOURCE_IMAGE_COMBINATION = 'sdstudio.sourceImageCombination.v1';

// Never sample random alternatives while trying to identify a generated image.
function staticPrompt(node: PromptNode): string | undefined {
  if (node.type === 'random') return undefined;
  if (node.type === 'text')
    return /\{[^{}]*\|/.test(node.text) ? undefined : node.text;
  const children = node.children.map(staticPrompt);
  return children.some((text) => text === undefined)
    ? undefined
    : reformat(children.join(','));
}

/** Keep the selected layout, but take only the combination recorded in this image. */
export async function sourceImageCombination(
  session: Session,
  work: InpaintScene,
  metadata: ImportableMetadata | undefined,
): Promise<string> {
  const exact = metadata?.sdstudioMetadata?.promptSource;
  if (exact) return exact.middlePrompt;

  // Older images lack section metadata. Accept only an exact, unambiguous match
  // against the copied combinations; never silently choose the first one.
  if (metadata?.prompt) {
    const source = variantComboSource(session, work);
    if (source) {
      const matches = (await expandVariantCombos(session, work, source))
        .filter((combo) => {
          const prompt = staticPrompt(combo.prompt);
          return (
            prompt !== undefined &&
            reformat(prompt) === reformat(metadata.prompt)
          );
        })
        .map((combo) =>
          combo.prompt.type === 'group'
            ? combo.prompt.sdstudioPromptSource?.middlePrompt
            : undefined,
        );
      const unique = [...new Set(matches)];
      if (unique.length === 1 && unique[0] !== undefined) return unique[0];
    }
  }
  throw new Error(
    '원본 이미지의 조합을 정확히 확인할 수 없습니다. 단일 프롬프트 방식을 선택하거나 생성 정보가 있는 원본 이미지를 사용해 주세요.',
  );
}

export function applySourceImageCombination(
  work: InpaintScene,
  middle: string,
  metadata: ImportableMetadata,
) {
  work.preset.prompt = middle;
  // Metadata already contains this image's resolved character prompts. Do not
  // append the source scene's per-piece character prompts for a second time.
  work.preset.characterPrompts = (metadata.characterPrompts ?? []).map(
    (cp) => ({ ...cp }),
  );
  work.preset.useCoords = metadata.useCoords ?? false;
  work.preset.legacyPromptConditioning =
    metadata.legacyPromptConditioning ?? false;
  work.slots = [
    [
      PromptPiece.fromJSON({
        id: uuidv4(),
        prompt: middle,
        characterPrompts: [],
        enabled: true,
      }),
    ],
  ];
  work.meta.set(SOURCE_IMAGE_COMBINATION, true);
}
