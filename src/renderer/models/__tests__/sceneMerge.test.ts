import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

let store: string;
const local = (key: string) => path.join(store, key);
const makeParent = async (key: string) => fs.mkdir(path.dirname(local(key)), { recursive: true });
const backend = {
  existFile: async (key: string) => fs.stat(local(key)).then(() => true, () => false),
  listFiles: async (key: string) => fs.readdir(local(key)).catch((e) => {
    if (e.code === 'ENOENT') return [];
    throw e;
  }),
  listFilesWithStats: async (key: string) => {
    const entries = await backend.listFiles(key);
    const stats = await Promise.all(entries.map(async (name) => ({ name, stat: await fs.stat(local(key + '/' + name)) })));
    return stats.filter(({ stat }) => stat.isFile()).map(({ name, stat }) => ({ name, size: stat.size }));
  },
  copyFile: jest.fn(async (from: string, to: string) => { await makeParent(to); await fs.copyFile(local(from), local(to)); }),
  renameDir: jest.fn(async (from: string, to: string) => { await makeParent(to); await fs.rename(local(from), local(to)); }),
  writeFile: async (key: string, content: string) => { await makeParent(key); await fs.writeFile(local(key), content); },
  deleteFile: async (key: string) => fs.unlink(local(key)),
  deleteDir: async (key: string) => fs.rm(local(key), { recursive: true }),
};
const committed = jest.fn(async (_session: any, _json: any) => {});
const rollbackTrash = jest.fn(async () => {});
const relinkTrash = jest.fn(async () => rollbackTrash);
const relinkHistory = jest.fn();
const refresh = jest.fn(async () => {});
const stats = jest.fn((_session: any, _scene: any) => ({ total: 0, done: 0 }));
jest.mock('..', () => ({
  backend,
  imageService: { refreshBatch: refresh },
  imageHistoryService: { relinkMergedScenes: relinkHistory },
  sessionService: {
    isMirror: () => false,
    guardCrossWindowLock: () => true,
    withLock: async (_names: string[], body: () => Promise<void>) => body(),
    commitSceneMerge: committed,
    relinkMergedSceneBookmarks: async () => {},
  },
  taskQueueService: { statsTasksFromScene: stats },
  trashService: { relinkMergedVariantSources: relinkTrash },
}));
jest.mock('../workflows/WorkFlow', () => ({}));

import { mergeSelectedScenes } from '../sceneMerge';
import { mergeSceneCombinations } from '../sceneMergeCombinations';
import { PromptPiece, Scene, Session } from '../types';

const piece = (prompt: string, character = '', enabled?: boolean) => PromptPiece.fromJSON({
  prompt, id: prompt, characterPrompts: [character], enabled,
});

test('combining multi-column scenes retains the sum of original products and indexed character prompts', () => {
  const a = new Scene();
  a.name = 'a';
  a.slots = [[piece('##comment## alpha', 'hero'), piece('disabled', '', false)],
    [piece('one', 'coat'), piece('two', 'boots')]];
  const b = new Scene();
  b.name = 'b';
  b.slots = [[piece('beta', 'villain'), piece('gamma', 'cape'), piece('disabled2', '', false)]];
  const [candidates] = mergeSceneCombinations([a, b]);
  const active = candidates.filter((p) => p.enabled !== false);
  expect(active.map((p) => p.prompt)).toEqual(['alpha, one', 'alpha, two', 'beta', 'gamma']);
  expect(active.map((p) => p.characterPrompts[0])).toEqual(['hero, coat', 'hero, boots', 'villain', 'cape']);
  expect(candidates[4].enabled).toBe(false);
  const copy = mergeSceneCombinations([a, b], a);
  expect(copy.map((column) => column.map((p) => p.toJSON()))).toEqual(a.toJSON().slots);
  expect(copy[0][0]).not.toBe(a.slots[0][0]);
});

