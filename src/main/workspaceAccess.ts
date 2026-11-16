import * as workspaceFs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import chokidar from 'chokidar';

export interface WorkspaceLocation {
  resolved: string;
  root: string;
  dir: string;
  tail: string[];
}
export interface WorkspaceAccessOptions {
  allowMetaRepair?: boolean;
  allowInactive?: boolean;
}
export interface WorkspaceEntry {
  dir: string;
  id?: string;
  name?: string;
  folder?: string;
  state:
    | 'needs-meta'
    | 'deleted'
    | 'incomplete'
    | 'conflict'
    | 'changed'
    | 'active'
    | 'unreadable';
  hasBackup?: boolean;
  revision?: string;
}

/** Identity and disk-revision checks shared by desktop workspace IO. */
export function createWorkspaceAccess(
  getDataRoot: () => string,
  notifyChanged: () => void,
) {
  const workspacePathIds = new Map<string, string>();
  const workspaceRevisions = new Map<string, string | undefined>();
  const workspaceInitialized = new Set<string>();
  let workspaceConflicts = new Set<string>();
  let workspaceDirSignature: string | undefined;
  let workspaceLastScan = 0;
  let workspaceEntries: WorkspaceEntry[] = [];
  let workspaceWatcher: ReturnType<typeof chokidar.watch> | undefined;
  let workspaceTimer: ReturnType<typeof setTimeout> | undefined;
  function workspaceError(message: string) {
    return new Error('WORKSPACE_CHANGED: ' + message);
  }
  function workspaceLocation(
    relativePath: string,
  ): WorkspaceLocation | undefined {
    if (typeof relativePath !== 'string') return;
    const resolved = path.resolve(getDataRoot(), relativePath);
    const parts = path.relative(getDataRoot(), resolved).split(path.sep);
    if (
      parts.length < 2 ||
      parts[0].toLowerCase() !== 'workspace' ||
      (parts.length === 2 && parts[1] === '.keep')
    )
      return;
    const root = path.join(getDataRoot(), parts[0], parts[1]);
    return {
      resolved,
      root,
      dir: parts[1],
      tail: parts.slice(2),
    };
  }
  function workspaceStat(filename: string) {
    try {
      return workspaceFs.lstatSync(filename);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
        (error as NodeJS.ErrnoException).code !== 'ENOTDIR'
      )
        throw error;
      return undefined;
    }
  }
  function readWorkspaceMeta(root: string) {
    const directory = workspaceStat(root);
    if (!directory?.isDirectory() || directory.isSymbolicLink()) return;
    const filename = path.join(root, 'meta.json');
    if (!workspaceStat(filename)?.isFile()) return;
    let meta;
    try {
      meta = JSON.parse(
        workspaceFs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''),
      );
    } catch (error) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
    if (
      !meta ||
      typeof meta.id !== 'string' ||
      !meta.id ||
      typeof meta.name !== 'string' ||
      !meta.name.trim() ||
      meta.name.startsWith('.') ||
      /[\\/]/.test(meta.name)
    )
      return;
    return meta;
  }
  function workspaceRevision(stat: import('fs').Stats | undefined) {
    return stat?.isFile() ? stat.size + ':' + stat.mtimeMs : undefined;
  }
  function listWorkspaceDirectories(workspace: string) {
    return workspaceFs
      .readdirSync(workspace, {
        withFileTypes: true,
      })
      .filter(
        (item) =>
          !item.name.startsWith('.') &&
          (item.isDirectory() || item.isSymbolicLink()),
      )
      .map((item) => item.name)
      .sort();
  }
  function collectWorkspace() {
    const workspace = path.join(getDataRoot(), 'workspace');
    const dirs = listWorkspaceDirectories(workspace);
    const entries: WorkspaceEntry[] = [];
    const byId = new Map<string, WorkspaceEntry[]>();
    for (const dir of dirs) {
      const root = path.join(workspace, dir);
      try {
        const meta = readWorkspaceMeta(root);
        const bodyPath = path.join(root, 'project.json');
        const revision = workspaceRevision(workspaceStat(bodyPath));
        const deleted = workspaceStat(bodyPath + '.deleted')?.isFile();
        if (!meta) {
          if (revision || deleted)
            entries.push({
              dir,
              state: 'needs-meta',
            });
          continue;
        }
        const entry: WorkspaceEntry = {
          dir,
          id: meta.id,
          name: meta.name,
          folder: typeof meta.folder === 'string' ? meta.folder : '',
          state: deleted ? 'deleted' : 'incomplete',
        };
        if (revision && deleted) {
          entry.state = 'conflict';
        } else if (revision) {
          const previous = workspaceRevisions.get(meta.id);
          if (previous && previous !== revision) {
            entry.state = 'changed';
          } else if (previous) {
            entry.state = 'active';
          } else {
            const json = JSON.parse(
              workspaceFs.readFileSync(bodyPath, 'utf8').replace(/^\uFEFF/, ''),
            );
            if (
              json &&
              typeof json.name === 'string' &&
              json.scenes &&
              json.presets
            ) {
              entry.state = 'active';
              entry.revision = revision;
            }
          }
        } else if (!deleted) {
          entry.hasBackup = !!workspaceStat(bodyPath + '.bak')?.isFile();
        }
        entries.push(entry);
        const siblings = byId.get(meta.id) ?? [];
        siblings.push(entry);
        byId.set(meta.id, siblings);
      } catch (error) {
        entries.push({
          dir,
          state: 'unreadable',
        });
      }
    }
    const liveNameCounts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.name && entry.state !== 'deleted') {
        liveNameCounts.set(
          entry.name,
          (liveNameCounts.get(entry.name) ?? 0) + 1,
        );
      }
    }
    const conflicts = new Set<string>();
    for (const entry of entries) {
      if (!entry.id) continue;
      const previousId = workspacePathIds.get(entry.dir.toLowerCase());
      if (
        entry.state !== 'deleted' &&
        ((byId.get(entry.id)?.length ?? 0) > 1 ||
          (liveNameCounts.get(entry.name ?? '') ?? 0) > 1 ||
          (previousId && previousId !== entry.id))
      ) {
        entry.state = 'conflict';
      }
      if (entry.state === 'conflict' || entry.state === 'changed')
        conflicts.add(entry.dir.toLowerCase());
      if (!previousId && entry.state !== 'unreadable')
        workspacePathIds.set(entry.dir.toLowerCase(), entry.id);
      if (entry.state === 'active') {
        workspaceInitialized.add(entry.id);
        if (entry.revision) workspaceRevisions.set(entry.id, entry.revision);
      }
      if (entry.state === 'deleted') workspaceInitialized.add(entry.id);
      delete entry.revision;
    }
    workspaceConflicts = conflicts;
    workspaceDirSignature = JSON.stringify(dirs);
    workspaceLastScan = Date.now();
    workspaceEntries = entries;
    return {
      dirs,
      entries,
    };
  }
  function notifyWorkspaceChanged() {
    clearTimeout(workspaceTimer);
    workspaceTimer = setTimeout(() => notifyChanged(), 220);
  }
  function startWorkspaceWatcher() {
    if (workspaceWatcher) return;
    const root = path.join(getDataRoot(), 'workspace');
    const watcher = chokidar.watch(root, {
      depth: 1,
      ignoreInitial: true,
      followSymlinks: false,
      ignored: (filename: string, stats?: import('fs').Stats) => {
        const relative = path.relative(root, filename);
        if (!relative) return false;
        const parts = relative.split(path.sep);
        if (parts.some((part) => part.startsWith('.'))) return true;
        if (parts.length === 1) return !!stats && !stats.isDirectory();
        return (
          parts.length !== 2 ||
          !['meta.json', 'project.json', 'project.json.deleted'].includes(
            parts[1],
          )
        );
      },
    });
    workspaceWatcher = watcher;
    watcher.on('all', (event, filename) => {
      if (event === 'change' && path.basename(filename) === 'project.json') {
        try {
          const location = workspaceLocation(
            path.relative(getDataRoot(), filename),
          );
          const id =
            location && workspacePathIds.get(location.dir.toLowerCase());
          if (
            id &&
            workspaceRevisions.get(id) ===
              workspaceRevision(workspaceStat(filename))
          )
            return;
        } catch {}
      }
      notifyWorkspaceChanged();
    });
    watcher.on('ready', notifyWorkspaceChanged);
    watcher.on('error', (error) => {
      console.warn('workspace 감시 오류:', error.message);
      notifyWorkspaceChanged();
    });
  }
  function snapshot() {
    const snapshot = collectWorkspace();
    startWorkspaceWatcher();
    return snapshot;
  }
  function createProjectDirectory(
    relativePath: string,
    data: string,
    migrating = false,
  ) {
    const location = workspaceLocation(relativePath);
    const meta = JSON.parse(data);
    if (
      !location ||
      location.tail.length !== 1 ||
      location.tail[0] !== 'meta.json' ||
      typeof meta.id !== 'string' ||
      !meta.id ||
      typeof meta.name !== 'string' ||
      !meta.name.trim()
    ) {
      throw workspaceError('프로젝트 폴더를 생성할 수 없습니다.');
    }
    if (migrating && workspaceStat(location.root)?.isDirectory()) {
      const existing = readWorkspaceMeta(location.root);
      if (existing && existing.id !== meta.id)
        throw workspaceError('기존 프로젝트 ID가 다릅니다.');
      writeWorkspaceFile(location, data, 'utf8', {
        allowMetaRepair: true,
        allowInactive: true,
      });
      return;
    }
    const workspace = path.dirname(location.root);
    if (migrating && !workspaceStat(workspace))
      workspaceFs.mkdirSync(workspace);
    const snapshot = collectWorkspace();
    if (
      !migrating &&
      snapshot.entries.some(
        (entry) =>
          entry.dir !== location.dir &&
          entry.state !== 'deleted' &&
          (entry.name === meta.name || entry.id === meta.id),
      )
    ) {
      throw workspaceError('같은 이름 또는 ID의 프로젝트가 이미 있습니다.');
    }
    workspaceFs.mkdirSync(location.root);
    try {
      writeWorkspaceFile(location, data, 'utf8', {
        allowMetaRepair: true,
        allowInactive: true,
      });
    } catch (error) {
      try {
        workspaceFs.rmdirSync(location.root);
      } catch {}
      throw error;
    }
  }
  function resolveTaskOutput(relativePath: string) {
    const location = workspaceLocation(relativePath);
    if (!location) return relativePath;
    collectWorkspace();
    const previousId = workspacePathIds.get(location.dir.toLowerCase());
    const matches = workspaceEntries.filter((entry) => entry.id === previousId);
    if (matches.length !== 1 || matches[0].state !== 'active') {
      throw workspaceError(
        '생성 대상 프로젝트 폴더를 확인할 수 없어 요청을 보내지 않았습니다.',
      );
    }
    const result = ['workspace', matches[0].dir, ...location.tail].join('/');
    verifyWorkspaceTarget(workspaceLocation(result)!);
    return result;
  }
  function verifyWorkspaceTarget(
    location: WorkspaceLocation,
    options: WorkspaceAccessOptions = {},
  ) {
    const root = workspaceStat(location.root);
    const message =
      '프로젝트 폴더 또는 ID가 바뀌었습니다. 목록을 새로 읽은 뒤 다시 시도해 주세요.';
    if (!root?.isDirectory() || root.isSymbolicLink())
      throw workspaceError(message);
    const meta = readWorkspaceMeta(location.root);
    if (!meta) {
      if (
        options.allowMetaRepair &&
        location.tail.length === 1 &&
        location.tail[0] === 'meta.json' &&
        (!workspacePathIds.has(location.dir.toLowerCase()) ||
          workspaceStat(path.join(location.root, 'project.json'))?.isFile() ||
          workspaceStat(
            path.join(location.root, 'project.json.deleted'),
          )?.isFile())
      )
        return;
      throw workspaceError(message);
    }
    const workspace = path.dirname(location.root);
    const signature = JSON.stringify(listWorkspaceDirectories(workspace));
    if (
      signature !== workspaceDirSignature ||
      Date.now() - workspaceLastScan > 500
    )
      collectWorkspace();
    const key = location.dir.toLowerCase();
    const previousId = workspacePathIds.get(key);
    if ((previousId && previousId !== meta.id) || workspaceConflicts.has(key))
      throw workspaceError(message);
    workspacePathIds.set(key, meta.id);
    const bodyPath = path.join(location.root, 'project.json');
    const previousRevision = workspaceRevisions.get(meta.id);
    const revision = workspaceRevision(workspaceStat(bodyPath));
    if (revision && previousRevision && revision !== previousRevision) {
      throw workspaceError(
        '디스크의 project.json이 바뀌어 쓰기를 보류했습니다.',
      );
    }
    if (
      !options.allowInactive &&
      !revision &&
      (workspaceInitialized.has(meta.id) ||
        workspaceStat(bodyPath + '.deleted'))
    ) {
      throw workspaceError(message);
    }
    return meta.id;
  }
  function workspaceParents(
    location: WorkspaceLocation,
    options?: WorkspaceAccessOptions,
  ) {
    verifyWorkspaceTarget(location, options);
    let parent = location.root;
    for (const part of location.tail.slice(0, -1)) {
      parent = path.join(parent, part);
      const stat = workspaceStat(parent);
      if (!stat) workspaceFs.mkdirSync(parent);
      else if (!stat.isDirectory() || stat.isSymbolicLink())
        throw workspaceError('프로젝트 하위 경로를 확인해 주세요.');
    }
  }
  function commitWorkspaceFile(
    location: WorkspaceLocation,
    temporary: string,
    options: WorkspaceAccessOptions = {},
  ) {
    workspaceParents(location, options);
    const projectId = verifyWorkspaceTarget(location, options);
    workspaceFs.renameSync(temporary, location.resolved);
    if (location.tail.length === 1) {
      const filename = location.tail[0];
      if (filename === 'project.json' && projectId) {
        workspaceInitialized.add(projectId);
        workspaceRevisions.set(
          projectId,
          workspaceRevision(workspaceFs.statSync(location.resolved)),
        );
      } else if (filename === 'meta.json') {
        const meta = readWorkspaceMeta(location.root);
        if (meta) workspacePathIds.set(location.dir.toLowerCase(), meta.id);
      }
    }
  }
  function writeWorkspaceFile(
    location: WorkspaceLocation,
    data: string,
    encoding: BufferEncoding,
    options: WorkspaceAccessOptions = {},
  ) {
    const id = verifyWorkspaceTarget(location, options);
    if (!id && options.allowMetaRepair) {
      const previousId = workspacePathIds.get(location.dir.toLowerCase());
      if (previousId && JSON.parse(data.toString()).id !== previousId) {
        throw workspaceError(
          '기존 프로젝트의 메타데이터 ID를 확인할 수 없습니다.',
        );
      }
    }
    const temporary = path.join(getDataRoot(), randomUUID());
    try {
      workspaceFs.writeFileSync(temporary, data, encoding);
      commitWorkspaceFile(location, temporary, options);
    } finally {
      workspaceFs.rmSync(temporary, {
        force: true,
      });
    }
  }
  async function publishOutput(
    location: WorkspaceLocation,
    writeOutput: (target: string) => Promise<unknown>,
    verifyBefore = true,
  ) {
    if (verifyBefore) verifyWorkspaceTarget(location);
    const temporary = path.join(
      getDataRoot(),
      randomUUID() + path.extname(location.resolved),
    );
    try {
      await writeOutput(temporary);
      commitWorkspaceFile(location, temporary);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('WORKSPACE_CHANGED:') &&
        ['outs', 'inpaints'].includes(location.tail[0]) &&
        workspaceStat(temporary)
      ) {
        const recovery = path.join(getDataRoot(), 'workspace_recovery');
        await workspaceFs.promises.mkdir(recovery, { recursive: true });
        const filename = randomUUID() + '-' + path.basename(location.resolved);
        await workspaceFs.promises.rename(
          temporary,
          path.join(recovery, filename),
        );
        throw workspaceError(
          `프로젝트에 저장하지 못한 이미지를 workspace_recovery/${filename}에 보관했습니다.`,
        );
      }
      throw error;
    } finally {
      await workspaceFs.promises.rm(temporary, { force: true }).catch(() => {});
    }
  }

  async function outputToWorkspace(
    relativePath: string,
    writeOutput: (target: string) => Promise<unknown>,
  ) {
    const location = workspaceLocation(relativePath);
    if (!location)
      return writeOutput(path.resolve(getDataRoot(), relativePath));
    return publishOutput(location, writeOutput);
  }

  async function saveWorkspaceData(
    location: WorkspaceLocation,
    data: Uint8Array,
  ) {
    return publishOutput(
      location,
      (target) => workspaceFs.promises.writeFile(target, data),
      false,
    );
  }

  function renameWorkspaceFile(oldPath: string, newPath: string): boolean {
    const source = workspaceLocation(oldPath);
    const destination = workspaceLocation(newPath);
    if (source) verifyWorkspaceTarget(source, { allowInactive: true });
    if (!destination) return false;
    const restoring =
      source?.root === destination.root &&
      source?.tail.join('/') === 'project.json.deleted';
    if (restoring) {
      const id = verifyWorkspaceTarget(destination, { allowInactive: true });
      if (workspaceStat(destination.resolved))
        throw workspaceError('이미 활성 프로젝트가 있습니다.');
      workspaceFs.renameSync(
        path.resolve(getDataRoot(), oldPath),
        destination.resolved,
      );
      if (id)
        workspaceRevisions.set(
          id,
          workspaceRevision(workspaceFs.statSync(destination.resolved)),
        );
    } else {
      commitWorkspaceFile(destination, path.resolve(getDataRoot(), oldPath), {
        allowInactive: true,
      });
    }
    return true;
  }

  async function renameWorkspaceDirectory(
    oldPath: string,
    newPath: string,
  ): Promise<boolean> {
    const source = workspaceLocation(oldPath);
    const destination = workspaceLocation(newPath);
    if (source) verifyWorkspaceTarget(source, { allowInactive: true });
    if (!destination) return false;
    workspaceParents(destination, { allowInactive: true });
    for (let attempt = 0; ; attempt += 1) {
      if (source) verifyWorkspaceTarget(source, { allowInactive: true });
      verifyWorkspaceTarget(destination, { allowInactive: true });
      try {
        await workspaceFs.promises.rename(
          path.resolve(getDataRoot(), oldPath),
          destination.resolved,
        );
        return true;
      } catch (error) {
        if (
          attempt >= 7 ||
          !['EPERM', 'EACCES', 'EBUSY'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          )
        )
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
  }

  return {
    workspaceLocation,
    verifyWorkspaceTarget,
    workspaceParents,
    writeWorkspaceFile,
    commitWorkspaceFile,
    snapshot,
    createProjectDirectory,
    resolveTaskOutput,
    saveWorkspaceData,
    outputToWorkspace,
    renameWorkspaceFile,
    renameWorkspaceDirectory,
    close: async () => {
      clearTimeout(workspaceTimer);
      await workspaceWatcher?.close();
    },
  };
}
