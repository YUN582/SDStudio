import { backend, globalPresetService } from '.';
import type { IGlobalPresetEntry } from './GlobalPresetService';
import { getUniqueFilename, sanitizeFilename } from './ImageDownloadService';

/** Export sequentially so duplicate/sanitized names are numbered after each successful write. */
export async function exportGlobalPresetPngs(
  entries: readonly Pick<IGlobalPresetEntry, 'id' | 'name'>[],
  directory: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ saved: number; failed: string[] }> {
  let saved = 0;
  const failed: string[] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    try {
      const name = sanitizeFilename(entry.name.replace(/[\u0000-\u001f]/g, '_'))
        .replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i, '_$1');
      const filename = await getUniqueFilename(directory, name, 'png', true);
      const png = await globalPresetService.buildExportPng(entry.id);
      await backend.writeDataFileAbsolute(`${directory}/${filename}`, png);
      saved++;
    } catch {
      failed.push(entry.name);
    }
    onProgress?.(index + 1, entries.length);
  }
  return { saved, failed };
}
