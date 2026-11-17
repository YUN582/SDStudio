import { imageService, gameService, sessionService } from '.';
import { recordImageOrder } from './imageStateUndo';
import { GALLERY_ORDER_KEY, galleryImageKey, sortGalleryEntries } from './sceneImageVariants';
import { undoService, UNDO_TEXT } from './undoService';
import type { GenericScene, Session } from './types';

export function reorderGalleryPaths(paths: string[], from: string, to: string, visible: string[], group: string[]): string[] {
  const fromIndex = visible.indexOf(from), toIndex = visible.indexOf(to);
  const selected = new Set(group), available = new Set(paths);
  if (fromIndex < 0 || toIndex < 0 || !available.has(to)) return paths;
  const moving = visible.filter(path => selected.has(path) && available.has(path));
  const members = new Set(moving);
  if (!members.has(from) || members.has(to)) return paths;
  const next = paths.filter(path => !members.has(path));
  next.splice(next.indexOf(to) + (fromIndex < toIndex ? 1 : 0), 0, ...moving);
  return next.every((path, index) => path === paths[index]) ? paths : next;
}

export async function moveGalleryImage(session: Session, owner: GenericScene, from: string, to: string, fromIndex: number, toIndex: number) {
  const dragged = from.split('/').pop(), target = to.split('/').pop();
  if (!dragged || !target || dragged === target) return;
  await recordImageOrder(session, owner, async () => {
    const sourceIndex = owner.imageMap.indexOf(dragged);
    if (sourceIndex < 0 || !owner.imageMap.includes(target)) return;
    const draggedRank = owner.game?.find(player => player.path === dragged);
    const targetRank = owner.game?.find(player => player.path === target);
    if (draggedRank) owner.game!.splice(owner.game!.indexOf(draggedRank), 1);
    if (targetRank) owner.game!.push({ path: dragged, rank: targetRank.rank });
    if (draggedRank || targetRank) { gameService.cleanGame(owner.game!); owner.round = undefined; }
    owner.imageMap.splice(sourceIndex, 1);
    owner.imageMap.splice(owner.imageMap.indexOf(target) + (fromIndex > toIndex ? 1 : 0), 0, dragged);
    await imageService.refresh(session, owner);
  });
}

export async function moveCombinedGalleryImage(session: Session, scene: GenericScene, paths: string[], owners: ReadonlyMap<string, GenericScene>, from: string, to: string, visible: string[], group: string[]) {
  const owner = owners.get(from), targetOwner = owners.get(to);
  if (!owner || !targetOwner) return;
  if (group.length === 1 && owner === targetOwner && !Array.isArray(scene.meta.get(GALLERY_ORDER_KEY))) {
    await moveGalleryImage(session, owner, from, to, visible.indexOf(from), visible.indexOf(to));
    return;
  }
  const next = reorderGalleryPaths(paths, from, to, visible, group);
  if (next === paths) return;
  const order = next.map(path => imageService.getGalleryImageKey(owners.get(path)!, path.split('/').pop()!, scene));
  await saveGalleryOrder(session, scene, order);
}

/** Sort the whole scene, including linked work results, without moving any files. */
export async function sortSceneGallery(session: Session, scene: GenericScene): Promise<boolean> {
  const entries = imageService.getSceneGalleryEntries(session, scene);
  const sorted = sortGalleryEntries(entries);
  if (sorted.every((entry, index) => entry.path === entries[index].path)) return false;
  await saveGalleryOrder(session, scene, sorted.map(entry => galleryImageKey(entry.owner, entry.filename, scene)));
  return true;
}

async function saveGalleryOrder(session: Session, scene: GenericScene, order: string[]) {
  const current = scene.meta.get(GALLERY_ORDER_KEY);
  const previous = Array.isArray(current) ? [...current] : current;
  const save = (value: unknown) => {
    if (value === undefined) scene.meta.delete(GALLERY_ORDER_KEY);
    else scene.meta.set(GALLERY_ORDER_KEY, value);
    sessionService.markDirty(session.name);
  };
  if (!undoService.canRecord(session)) { save(order); return; }
  await undoService.run(session, UNDO_TEXT.imageOrderDrag(scene.name), {
    apply: () => save(order), revert: () => save(previous),
    verify: () => session.getScene(scene.type, scene.name) === scene || UNDO_TEXT.sceneGone(scene.name),
  });
}
