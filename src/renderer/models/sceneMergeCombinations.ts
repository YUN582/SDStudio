import { v4 } from 'uuid';
import { combinationCount, enumerateCombinations, toPARR } from './PromptService';
import { PromptPiece, type Scene } from './types';

export type SceneMergeMode = 'combine' | 'overwrite';

// The editor stores a Cartesian product per scene. Joining those products
// requires one column of complete candidates to avoid cross-scene combinations.
export function mergeSceneCombinations(
  scenes: readonly Scene[],
  overwriteFrom?: Scene,
) {
  if (overwriteFrom) {
    return overwriteFrom.slots.map((column) =>
      column.map((piece) => PromptPiece.fromJSON(piece.toJSON())),
    );
  }
  const flattenedCount = scenes.filter((scene) => scene.slots.length > 1)
    .reduce((count, scene) => count + combinationCount(scene), 0);
  if (flattenedCount > 20_000) {
    throw new Error('조합 20,000개를 초과해 한 씬에 펼칠 수 없습니다. 덮어쓰기를 사용하거나 더 작은 묶음으로 합쳐 주세요.');
  }
  const candidates: PromptPiece[] = [];
  const usedIds = new Set<string>();
  const append = (piece: ReturnType<PromptPiece['toJSON']>) => {
    const id = !piece.id || usedIds.has(piece.id) ? v4() : piece.id;
    usedIds.add(id);
    candidates.push(PromptPiece.fromJSON({ ...piece, id }));
  };
  const joinPrompt = (parts: string[]) => parts.flatMap(toPARR).join(', ');
  for (const scene of scenes) {
    if (scene.slots.length === 1) {
      scene.slots[0].forEach((piece) => append(piece.toJSON()));
      continue;
    }
    for (const combination of enumerateCombinations(scene)) {
      const pieces = combination.map(({ piece }) => piece);
      const characterCount = Math.max(0, ...pieces.map((piece) => piece.characterPrompts.length));
      append({
        id: v4(),
        name: scene.name,
        prompt: joinPrompt(pieces.map((piece) => piece.prompt)),
        characterPrompts: Array.from({ length: characterCount }, (_, i) =>
          joinPrompt(pieces.map((piece) => piece.characterPrompts[i] ?? '')),
        ),
      });
    }
  }
  return [candidates];
}

export function mergeSceneSettingsDiffer(a: Scene, b: Scene) {
  const keys = ['resolution', 'resolutionWidth', 'resolutionHeight', 'sceneSeed',
    'sceneUC', 'sceneCharacterUC', 'sceneCharacterPrompts', 'sceneCharacterPromptMode',
    'useSceneCharacterPrompts'] as const;
  return keys.some((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])) ||
    JSON.stringify(Array.from(a.meta.entries())) !== JSON.stringify(Array.from(b.meta.entries()));
}
