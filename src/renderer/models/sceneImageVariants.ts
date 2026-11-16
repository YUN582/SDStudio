import type { GenericScene, InpaintScene } from './types';

export interface SceneGalleryEntry {
  owner: GenericScene;
  filename: string;
  path: string;
}

export const GALLERY_ORDER_KEY = '__sdstudioGalleryOrderV1';

export function galleryFavoritePlan(groups: ReadonlyMap<GenericScene, readonly string[]>) {
  const targets: { scene: GenericScene; filenames: string[] }[] = [];
  let count = 0;
  let add = false;
  for (const [scene, paths] of groups) {
    const filenames = [...new Set(paths.map(path => path.split('/').pop()!).filter(Boolean))];
    if (!filenames.length) continue;
    targets.push({ scene, filenames });
    count += filenames.length;
    if (filenames.some(filename => !scene.mains.includes(filename))) add = true;
  }
  return { targets, count, add };
}

export function galleryImageKey(owner: GenericScene, filename: string, scene: GenericScene): string {
  return JSON.stringify([owner.type === 'scene' || owner === scene ? null : owner.name, filename]);
}

/** Merge newest queue heads without changing each owner's manual order. */
export function orderGalleryEntries(queues: SceneGalleryEntry[][], scene: GenericScene): SceneGalleryEntry[] {
  const entries: SceneGalleryEntry[] = [];
  const cursors = queues.map(() => 0);
  const timestamp = (entry?: SceneGalleryEntry) => Number(/^(\d{13})/.exec(entry?.filename ?? '')?.[1] ?? 0);
  while (true) {
    let next = -1;
    for (let i = 0; i < queues.length; i += 1) {
      const head = queues[i][cursors[i]];
      if (head && (next < 0 || timestamp(head) > timestamp(queues[next][cursors[next]]))) next = i;
    }
    if (next < 0) break;
    entries.push(queues[next][cursors[next]++]);
  }
  const order = scene.meta?.get(GALLERY_ORDER_KEY);
  if (!Array.isArray(order) || !order.length) return entries;
  const remaining = new Map(entries.map(entry => [galleryImageKey(entry.owner, entry.filename, scene), entry]));
  const ordered: SceneGalleryEntry[] = [];
  for (const key of order) {
    const entry = remaining.get(key);
    if (!entry) continue;
    ordered.push(entry);
    remaining.delete(key);
  }
  return [...remaining.values(), ...ordered];
}

export function selectGalleryExportEntries(entries: SceneGalleryEntry[], favoritesOnly: boolean, selectedPaths?: Iterable<string>): SceneGalleryEntry[] {
  if (selectedPaths) {
    const byPath = new Map(entries.map(entry => [entry.path, entry]));
    return [...new Set(selectedPaths)].flatMap(path => {
      const entry = byPath.get(path);
      return entry ? [entry] : [];
    });
  }
  if (!favoritesOnly) return entries;
  const favorites = entries.filter(entry => entry.owner.mains.includes(entry.filename));
  return favorites.length ? favorites : entries.slice(0, 1);
}

export type SceneImageFilter = 'all' | 'original' | 'variant';

/** The first favorite in the visible/manual order wins, regardless of image owner. */
export function galleryPreviewEntry(entries: readonly SceneGalleryEntry[]) {
  return entries.find(({ owner, filename }) => owner.mains.includes(filename)) ?? entries[0];
}

export function linkedImageVariants(
  scene: GenericScene,
  variants: Iterable<InpaintScene>,
  sourceFilename?: string,
): InpaintScene[] {
  return Array.from(variants).filter((variant) =>
    (scene.type === 'scene'
      ? variant.sceneRef === scene.name && (sourceFilename === undefined || !variant.sourceInpaint)
      : variant.sourceInpaint === scene.name) &&
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
