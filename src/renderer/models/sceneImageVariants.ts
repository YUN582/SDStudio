import type { GenericScene, InpaintScene } from './types';

export type SceneImageFilter = 'all' | 'original' | 'variant';

export function linkedImageVariants(
  scene: GenericScene,
  variants: Iterable<InpaintScene>,
  sourceFilename?: string,
): InpaintScene[] {
  if (scene.type !== 'scene') return [];
  return Array.from(variants).filter((variant) =>
    variant.sceneRef === scene.name &&
    (sourceFilename === undefined || variant.sourceImage === sourceFilename),
  );
}

export function groupImagePaths(
  paths: Iterable<string>,
  owners: ReadonlyMap<string, GenericScene>,
): Map<GenericScene, string[]> {
  const groups = new Map<GenericScene, string[]>();
  for (const path of paths) {
    const owner = owners.get(path);
    if (!owner) continue;
    const group = groups.get(owner);
    if (group) group.push(path);
    else groups.set(owner, [path]);
  }
  return groups;
}
