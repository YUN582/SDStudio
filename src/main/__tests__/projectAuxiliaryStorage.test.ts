/** @jest-environment node */
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateProjectAuxiliary, moveProjectDirectory, pruneProjectThumbnails, removeProjectCompanions } from '../projectAuxiliaryStorage';

let root: string;
const disk = (key: string) => path.join(root, key);
const put = (key: string, data = key) => {
  fs.mkdirSync(path.dirname(disk(key)), { recursive: true });
  fs.writeFileSync(disk(key), data);
};
const read = (key: string) => fs.readFileSync(disk(key), 'utf8');
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-aux-')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

test('legacy and nested deleted images, masks, manifests and cached thumbnails retain their owners', () => {
  const live = 'outs/fastcache/variants/fastcache';
  put(live + '/actual.png', 'live');
  put(live + '/fastcache/400_actual.png', 'thumbnail');
  put(live + '/.trash/.trash_meta.json', 'dates');
  put(live + '/vibes/.unused/manifest.json', 'unused');
  put('outs/.trash/old/.trash/recover.png', 'recover');
  put('inpaint_masks/.trash/old.png', 'mask');
  put('work-assets-backup-v2/vibes/.unused/manifest.json', 'original backup');
  expect(migrateProjectAuxiliary(root)).toBe(6);
  expect(migrateProjectAuxiliary(root)).toBe(0);
  expect(read('fastcache/' + live + '/400_actual.png')).toBe('thumbnail');
  expect(read('.trash/images/.trash/scenes/outs/old/recover.png')).toBe('recover');
  expect(read('.trash/scenes/inpaint_masks/old.png')).toBe('mask');
  const slot = '.trash/scenes/inpaints/fastcache (2)';
  moveProjectDirectory(root, live, slot);
  expect(read('.unused/' + slot + '/vibes/manifest.json')).toBe('unused');
  expect(read('.trash/images/' + slot + '/.trash_meta.json')).toBe('dates');
  moveProjectDirectory(root, slot, live);
  expect(read(live + '/actual.png')).toBe('live');
  expect(read('.trash/images/' + live + '/.trash_meta.json')).toBe('dates');
  expect(read('work-assets-backup-v2/vibes/.unused/manifest.json')).toBe('original backup');
  removeProjectCompanions(root, live);
  expect(fs.existsSync(disk('.unused/' + live))).toBe(false);
  expect(read('.trash/images/.trash/scenes/outs/old/recover.png')).toBe('recover');
});

test('migration leaves both copies and other pending moves untouched on collision', () => {
  put('outs/a/.trash/1.png', 'old'); put('.trash/images/outs/a/1.png', 'different');
  put('vibes/.unused/manifest.json', 'history');
  expect(() => migrateProjectAuxiliary(root)).toThrow();
  expect(read('outs/a/.trash/1.png')).toBe('old');
  expect(read('.trash/images/outs/a/1.png')).toBe('different');
  expect(read('vibes/.unused/manifest.json')).toBe('history');
});

test('only recognized thumbnails with missing or changed originals are removed', async () => {
  put('outs/a/keep.png'); put('fastcache/outs/a/400_keep.png');
  put('fastcache/outs/a/400_deleted.png'); put('fastcache/outs/a/notes.txt');
  put('fastcache/outs/a/200_changed.webp'); put('outs/a/changed.webp');
  fs.utimesSync(disk('fastcache/outs/a/200_changed.webp'), new Date(0), new Date(0));
  await pruneProjectThumbnails(root);
  expect(fs.readdirSync(disk('fastcache/outs/a')).sort()).toEqual(['400_keep.png', 'notes.txt']);
});
