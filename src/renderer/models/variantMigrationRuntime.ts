import { isMobile, sessionService, taskQueueService } from '.';
import { physicalDirOf } from './storageLayout';

/** Loaded or queued projects are deferred until startup; their in-memory state stays authoritative. */
export async function migrateUnusedVariantOutputs() {
  if (isMobile) return { migrated: 0, deferred: 0 };
  const names = new Set(sessionService.loadedNames());
  for (const task of taskQueueService.queue)
    if (task) names.add(task.params.session.name);
  const dirs = [...names]
    .map(physicalDirOf)
    .filter((dir): dir is string => !!dir);
  const result = await window.electron.ipcRenderer.invoke(
    'migrate-variant-outputs',
    dirs,
  );
  await sessionService.refreshList();
  return result as { migrated: number; deferred: number };
}
