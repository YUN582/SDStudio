import { moveProjectDirectory } from './projectAuxiliaryStorage';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface VariantRecord {
  type?: string;
  name?: string;
  workflowType?: string;
  sceneRef?: string;
  imageMap?: unknown[];
  outputInSourceScene?: boolean;
}

interface ProjectRecord {
  id?: string;
  name?: string;
  scenes?: Record<string, { name?: string }>;
  inpaints?: Record<string, VariantRecord>;
}

type WriteProject = (file: string, previous: string, next: string) => Promise<void>;

const BACKUP_DIR = 'variant-output-backup-v1';

function safeLeaf(name: string | undefined): name is string {
  return typeof name === 'string' && name.length > 0 &&
    !/^[.]|[. ]$|[<>:"/\\|?*\x00-\x1f]/.test(name) &&
    !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name);
}

async function statIfPresent(file: string) {
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('링크 경로의 이관을 보류했습니다.');
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function checkDirectory(directory: string, create = false): Promise<boolean> {
  const stat = await statIfPresent(directory);
  if (stat?.isDirectory()) return true;
  if (stat) throw new Error('폴더 위치에 파일이 있습니다.');
  if (!create) return false;
  await fs.mkdir(directory);
  return true;
}

async function removeStage(stage: string, files: Map<string, string | null>) {
  for (const [relative, hash] of [...files].reverse()) {
    const item = path.join(stage, relative);
    if (hash === null) await fs.rmdir(item).catch(() => {});
    else await fs.unlink(item).catch(() => {});
  }
  await fs.rmdir(stage).catch(() => {});
}

async function digest(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function snapshot(directory: string): Promise<Map<string, string | null>> {
  const entries = new Map<string, string | null>();
  async function visit(parent: string, prefix: string) {
    for (const name of (await fs.readdir(parent)).sort()) {
      const file = path.join(parent, name);
      const key = prefix + name;
      const stat = await statIfPresent(file);
      if (stat?.isDirectory()) {
        entries.set(key, null);
        await visit(file, key + '/');
      } else if (stat?.isFile()) {
        entries.set(key, await digest(file));
      } else throw new Error('이관 중 원본 폴더가 바뀌었습니다.');
    }
  }
  await visit(directory, '');
  return entries;
}

function sameFiles(left: Map<string, string | null>, right: Map<string, string | null>): boolean {
  return left.size === right.size && [...left].every(([name, hash]) => right.get(name) === hash);
}

/**
 * Update active workspace projects before the project registry and history load.
 * The old folder remains readable until its new copy and the new JSON are durable.
 * A retry adopts an existing destination only when all bytes match.
 */
export async function migrateVariantOutputs(
  dataRoot: string,
  writeProject?: WriteProject,
  activeProjects?: ReadonlySet<string>,
): Promise<{ migrated: number; deferred: number }> {
  const result = { migrated: 0, deferred: 0 };
  const workspace = path.join(dataRoot, 'workspace');
  if (!(await checkDirectory(workspace))) return result;

  for (const entry of await fs.readdir(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || !safeLeaf(entry.name)) continue;
    if (activeProjects && !activeProjects.has(entry.name)) continue;
    const projectDir = path.join(workspace, entry.name);
    const projectFile = path.join(projectDir, 'project.json');
    const metaFile = path.join(projectDir, 'meta.json');
    try {
      if (await statIfPresent(projectFile + '.deleted')) continue;
      if (!(await statIfPresent(projectFile))?.isFile() || !(await statIfPresent(metaFile))?.isFile()) continue;
      const original = await fs.readFile(projectFile, 'utf8');
      const project: ProjectRecord = JSON.parse(original);
      const meta: { id?: string; name?: string } = JSON.parse(await fs.readFile(metaFile, 'utf8'));
      const candidates = Object.entries(project.inpaints ?? {}).filter(([name, job]) =>
        job?.type === 'inpaint' && job.name === name && safeLeaf(name) &&
        (job.workflowType === 'SDInpaint' || job.workflowType === 'SDI2I' || job.workflowType === 'Augment') &&
        safeLeaf(job.sceneRef) && Object.hasOwn(project.scenes ?? {}, job.sceneRef) &&
        project.scenes?.[job.sceneRef]?.name === job.sceneRef,
      );
      if (!candidates.length) continue;
      if (!project.id || project.id !== meta.id || project.name !== meta.name) {
        result.deferred += candidates.filter(([, job]) => !job.outputInSourceScene).length;
        continue;
      }
      const legacyRoot = path.join(projectDir, 'inpaints');
      const hasLegacyRoot = await checkDirectory(legacyRoot);
      const nameCounts = new Map<string, number>();
      for (const name of Object.keys(project.inpaints ?? {})) {
        const key = name.toLowerCase();
        nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
      }
      const backups: { source: string; destination: string; name: string }[] = [];
      let migrated = 0;
      for (const [name, job] of candidates) {
        try {
          if (nameCounts.get(name.toLowerCase()) !== 1) {
            if (!job.outputInSourceScene) result.deferred++;
            continue;
          }
          const source = path.join(legacyRoot, name);
          const sourceExists = hasLegacyRoot && await checkDirectory(source);
          if (job.outputInSourceScene && !sourceExists) continue;
          if (!sourceExists) {
            if (job.imageMap?.length) {
              result.deferred++;
              continue;
            }
          } else {
            const before = await snapshot(source);
            if (!job.outputInSourceScene && job.imageMap?.some((file) =>
              typeof file !== 'string' || typeof before.get(file) !== 'string',
            )) {
              result.deferred++;
              continue;
            }
            const outputs = path.join(projectDir, 'outs');
            const parent = path.join(outputs, job.sceneRef!);
            const variants = path.join(parent, 'variants');
            for (const directory of [outputs, parent, variants]) await checkDirectory(directory, true);
            const destination = path.join(variants, name);
            if (!(await checkDirectory(destination))) {
              const stage = path.join(variants, '.migration-' + randomUUID());
              await fs.mkdir(stage);
              try {
                for (const [relative, hash] of before) {
                  const target = path.join(stage, relative);
                  if (hash === null) await fs.mkdir(target);
                  else await fs.copyFile(path.join(source, relative), target, constants.COPYFILE_EXCL);
                }
                if (!sameFiles(before, await snapshot(stage)) || !sameFiles(before, await snapshot(source))) {
                  throw new Error('원본과 복사본이 일치하지 않습니다.');
                }
                if (await statIfPresent(destination)) throw new Error('같은 이름의 결과 폴더가 생겼습니다.');
                await fs.rename(stage, destination);
              } catch (error) {
                await removeStage(stage, before);
                throw error;
              }
            }
            if (!sameFiles(before, await snapshot(destination)) || !sameFiles(before, await snapshot(source))) {
              throw new Error('원본과 새 경로의 파일이 일치하지 않습니다.');
            }
            moveProjectDirectory(projectDir, 'inpaints/' + name,
              ['outs', job.sceneRef!, 'variants', name].join('/'), false);
            backups.push({ source, destination, name });
          }
          if (!job.outputInSourceScene) {
            job.outputInSourceScene = true;
            migrated++;
          }
        } catch (error) {
          result.deferred++;
          console.warn('변형 작업 이관 보류', name, error);
        }
      }

      if (migrated) {
        const backupRoot = path.join(projectDir, BACKUP_DIR);
        await checkDirectory(backupRoot, true);
        const jsonBackup = path.join(backupRoot, 'project.json');
        if (!(await statIfPresent(jsonBackup))) {
          await fs.copyFile(projectFile, jsonBackup, constants.COPYFILE_EXCL);
        }
        const next = JSON.stringify(project);
        if (writeProject) await writeProject(projectFile, original, next);
        else {
          const temporary = path.join(backupRoot, 'project-' + randomUUID() + '.part');
          try {
            await fs.writeFile(temporary, next, { flag: 'wx' });
            if (await fs.readFile(projectFile, 'utf8') !== original) throw new Error('이관 중 프로젝트가 변경됐습니다.');
            await fs.rename(temporary, projectFile);
          } finally {
            await fs.unlink(temporary).catch(() => {});
          }
        }
        result.migrated += migrated;
      }

      // Keep the old outputs in a dedicated rollback folder after committing JSON.
      if (backups.length) {
        const backupRoot = path.join(projectDir, BACKUP_DIR);
        await checkDirectory(backupRoot, true);
        const outputBackup = path.join(backupRoot, 'inpaints');
        await checkDirectory(outputBackup, true);
        for (const { source, destination, name } of backups) {
          const backup = path.join(outputBackup, name);
          if (await statIfPresent(backup) ||
              !sameFiles(await snapshot(source), await snapshot(destination))) {
            result.deferred++;
            continue;
          }
          await fs.rename(source, backup);
        }
      }
    } catch (error) {
      result.deferred++;
      console.warn('프로젝트 변형 결과 이관 보류', entry.name, error);
    }
  }
  return result;
}
