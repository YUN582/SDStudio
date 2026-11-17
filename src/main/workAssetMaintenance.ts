import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  collectAssetReferences,
  managedWorkAsset,
  vibeAssetToken,
  WORK_ASSET_META,
  workAssetId,
} from '../renderer/models/workAssets';

type WriteProject = (
  file: string,
  previous: string,
  next: string,
) => Promise<void>;
type Json = Record<string, any>;
const DAY = 86400000;
const BACKUP = 'work-assets-backup-v1';
const QUARANTINE = '.unused';
export interface WorkAssetMaintenanceResult {
  migrated: number;
  deferred: number;
  quarantined: number;
  removed: number;
  recovered: number;
}
async function stat(file: string) {
  try {
    const value = await fs.lstat(file);
    if (value.isSymbolicLink())
      throw new Error('링크 경로는 정리하지 않습니다.');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
}
async function directory(file: string, create = false) {
  const found = await stat(file);
  if (found && !found.isDirectory())
    throw new Error('폴더를 확인할 수 없습니다.');
  if (!found && create) await fs.mkdir(file);
  return !!found || create;
}
async function jsonFile(file: string, optional = false) {
  if (optional && !(await stat(file))) return undefined;
  const raw = await fs.readFile(file, 'utf8');
  return { raw, json: JSON.parse(raw.replace(/^\uFEFF/, '')) as Json };
}
async function replace(file: string, before: string | undefined, data: string) {
  const temporary = path.join(path.dirname(file), '.assets-' + randomUUID());
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    if (before !== undefined && (await fs.readFile(file, 'utf8')) !== before)
      throw new Error('정리 중 데이터가 바뀌어 중단했습니다.');
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
async function bytes(file: string) {
  return createHash('sha256')
    .update(new Uint8Array(await fs.readFile(file)))
    .digest('hex');
}
async function verifiedCopy(source: string, target: string) {
  if (!(await stat(source))?.isFile())
    throw new Error('입력 이미지가 없습니다: ' + source);
  await fs.copyFile(source, target, constants.COPYFILE_EXCL);
  if ((await bytes(source)) !== (await bytes(target)))
    throw new Error('이미지 복사 검증 실패');
}
/** Validate every ancestor before reads/moves; never follow junctions. */
async function assetPath(root: string, token: string, create = false) {
  const normalized = vibeAssetToken(token);
  if (normalized !== token) throw new Error('정규화되지 않은 이미지 경로');
  let parent = root;
  if (!(await directory(parent, create)))
    throw new Error('이미지 폴더가 없습니다.');
  const parts = token.split('/');
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part);
    if (!(await directory(parent, create))) return path.join(root, ...parts);
  }
  const target = path.join(root, ...parts);
  if (!target.startsWith(root + path.sep))
    throw new Error('이미지 경로가 프로젝트를 벗어났습니다.');
  await stat(target);
  return target;
}
async function listAssets(vibes: string): Promise<string[]> {
  if (!(await directory(vibes))) return [];
  const result: string[] = [];
  for (const item of await fs.readdir(vibes, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    if (item.name === 'works') {
      if (!(await directory(path.join(vibes, 'works')))) continue;
      for (const work of await fs.readdir(path.join(vibes, 'works'))) {
        if (
          !workAssetId(work) ||
          !(await directory(path.join(vibes, 'works', work)))
        )
          continue;
        for (const leaf of await fs.readdir(path.join(vibes, 'works', work))) {
          const token = `works/${work}/${leaf}`;
          if (
            managedWorkAsset(token) &&
            (await stat(await assetPath(vibes, token)))?.isFile()
          )
            result.push(token);
        }
      }
    } else if (
      /\.(png|webp)$/i.test(item.name) &&
      (await stat(path.join(vibes, item.name)))?.isFile()
    )
      result.push(item.name);
  }
  return result;
}
function sceneEntries(trash: Json, name: string, id: string, dir: string) {
  return Object.entries(trash.scenes || {}).filter(
    ([key, entry]: [string, any]) =>
      entry.projectId
        ? entry.projectId === id
        : entry.projectDir
          ? entry.projectDir === dir
          : key.startsWith(name + ':'),
  );
}
function replaceRefs(value: any, replacements: Map<string, string>): any {
  if (typeof value === 'string') {
    try {
      return replacements.get(vibeAssetToken(value)) ?? value;
    } catch {
      return value;
    }
  }
  if (Array.isArray(value))
    return value.map((item) => replaceRefs(item, replacements));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value))
      value[key] = replaceRefs(value[key], replacements);
  }
  return value;
}
/** Run only for unloaded, unqueued projects. Live undo/redo keeps its files until restart. */
export async function maintainWorkAssets(
  dataRoot: string,
  writeProject: WriteProject,
  allowedDirs: ReadonlySet<string>,
  options: { migrate?: boolean; now?: number } = {},
): Promise<WorkAssetMaintenanceResult> {
  const result = {
    migrated: 0,
    deferred: 0,
    quarantined: 0,
    removed: 0,
    recovered: 0,
  };
  const now = options.now ?? Date.now();
  const workspace = path.join(dataRoot, 'workspace');
  if (!(await directory(workspace))) return result;
  const trashFile = path.join(dataRoot, 'trash.json');
  // A missing/corrupt trash record must never turn recoverable images into garbage.
  const initialTrash = await jsonFile(trashFile, true);
  if (!initialTrash) return { ...result, deferred: allowedDirs.size };
  const trash = initialTrash.json;
  if (!trash.scenes || typeof trash.scenes !== 'object')
    throw new Error('휴지통 기록을 확인할 수 없습니다.');
  let trashRaw = initialTrash?.raw;
  for (const dir of allowedDirs) {
    if (!dir || path.basename(dir) !== dir || dir.startsWith('.')) {
      result.deferred++;
      continue;
    }
    try {
      const root = path.join(workspace, dir);
      if (!(await directory(root))) continue;
      const meta = (await jsonFile(path.join(root, 'meta.json')))!.json;
      const file = path.join(root, 'project.json');
      const current = (await jsonFile(file))!;
      const project = current.json;
      if (
        !meta.id ||
        !meta.name ||
        project.id !== meta.id ||
        (await stat(file + '.deleted'))
      )
        throw new Error('프로젝트 ID를 확인할 수 없습니다.');
      const vibes = path.join(root, 'vibes');
      if (!(await directory(vibes))) continue;
      const deleted = sceneEntries(trash, meta.name, meta.id, dir);
      const projectTrashBefore = JSON.stringify(deleted);
      let changed = 0;
      const migratedSources = new Set<string>();
      const ids = new Set<string>();
      const backup = path.join(root, BACKUP);
      const backupFiles = path.join(backup, 'vibes');
      const snapshot = async () => {
        await directory(backup, true);
        await directory(backupFiles, true);
        for (const [name, raw] of [
          ['project.json', current.raw],
          ['trash.json', projectTrashBefore],
        ]) {
          const dest = path.join(backup, name);
          if (!(await stat(dest)))
            await fs.writeFile(dest, raw, { flag: 'wx' });
        }
      };
      const migrateWork = async (work: Json) => {
        if (work.type !== 'inpaint' || !work.preset) return;
        const original = JSON.stringify(work);
        const id = work.meta?.[WORK_ASSET_META];
        const owner = workAssetId(id) && !ids.has(id) ? id : randomUUID();
        ids.add(owner);
        const replacements = new Map<string, string>();
        const roleRefs = new Map<string, string>();
        for (const [role, ref] of [
          ['input', work.preset.image],
          ['mask', work.preset.mask],
          ['drawing', work.meta?.['codex.inpaintDrawing.v1']?.layer],
        ]) {
          if (
            typeof ref === 'string' &&
            ref.length < 2048 &&
            /\.(png|webp)$/i.test(ref)
          )
            roleRefs.set(vibeAssetToken(ref), role);
        }
        const refs = collectAssetReferences(work);
        for (const token of refs) {
          if (token.startsWith(`works/${owner}/`)) continue;
          const source = await assetPath(vibes, token);
          if (!(await stat(source))?.isFile()) {
            if (roleRefs.has(token))
              throw new Error('작업 입력 파일이 없습니다: ' + token);
            continue;
          }
          await snapshot();
          const saved = await assetPath(backupFiles, token, true);
          if (!(await stat(saved))) await verifiedCopy(source, saved);
          else if ((await bytes(source)) !== (await bytes(saved)))
            throw new Error('기존 이관 백업과 이미지가 달라 보존했습니다.');
          const destToken = `works/${owner}/${roleRefs.get(token) ?? 'extra'}-${randomUUID()}.png`;
          const destination = await assetPath(vibes, destToken, true);
          await verifiedCopy(source, destination);
          replacements.set(token, destToken);
          migratedSources.add(token);
        }
        if (replacements.size) {
          replaceRefs(work, replacements);
          work.meta = { ...work.meta, [WORK_ASSET_META]: owner };
        }
        if (JSON.stringify(work) !== original) changed++;
      };
      if (options.migrate !== false) {
        // Prepare every copy before committing either active or deleted work references.
        try {
          for (const work of Object.values(project.inpaints || {}) as Json[])
            await migrateWork(work);
          for (const [, entry] of deleted)
            await migrateWork((entry as Json).sceneData);
          if (changed) {
            await writeProject(file, current.raw, JSON.stringify(project));
            const nextTrash = JSON.stringify(trash);
            if (JSON.stringify(deleted) !== projectTrashBefore) {
              await replace(trashFile, trashRaw, nextTrash);
              trashRaw = nextTrash;
            }
            result.migrated += changed;
          }
        } catch (error) {
          // Copies stay in place if the active JSON was committed before a trash write failed.
          // Leaving unused copies is recoverable; deleting a committed input is not.
          for (const [key, entry] of JSON.parse(projectTrashBefore))
            trash.scenes[key] = entry;
          result.deferred++;
          console.warn('작업 이미지 이관 보류:', dir, error);
          continue;
        }
      }
      // Fresh reads protect changes made while copying and all deleted work in this project.
      const fresh = (await jsonFile(file))!;
      const freshTrash = await jsonFile(trashFile, true);
      const trashFresh = freshTrash?.json ?? { scenes: {} };
      const unchanged = async () => {
        if (
          (await fs.readFile(file, 'utf8')) !== fresh.raw ||
          (await jsonFile(trashFile, true))?.raw !== freshTrash?.raw
        )
          throw new Error('정리 중 프로젝트나 휴지통이 바뀌었습니다.');
      };
      const refs = collectAssetReferences(fresh.json);
      for (const [, entry] of sceneEntries(trashFresh, meta.name, meta.id, dir))
        for (const token of collectAssetReferences(entry)) refs.add(token);
      // A recent .bak may be the only recovery source; keep its referenced assets too.
      const bak = await jsonFile(file + '.bak', true);
      if (bak)
        for (const token of collectAssetReferences(bak.json)) refs.add(token);
      const referenced = (token: string) =>
        refs.has(token) || refs.has(path.posix.basename(token));
      const quarantine = path.join(vibes, QUARANTINE);
      await directory(quarantine, true);
      const manifestFile = path.join(quarantine, 'manifest.json');
      const manifest = (await jsonFile(manifestFile, true))?.json ?? {
        version: 1,
        entries: {},
      };
      if (!manifest.entries || typeof manifest.entries !== 'object')
        throw new Error('미사용 파일 보관 기록이 손상됐습니다.');
      for (const [token, info] of Object.entries(manifest.entries) as [
        string,
        any,
      ][]) {
        if (!workAssetId(info.fileId) || !Number.isFinite(info.since))
          throw new Error('미사용 파일 보관 기록을 확인해 주세요.');
        const saved = path.join(quarantine, info.fileId + '.png');
        const destination = await assetPath(vibes, token, true);
        await unchanged();
        if (!(await stat(saved)) && (await stat(destination))?.isFile()) {
          if (referenced(token)) {
            delete manifest.entries[token];
            continue;
          }
          await fs.rename(destination, saved);
        }
        if (referenced(token)) {
          if (!(await stat(destination)) && (await stat(saved))?.isFile()) {
            await fs.rename(saved, destination);
            result.recovered++;
          }
          if (!(await stat(saved))) delete manifest.entries[token];
        } else if (now - info.since >= 14 * DAY) {
          if ((await stat(saved))?.isFile()) await fs.unlink(saved);
          delete manifest.entries[token];
          result.removed++;
        }
      }
      for (const token of await listAssets(vibes)) {
        if (referenced(token) || manifest.entries[token]) continue;
        const source = await assetPath(vibes, token);
        await unchanged();
        if (migratedSources.has(token)) {
          // Verified full rollback copy already exists in the dedicated migration backup.
          const saved = await assetPath(backupFiles, token);
          if ((await bytes(source)) === (await bytes(saved))) {
            await fs.unlink(source);
            result.removed++;
          }
          continue;
        }
        const fileId = randomUUID();
        manifest.entries[token] = { fileId, since: now };
        // Publish the recovery address before moving the file; restart can finish safely.
        await replace(manifestFile, undefined, JSON.stringify(manifest));
        await fs.rename(source, path.join(quarantine, fileId + '.png'));
        result.quarantined++;
      }
      await replace(manifestFile, undefined, JSON.stringify(manifest));
      // Only remove empty managed work directories, never a recursively computed target.
      const works = path.join(vibes, 'works');
      if (await directory(works))
        for (const id of await fs.readdir(works)) {
          if (workAssetId(id) && (await directory(path.join(works, id))))
            await fs.rmdir(path.join(works, id)).catch(() => {});
        }
    } catch (error) {
      result.deferred++;
      console.warn('작업 이미지 정리 보류:', dir, error);
    }
  }
  return result;
}
