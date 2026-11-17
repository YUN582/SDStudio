/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { maintainWorkAssets } from '../workAssetMaintenance';
import {
  collectAssetReferences,
  sceneAssetOwner,
} from '../../renderer/models/workAssets';
let root: string, projectRoot: string;
const dir = 'P__12345678';
const id = '12345678-1234-1234-1234-123456789abc';
const allowed = new Set([dir]);
const json = (file: string) => fs.readFile(file, 'utf8').then(JSON.parse);
const put = (file: string, value: unknown) =>
  fs.writeFile(file, JSON.stringify(value));
const projectFile = () => path.join(projectRoot, 'project.json');
const trashFile = () => path.join(root, 'trash.json');
const vibes = () => path.join(projectRoot, 'vibes');
const work = (name: string) => ({
  type: 'inpaint',
  name,
  preset: { image: 'input.png', mask: 'mask.png' },
  meta: {
    'codex.inpaintDrawing.v1': { source: 'input.png', layer: 'drawing.png' },
  },
});
const write = async (file: string, before: string, next: string) => {
  expect(await fs.readFile(file, 'utf8')).toBe(before);
  await fs.writeFile(file, next);
};
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdstudio-work-assets-'));
  projectRoot = path.join(root, 'workspace', dir);
  await fs.mkdir(path.join(projectRoot, 'vibes'), { recursive: true });
  await put(path.join(projectRoot, 'meta.json'), { id, name: 'P' });
  await put(projectFile(), {
    id,
    name: 'P',
    scenes: {},
    inpaints: { paint: work('paint') },
  });
  await put(trashFile(), { scenes: {}, projects: {} });
  for (const name of ['input', 'mask', 'drawing'])
    await fs.writeFile(path.join(vibes(), name + '.png'), name + '-pixels');
});
afterEach(async () => {
  // Exactly the unique directory allocated by mkdtemp above.
  await fs.rm(root, { recursive: true, force: true });
});
test('active and deleted work are grouped independently with masks, drawings and metadata intact', async () => {
  await put(trashFile(), {
    scenes: {
      'P:deleted': {
        projectId: id,
        projectDir: dir,
        sceneData: work('deleted'),
      },
    },
  });
  const result = await maintainWorkAssets(root, write, allowed);
  expect(result.deferred).toBe(0);
  expect(result.migrated).toBe(2);
  const active = (await json(projectFile())).inpaints.paint;
  const deleted = (await json(trashFile())).scenes['P:deleted'].sceneData;
  expect(active.preset.image).not.toBe(deleted.preset.image);
  for (const w of [active, deleted]) {
    const local = path.join(projectRoot, w.name === 'deleted' ? '.trash/scenes/inpaints/deleted/vibes' : 'inpaints/paint/vibes');
    const refs = [...collectAssetReferences(w)];
    expect(refs).toHaveLength(3);
    expect(refs.every(sceneAssetOwner)).toBe(true);
    expect(w.meta['codex.inpaintDrawing.v1'].source).toBe(w.preset.image);
    expect(await fs.readFile(path.join(local, w.preset.image), 'utf8')).toBe(
      'input-pixels',
    );
    expect(await fs.readFile(path.join(local, w.preset.mask), 'utf8')).toBe(
      'mask-pixels',
    );
    expect(
      await fs.readFile(
        path.join(local, w.meta['codex.inpaintDrawing.v1'].layer),
        'utf8',
      ),
    ).toBe('drawing-pixels');
  }
  expect(
    await fs.readFile(
      path.join(projectRoot, 'work-assets-backup-v2/vibes/input.png'),
      'utf8',
    ),
  ).toBe('input-pixels');
  expect((await maintainWorkAssets(root, write, allowed)).migrated).toBe(0);
});
test('shared references, deleted work and recovery JSON protect auxiliary files from cleanup', async () => {
  const p = await json(projectFile());
  p.inpaints = {};
  p.unknownFutureField = { file: 'input.png' };
  await put(projectFile(), p);
  await put(trashFile(), {
    scenes: {
      'P:deleted': {
        projectDir: dir,
        sceneData: { type: 'inpaint', preset: { mask: 'mask.png' } },
      },
    },
  });
  await put(projectFile() + '.bak', { oldDrawing: 'drawing.png' });
  expect(
    (await maintainWorkAssets(root, write, allowed, { migrate: false }))
      .quarantined,
  ).toBe(0);
  expect(await fs.readFile(path.join(vibes(), 'drawing.png'), 'utf8')).toBe(
    'drawing-pixels',
  );
});
test('unused files are retained for 14 days and automatically recovered if referenced again', async () => {
  await fs.writeFile(path.join(vibes(), 'unused.png'), 'recoverable');
  const first = await maintainWorkAssets(root, write, allowed, {
    migrate: false,
    now: 1000,
  });
  expect(first.quarantined).toBe(1);
  const manifestPath = path.join(projectRoot, '.unused/vibes/manifest.json');
  const firstManifest = await json(manifestPath);
  const stored = path.join(
    projectRoot,
    '.unused/vibes',
    firstManifest.entries['unused.png'].fileId + '.png',
  );
  expect(await fs.readFile(stored, 'utf8')).toBe('recoverable');
  const p = await json(projectFile());
  p.preset = { profile: 'unused.png' };
  await put(projectFile(), p);
  expect(
    (
      await maintainWorkAssets(root, write, allowed, {
        migrate: false,
        now: 2000,
      })
    ).recovered,
  ).toBe(1);
  expect(await fs.readFile(path.join(vibes(), 'unused.png'), 'utf8')).toBe(
    'recoverable',
  );
  delete p.preset;
  await put(projectFile(), p);
  await maintainWorkAssets(root, write, allowed, { migrate: false, now: 3000 });
  expect(
    (
      await maintainWorkAssets(root, write, allowed, {
        migrate: false,
        now: 3000 + 14 * 86400000,
      })
    ).removed,
  ).toBe(1);
  expect((await json(manifestPath)).entries).toEqual({});
});
test('missing inputs and conflicting project writes preserve originals and trash records', async () => {
  const before = await fs.readFile(projectFile(), 'utf8');
  const t = await fs.readFile(trashFile(), 'utf8');
  const result = await maintainWorkAssets(
    root,
    async () => {
      throw new Error('external edit');
    },
    allowed,
  );
  expect(result.deferred).toBe(1);
  expect(await fs.readFile(projectFile(), 'utf8')).toBe(before);
  expect(await fs.readFile(trashFile(), 'utf8')).toBe(t);
  expect(await fs.readFile(path.join(vibes(), 'input.png'), 'utf8')).toBe(
    'input-pixels',
  );
  await fs.unlink(path.join(vibes(), 'mask.png'));
  expect((await maintainWorkAssets(root, write, allowed)).deferred).toBe(1);
  expect(await fs.readFile(projectFile(), 'utf8')).toBe(before);
});
test('loaded or queued projects excluded by the caller remain byte-for-byte untouched', async () => {
  const before = await fs.readFile(projectFile(), 'utf8');
  expect(await maintainWorkAssets(root, write, new Set())).toMatchObject({
    migrated: 0,
    quarantined: 0,
    removed: 0,
  });
  expect(await fs.readFile(projectFile(), 'utf8')).toBe(before);
  expect((await fs.readdir(vibes())).sort()).toEqual([
    'drawing.png',
    'input.png',
    'mask.png',
  ]);
});
test('corrupt trash prevents any asset cleanup', async () => {
  await fs.writeFile(trashFile(), '{broken');
  await expect(maintainWorkAssets(root, write, allowed)).rejects.toThrow();
  expect((await fs.readdir(vibes())).sort()).toEqual([
    'drawing.png',
    'input.png',
    'mask.png',
  ]);
});
test('junctions never allow migration or deletion outside the project', async () => {
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'important.png'), 'keep');
  await fs.symlink(
    outside,
    path.join(vibes(), 'works'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  expect(
    (await maintainWorkAssets(root, write, allowed)).deferred,
  ).toBeGreaterThan(0);
  expect(await fs.readFile(path.join(outside, 'important.png'), 'utf8')).toBe(
    'keep',
  );
});

