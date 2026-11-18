import { runInAction } from 'mobx';
import { backend, imageHistoryService, imageService, sessionService, taskQueueService } from '.';
import type { GenerationHistoryEntry } from './ImageHistoryService';
import type { GenericScene, Session } from './types';
import { linkedImageVariants, GALLERY_ORDER_KEY, galleryImageKey } from './sceneImageVariants';
import { moveCombinedGalleryImage } from './galleryReorder';
import { projectAuxiliaryDir } from './projectAuxiliaryPaths';
import { undoService } from './undoService';

/** Move one image and its live descendant work tree. All paths are resolved from live models. */
export async function dropHistoryImage(entry: GenerationHistoryEntry, session: Session,
  target: GenericScene, anchor?: string, after = false, record = true): Promise<string> {
  const source = await imageHistoryService.resolve(entry);
  if (!source) throw new Error('원본 이미지의 씬을 찾을 수 없습니다.');
  if (source.session !== session) throw new Error('같은 프로젝트의 씬으로 이동해 주세요.');
  const owner = source.scene;
  const oldPath = imageService.getOutputDir(session, owner) + '/' + entry.filename;
  const gallery = imageService.getSceneGalleryEntries(session, target);
  const sameGallery = gallery.some(item => item.path === oldPath);
  if (sameGallery) {
    if (!anchor || oldPath === anchor) return oldPath;
    const paths = gallery.map(item => item.path);
    // Existing gallery reordering owns ranking, manual order, and undo.
    await moveCombinedGalleryImage(session, target, paths,
      new Map(gallery.map(item => [item.path, item.owner])), oldPath, anchor, paths, [oldPath]);
    return oldPath;
  }
  if (owner === target) return oldPath;
  if (sessionService.isMirror(session.name) ||
      !await sessionService.guardCrossWindowLock(session.name, '이미지 이동')) {
    throw new Error('이 창에서 프로젝트를 수정할 수 없습니다.');
  }
  let destination = '';
  await sessionService.withLock([session.name], async () => {
    if (session.getScene(owner.type, owner.name) !== owner || session.getScene(target.type, target.name) !== target) {
      throw new Error('씬이 변경됐습니다. 다시 시도해 주세요.');
    }
    const children = linkedImageVariants(owner, session.inpaints.values(), entry.filename);
    const variants = [...children];
    for (let i = 0; i < variants.length; i++) {
      for (const child of session.inpaints.values()) {
        if (child.sourceInpaint === variants[i].name && !variants.includes(child)) variants.push(child);
      }
    }
    if (target.type === 'inpaint' && variants.includes(target)) throw new Error('자신의 하위 변형 작업으로 옮길 수 없습니다.');
    for (const scene of [owner, target, ...variants]) {
      const stats = taskQueueService.statsTasksFromScene(session, scene);
      if (stats.total > stats.done) throw new Error(`“${scene.name}”의 생성 예약을 완료하거나 제거한 뒤 이동해 주세요.`);
    }
    const dir = imageService.getOutputDir(session, target);
    const dot = entry.filename.lastIndexOf('.');
    let filename = entry.filename, index = 1;
    while (await backend.existFile(dir + '/' + filename)) {
      filename = entry.filename.slice(0, dot) + '_moved' + index++ + entry.filename.slice(dot);
    }
    destination = dir + '/' + filename;
    const rootName = target.type === 'scene' ? target.name : target.sceneRef;
    const json = JSON.parse(JSON.stringify(session.toJSON()));
    const original = JSON.parse(JSON.stringify(json));
    const jsonScene = (scene: GenericScene, value = json) =>
      (scene.type === 'scene' ? value.scenes : value.inpaints)[scene.name];
    const from = jsonScene(owner), to = jsonScene(target);
    from.imageMap = from.imageMap.filter((name: string) => name !== entry.filename);
    to.imageMap = [filename, ...to.imageMap.filter((name: string) => name !== filename)];
    const favorite = from.mains.includes(entry.filename);
    from.mains = from.mains.filter((name: string) => name !== entry.filename);
    if (favorite) to.mains = [...to.mains, filename];
    const account = from.imageAccounts?.[entry.filename];
    if (account) { delete from.imageAccounts[entry.filename]; to.imageAccounts = { ...to.imageAccounts, [filename]: account }; }
    if (from.game) from.game = from.game.filter((item: any) => item.path !== entry.filename);
    from.round = undefined;
    const moves: { from: string; to: string; directory: boolean }[] = [{ from: oldPath, to: destination, directory: false }];
    const movedPaths = new Map([[oldPath, destination]]);
    for (const variant of variants) {
      const next = json.inpaints[variant.name];
      next.sceneRef = rootName;
      if (children.includes(variant)) {
        next.sourceImage = filename;
        next.sourceInpaint = target.type === 'inpaint' ? target.name : undefined;
      }
      const fromDir = imageService.getOutputDir(session, variant);
      const toDir = imageService.getOutputDir(session, { ...variant, ...next });
      if (fromDir !== toDir) {
        moves.push({ from: fromDir, to: toDir, directory: true });
        // Deleted result images live in a project-level trash folder.
        const oldTrash = projectAuxiliaryDir(fromDir, 'images');
        const newTrash = projectAuxiliaryDir(toDir, 'images');
        if (oldTrash !== newTrash) moves.push({ from: oldTrash, to: newTrash, directory: true });
        for (const name of variant.imageMap) movedPaths.set(fromDir + '/' + name, toDir + '/' + name);
      }
    }
    const key = galleryImageKey(target, filename, target);
    const keys = gallery.map(item => galleryImageKey(item.owner, item.filename, target));
    const anchorKey = gallery.find(item => item.path === anchor);
    keys.splice(anchorKey ? keys.indexOf(galleryImageKey(anchorKey.owner, anchorKey.filename, target)) + Number(after) : 0, 0, key);
    to.meta[GALLERY_ORDER_KEY] = keys;
    const completed: typeof moves = [];
    const applyModels = (value: any) => runInAction(() => {
      for (const scene of [owner, target]) {
        const saved = jsonScene(scene, value);
        scene.imageMap = saved.imageMap; scene.mains = saved.mains;
        scene.game = saved.game; scene.round = saved.round; scene.imageAccounts = saved.imageAccounts;
        if (saved.meta[GALLERY_ORDER_KEY] === undefined) scene.meta.delete(GALLERY_ORDER_KEY);
        else scene.meta.set(GALLERY_ORDER_KEY, saved.meta[GALLERY_ORDER_KEY]);
      }
      for (const variant of variants) {
        const saved = value.inpaints[variant.name];
        variant.sceneRef = saved.sceneRef; variant.sourceImage = saved.sourceImage;
        variant.sourceInpaint = saved.sourceInpaint;
      }
    });
    try {
      for (const move of moves) {
        if (!await backend.existFile(move.from)) {
          if (!move.directory) throw new Error('원본 이미지 파일을 찾을 수 없습니다.');
          continue;
        }
        if (await backend.existFile(move.to)) throw new Error('대상 경로에 같은 파일이나 작업 폴더가 있습니다.');
        try {
          if (move.directory) await backend.renameDir(move.from, move.to);
          else await backend.renameFile(move.from, move.to);
        } finally {
          if (!await backend.existFile(move.from) && await backend.existFile(move.to)) completed.push(move);
        }
        if (completed.at(-1) !== move) throw new Error('파일 이동을 확인하지 못했습니다.');
      }
      await sessionService.commitSceneMerge(session, json);
      applyModels(json);
    } catch (error) {
      const failures = [];
      for (const move of completed.reverse()) {
        try {
          if (move.directory) await backend.renameDir(move.to, move.from);
          else await backend.renameFile(move.to, move.from);
        } catch (failure) { failures.push(failure); }
      }
      applyModels(original);
      if (failures.length) throw new Error('이동 복구 중 오류가 발생했습니다. 이미지를 다시 이동하지 말고 파일 위치를 확인해 주세요.');
      throw error;
    }
    imageHistoryService.relinkMovedImage(session.name, owner, target, entry.filename, filename, movedPaths);
    await imageService.refreshBatch(session);
  });
  if (record && undoService.canRecord(session)) {
    const movedEntry = { ...entry, id: destination, path: destination, sceneType: target.type, sceneName: target.name, filename: destination.split('/').pop()! };
    let current = movedEntry;
    const reverse = async (to: GenericScene) => {
      const path = await dropHistoryImage(current, session, to, undefined, false, false);
      current = { ...current, id: path, path, sceneType: to.type, sceneName: to.name, filename: path.split('/').pop()! };
    };
    undoService.record(session, {
      label: `이미지 이동: ${owner.name} → ${target.name}`,
      redo: () => reverse(target), undo: () => reverse(owner),
      verify: () => session.getScene(owner.type, owner.name) === owner && session.getScene(target.type, target.name) === target || '씬이 삭제됐습니다.',
    });
  }
  return destination;
}
