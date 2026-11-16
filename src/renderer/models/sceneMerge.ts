import { runInAction } from 'mobx';
import { v4 } from 'uuid';
import { backend, imageHistoryService, imageService, sessionService, taskQueueService, trashService } from '.';
import { cleanGameRanks } from './imageRanking';
import { isOutputImageFile } from './imageFormats';
import { assertValidProjectName, projectPath, sceneOutputDir } from './projectPaths';
import { mergeSceneCombinations } from './sceneMergeCombinations';
import type { Scene, Session } from './types';
import { GALLERY_ORDER_KEY, galleryImageKey } from './sceneImageVariants';

type SourceImages = Map<string, Map<string, string>>;

export async function mergeSelectedScenes(
  session: Session,
  selected: readonly Scene[],
  target: Scene,
  overwriteFrom?: Scene,
) {
  const project = session.name;
  const sources = [...new Set(selected)].filter((scene) => scene !== target);
  if (sources.length === 0 || !selected.includes(target) ||
      (overwriteFrom && !sources.includes(overwriteFrom))) {
    throw new Error('남길 씬과 합칠 씬을 확인해 주세요.');
  }
  if (sessionService.isMirror(project) ||
      !(await sessionService.guardCrossWindowLock(project, '씬 합치기'))) {
    throw new Error('이 창에서 프로젝트를 수정할 수 없습니다.');
  }
  return sessionService.withLock([project], async () => {
    const scenes = [target, ...sources];
    const galleries = scenes.map(scene => ({scene, entries: imageService.getSceneGalleryEntries(session, scene)}));
    const sourceNames = new Set(sources.map((source) => source.name));
    const targetName = target.name;
    const targetDir = sceneOutputDir(project, target);
    const sourceDirs = sources.map((source) => sceneOutputDir(project, source));
    if (new Set([targetDir, ...sourceDirs].map((dir) => dir.toLowerCase())).size !== scenes.length) {
      throw new Error('같은 이미지 폴더를 사용하는 씬은 합칠 수 없습니다.');
    }
    const links = new Map([...session.inpaints.values()]
      .filter((variant) => sourceNames.has(variant.sceneRef ?? ''))
      .map((variant) => [variant, [variant.sceneRef, variant.name, variant.sourceImage, variant.outputInSourceScene, variant.sourceInpaint] as const]));
    const variants = [...links.keys()];
    const checkScenes = () => {
      if (session.name !== project || target.name !== targetName ||
          scenes.some((scene) => session.scenes.get(scene.name) !== scene) ||
          sources.some((source) => !sourceNames.has(source.name))) {
        throw new Error('씬 목록이 변경됐습니다. 대상을 다시 골라 주세요.');
      }
      const currentVariants = [...session.inpaints.values()].filter((variant) => sourceNames.has(variant.sceneRef ?? ''));
      if (currentVariants.length !== variants.length || currentVariants.some((variant) => {
        const link = links.get(variant);
        return !link || link[0] !== variant.sceneRef || link[1] !== variant.name ||
          link[2] !== variant.sourceImage || link[3] !== variant.outputInSourceScene || link[4] !== variant.sourceInpaint;
      })) {
        throw new Error('연결된 변형 작업이 변경됐습니다. 다시 시도해 주세요.');
      }
      const busy = [...scenes, ...variants].find((scene) => {
        const { total, done } = taskQueueService.statsTasksFromScene(session, scene);
        return total > done;
      });
      if (busy) throw new Error(`“${busy.name}”의 생성 예약을 완료하거나 제거한 뒤 합쳐 주세요.`);
    };
    checkScenes();
    for (const scene of [...scenes, ...variants]) assertValidProjectName(scene.name);
    const backup = projectPath('outs', project, '.scene-merge', v4());
    const names = new Set((await backend.listFiles(targetDir)).map((name) => name.toLowerCase()));
    const targetFiles = (await backend.listFilesWithStats(targetDir)).map(({ name }) => name).filter(isOutputImageFile);
    const copiedFiles = new Map<string, Map<string, number>>();
    const copiedVariantDirs: string[] = [];
    const archived: { from: string; to: string }[] = [];
    const imageNames: SourceImages = new Map();
    const movedPaths = new Map<string, string>();
    let restoreTrashRefs: (() => Promise<void>) | undefined;
    const copy = async (from: string, to: string, size: number) => {
      if (await backend.existFile(to)) throw new Error(`이미지 위치가 변경됐습니다. 다시 시도해 주세요. (${to})`);
      const index = to.lastIndexOf('/');
      const dir = to.slice(0, index);
      const files = copiedFiles.get(dir) ?? new Map<string, number>();
      files.set(to.slice(index + 1), size);
      copiedFiles.set(dir, files);
      await backend.copyFile(from, to);
    };
    const copyVariant = async (from: string, to: string) => {
      const files = await backend.listFilesWithStats(from);
      const fileNames = new Set(files.map(({ name }) => name));
      for (const { name, size } of files) await copy(from + '/' + name, to + '/' + name, size);
      for (const child of await backend.listFiles(from)) {
        if (!fileNames.has(child) && child !== 'fastcache') {
          await copyVariant(from + '/' + child, to + '/' + child);
        }
      }
    };
    const verifyCopies = async () => {
      for (const [dir, expected] of copiedFiles) {
        const actual = new Map((await backend.listFilesWithStats(dir)).map(({ name, size }) => [name, size]));
        for (const [name, size] of expected) {
          if (actual.get(name) !== size) {
            throw new Error(`이미지 복사를 확인하지 못했습니다. (${dir}/${name})`);
          }
        }
      }
    };
    const moveDirectory = async (from: string, to: string) => {
      if (await backend.existFile(to)) throw new Error(`폴더가 이미 존재합니다. (${to})`);
      try {
        await backend.renameDir(from, to);
      } finally {
        const [stillThere, arrived] = await Promise.all([backend.existFile(from), backend.existFile(to)]);
        if (!stillThere && arrived) archived.push({ from, to });
        if (stillThere || !arrived) throw new Error(`씬 폴더 이동을 확인하지 못했습니다. (${from})`);
      }
    };
    const applyFiles = async () => {
      for (const source of sources) {
        const dir = sceneOutputDir(project, source);
        const mappings = new Map<string, string>();
        imageNames.set(source.name, mappings);
        for (const { name, size } of await backend.listFilesWithStats(dir)) {
          if (!isOutputImageFile(name)) continue;
          assertValidProjectName(name);
          const dot = name.lastIndexOf('.');
          let filename = name;
          let index = 1;
          while (names.has(filename.toLowerCase())) {
            filename = `${name.slice(0, dot)}_merged${index++}${name.slice(dot)}`;
          }
          names.add(filename.toLowerCase());
          await copy(dir + '/' + name, targetDir + '/' + filename, size);
          mappings.set(name, filename);
          movedPaths.set(dir + '/' + name, targetDir + '/' + filename);
        }
      }
      for (const variant of variants) {
        if (!variant.outputInSourceScene) continue;
        const from = sceneOutputDir(project, variant);
        const to = sceneOutputDir(project, {
          type: 'inpaint', name: variant.name, sceneRef: target.name, outputInSourceScene: true,
        });
        if (!(await backend.existFile(from))) continue;
        if (await backend.existFile(to)) throw new Error(`변형 결과 폴더가 이미 존재합니다. (${variant.name})`);
        copiedVariantDirs.push(to);
        await copyVariant(from, to);
        for (const { name } of await backend.listFilesWithStats(from)) {
          if (isOutputImageFile(name)) movedPaths.set(from + '/' + name, to + '/' + name);
        }
      }
      await verifyCopies();
      checkScenes();
      for (const source of sources) {
        const from = sceneOutputDir(project, source);
        if (!(await backend.existFile(from))) continue;
        const stillPresent = (await backend.listFilesWithStats(from))
          .map(({ name }) => name).filter(isOutputImageFile);
        const mappings = imageNames.get(source.name)!;
        if (stillPresent.length !== mappings.size || stillPresent.some((name) => !mappings.has(name))) {
          throw new Error('합치는 중 씬 이미지가 변경됐습니다. 다시 시도해 주세요.');
        }
        await moveDirectory(from, backup + '/outs/' + source.name);
      }
    };
    const slots = mergeSceneCombinations(scenes, overwriteFrom);
    const before = JSON.stringify(session.toJSON());
    await backend.writeFile(backup + '/project.json', before);
    await backend.writeFile(backup + '/outs/.gitkeep', '');
    await backend.writeFile(backup + '/moves.json', JSON.stringify({
      target: targetName,
      archived: sources.map((source, i) => ({ from: sourceDirs[i], to: backup + '/outs/' + source.name })),
    }, null, 2));
    try {
      await applyFiles();
      checkScenes();
      const json = session.toJSON();
      const nextTarget = json.scenes[target.name];
      const mapped = (fn: (source: Scene, names: Map<string, string>) => string[]) =>
        sources.flatMap((source) => fn(source, imageNames.get(source.name)!));
      const order = (items: readonly string[], present: Iterable<string>) => {
        const available = new Set(present);
        return [...new Set([...items.filter((name) => available.has(name)), ...available])];
      };
      nextTarget.slots = slots.map((column) => column.map((piece) => piece.toJSON()));
      nextTarget.imageMap = [
        ...order(target.imageMap, targetFiles),
        ...mapped((source, files) => order(source.imageMap, files.keys()).map((name) => files.get(name)!)),
      ];
      nextTarget.mains = [...new Set([
        ...target.mains.filter((name) => targetFiles.includes(name)),
        ...mapped((source, files) => source.mains.flatMap((name) => files.get(name) ?? [])),
      ])];
      nextTarget.meta[GALLERY_ORDER_KEY] = galleries.flatMap(({scene,entries}) => entries.flatMap(entry => {
        const filename = entry.owner.type === 'scene' && scene !== target
          ? imageNames.get(scene.name)?.get(entry.filename) : entry.filename;
        return filename ? [galleryImageKey(entry.owner, filename, target)] : [];
      }));
      const game = (target.game ?? []).filter((p) => targetFiles.includes(p.path)).map((p) => ({ ...p }));
      for (const source of sources) {
        const files = imageNames.get(source.name)!;
        for (const player of source.game ?? []) {
          const path = files.get(player.path);
          if (path) game.push({ ...player, path });
        }
      }
      if (game.length) cleanGameRanks(game);
      nextTarget.game = game.length ? game : undefined;
      nextTarget.round = undefined;
      nextTarget.imageAccounts = Object.fromEntries(scenes.flatMap((scene) => {
        const files = imageNames.get(scene.name);
        return Object.entries(scene.imageAccounts ?? {}).flatMap(([name, account]) => {
          const filename = files ? files.get(name) : targetFiles.includes(name) ? name : undefined;
          return filename ? [[filename, account]] : [];
        });
      }));
      for (const source of sources) delete json.scenes[source.name];
      for (const variant of variants) {
        const nextVariant = json.inpaints[variant.name];
        nextVariant.sceneRef = target.name;
        nextVariant.sourceImage = variant.sourceInpaint ? variant.sourceImage
          : variant.sourceImage && imageNames.get(variant.sceneRef!)?.get(variant.sourceImage);
      }
      await backend.writeFile(backup + '/moves.json', JSON.stringify({
        target: target.name, sources: [...sourceNames], archived, files: [...movedPaths],
      }, null, 2));
      restoreTrashRefs = await trashService.relinkMergedVariantSources(session, imageNames, target.name);
      checkScenes();
      await sessionService.commitSceneMerge(session, json);
      runInAction(() => {
        target.slots = slots;
        target.imageMap = nextTarget.imageMap;
        target.mains = nextTarget.mains;
        target.meta.set(GALLERY_ORDER_KEY, nextTarget.meta[GALLERY_ORDER_KEY]);
        target.game = nextTarget.game;
        target.round = nextTarget.round;
        target.imageAccounts = nextTarget.imageAccounts;
        for (const source of sources) session.scenes.delete(source.name);
        for (const variant of variants) {
          variant.sceneRef = target.name;
          variant.sourceImage = json.inpaints[variant.name].sourceImage;
        }
      });
    } catch (error) {
      const failures: unknown[] = [];
      const recover = async (operation: () => Promise<void>) => {
        try { await operation(); } catch (failure) { failures.push(failure); }
      };
      if (restoreTrashRefs) await recover(restoreTrashRefs);
      for (const { from, to } of archived.reverse()) {
        await recover(async () => {
          if (await backend.existFile(from)) throw new Error(from);
          await backend.renameDir(to, from);
          if (!(await backend.existFile(from))) throw new Error(from);
        });
      }
      for (const [dir, files] of copiedFiles) {
        for (const filename of files.keys()) {
          const path = dir + '/' + filename;
          await recover(async () => {
            if (await backend.existFile(path)) await backend.deleteFile(path);
          });
        }
      }
      for (const dir of copiedVariantDirs.reverse()) {
        await recover(async () => {
          if (await backend.existFile(dir)) await backend.deleteDir(dir);
        });
      }
      if (failures.length) {
        console.error('씬 합치기 복구 오류', error, failures);
        throw new Error(`합치기에 실패했고 일부 파일을 원위치로 돌리지 못했습니다. 백업 위치 ${backup}`);
      }
      throw error;
    }
    const movedCount = [...imageNames.values()].reduce((count, files) => count + files.size, 0);
    imageHistoryService.relinkMergedScenes(project, target.name, imageNames, movedPaths);
    const refresh = await Promise.allSettled([
      sessionService.relinkMergedSceneBookmarks(project, target.name, imageNames),
      imageService.refreshBatch(session),
    ]);
    return { backup, movedCount, variantCount: variants.length, refreshFailed: refresh.some((r) => r.status === 'rejected') };
  });
}