const project = 'project';
const out = 'outs/project';
async function fixture() {
  const session = new Session();
  session.name = project;
  const target = Scene.fromJSON({ type: 'scene', name: 'angry', resolution: 'portrait', slots: [[piece('first').toJSON()]], imageMap: ['a.png'], mains: ['a.png'], meta: {} });
  const source = Scene.fromJSON({ type: 'scene', name: 'angry_1', resolution: 'landscape', slots: [[piece('second').toJSON()]], imageMap: ['a.png', 'b.webp'], mains: ['a.png'], meta: {} });
  session.scenes.set(target.name, target);
  session.scenes.set(source.name, source);
  const variant = { name: 'repair', type: 'inpaint', outputInSourceScene: true, sceneRef: source.name, sourceImage: 'a.png',
    toJSON() { return { ...this, toJSON: undefined }; } };
  const legacy = { ...variant, name: 'legacy', outputInSourceScene: false, sourceImage: 'b.webp' };
  session.inpaints.set(variant.name, variant as any);
  session.inpaints.set(legacy.name, legacy as any);
  await backend.writeFile(out + '/angry/a.png', 'target png');
  await backend.writeFile(out + '/angry_1/a.png', 'source png');
  await backend.writeFile(out + '/angry_1/b.webp', 'source webp');
  await backend.writeFile(out + '/angry_1/variants/repair/edit.png', 'edited');
  await backend.writeFile(out + '/angry_1/variants/repair/.trash/old.png', 'trashed');
  await backend.writeFile('inpaints/project/legacy/result.png', 'legacy');
  return { session, target, source };
}

beforeEach(async () => {
  jest.clearAllMocks();
  store = await fs.mkdtemp(path.join(os.tmpdir(), 'sdstudio-scene-merge-'));
});
afterEach(async () => fs.rm(store, { recursive: true, force: true }));

test.each([false, true])('merges files, favorites, and both variant layouts (overwrite=%s)', async (overwrite) => {
  const { session, target, source } = await fixture();
  const result = await mergeSelectedScenes(session, [target, source], target, overwrite ? source : undefined);
  expect([...session.scenes.keys()]).toEqual(['angry']);
  expect(target.resolution).toBe('portrait');
  expect(target.slots[0].map((p) => p.prompt)).toEqual(overwrite ? ['second'] : ['first', 'second']);
  expect(target.mains).toEqual(['a.png', 'a_merged1.png']);
  expect(session.inpaints.get('repair')).toMatchObject({ sceneRef: 'angry', sourceImage: 'a_merged1.png' });
  expect(session.inpaints.get('legacy')).toMatchObject({ sceneRef: 'angry', sourceImage: 'b.webp', outputInSourceScene: false });
  expect(await fs.readFile(local(out + '/angry/a.png'), 'utf8')).toBe('target png');
  expect(await fs.readFile(local(out + '/angry/a_merged1.png'), 'utf8')).toBe('source png');
  expect(await fs.readFile(local(out + '/angry/variants/repair/.trash/old.png'), 'utf8')).toBe('trashed');
  expect(await backend.existFile(out + '/angry_1')).toBe(false);
  expect(await backend.existFile(result.backup + '/outs/angry_1/variants/repair/edit.png')).toBe(true);
  expect(result).toMatchObject({ movedCount: 2, variantCount: 2 });
  expect(committed.mock.calls[0][1].scenes.angry.mains).toEqual(['a.png', 'a_merged1.png']);
  expect(relinkHistory).toHaveBeenCalled();
});

test('project write failure restores sources, variant references, and only removes staged files', async () => {
  const { session, target, source } = await fixture();
  committed.mockRejectedValueOnce(new Error('write failed'));
  await expect(mergeSelectedScenes(session, [target, source], target)).rejects.toThrow('write failed');
  expect([...session.scenes.keys()]).toEqual(['angry', 'angry_1']);
  expect(target.mains).toEqual(['a.png']);
  expect(session.inpaints.get('repair')?.sceneRef).toBe('angry_1');
  expect(await backend.existFile(out + '/angry_1/variants/repair/edit.png')).toBe(true);
  expect(await backend.listFiles(out + '/angry')).toEqual(expect.arrayContaining(['a.png']));
  expect(await backend.existFile(out + '/angry/a_merged1.png')).toBe(false);
  expect(await backend.existFile(out + '/angry/variants/repair')).toBe(false);
  expect(rollbackTrash).toHaveBeenCalledTimes(1);
  expect(relinkHistory).not.toHaveBeenCalled();
});

test('failed image copy leaves the source and existing destination intact', async () => {
  const { session, target, source } = await fixture();
  backend.copyFile.mockRejectedValueOnce(new Error('copy failed'));
  await expect(mergeSelectedScenes(session, [target, source], target)).rejects.toThrow('copy failed');
  expect(session.scenes.has(source.name)).toBe(true);
  expect(await backend.existFile(out + '/angry_1/a.png')).toBe(true);
  expect(await fs.readFile(local(out + '/angry/a.png'), 'utf8')).toBe('target png');
  expect(committed).not.toHaveBeenCalled();
});