test('missing trash history defers cleanup instead of assuming no deleted work', async () => {
  await fs.unlink(trashFile());
  const before = await fs.readFile(projectFile(), 'utf8');
  expect(await maintainWorkAssets(root, write, allowed)).toMatchObject({
    migrated: 0,
    deferred: 1,
    quarantined: 0,
  });
  expect(await fs.readFile(projectFile(), 'utf8')).toBe(before);
  expect((await fs.readdir(vibes())).sort()).toEqual([
    'drawing.png',
    'input.png',
    'mask.png',
  ]);
});

test('moves previous works/ID files into the linked result folder and cleans unused revisions there', async () => {
  const old = 'works/' + id + '/input-prev.png';
  const p = await json(projectFile());
  p.inpaints.paint = {...p.inpaints.paint, sceneRef: 'alpha', outputInSourceScene: true,
    preset: {image:old}, meta:{'sdstudio.workAssets.v1':id}};
  await put(projectFile(), p);
  await fs.mkdir(path.dirname(path.join(vibes(), old)), {recursive:true});
  await fs.writeFile(path.join(vibes(), old),'previous version');
  const result = await maintainWorkAssets(root, write, allowed);
  expect(result).toMatchObject({migrated:1,deferred:0});
  const token = (await json(projectFile())).inpaints.paint.preset.image;
  const local = path.join(projectRoot,'outs/alpha/variants/paint/vibes');
  expect(await fs.readFile(path.join(local,token),'utf8')).toBe('previous version');
  expect(await fs.stat(path.join(vibes(),old)).catch(()=>null)).toBeNull();
  const before = await json(projectFile()); before.inpaints.paint.preset.image = '';
  await put(projectFile(), before);
  await maintainWorkAssets(root,write,allowed,{migrate:false,now:1000});
  expect((await json(path.join(projectRoot, '.unused', path.relative(projectRoot, local), 'manifest.json'))).entries[token]).toBeDefined();
  before.inpaints.paint.preset.image=token; await put(projectFile(),before);
  await maintainWorkAssets(root,write,allowed,{migrate:false,now:2000});
  expect(await fs.readFile(path.join(local,token),'utf8')).toBe('previous version');
});
