import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
let root: string;
const local = (p: string) => path.join(root, p);
const rename = jest.fn(async (from: string, to: string) => {
  await fs.mkdir(path.dirname(local(to)), { recursive: true });
  await fs.rename(local(from), local(to));
});
const backend = { existFile: (p: string) => fs.stat(local(p)).then(() => true, () => false), renameFile: rename, renameDir: rename };
const commit = jest.fn(async () => {});
const reorder = jest.fn(async () => {});
const record = jest.fn();
const relink = jest.fn();
const stats = jest.fn(() => ({ total: 0, done: 0 }));
let session: any, source: any, target: any;
const output = (_session: any, s: any) => s.type === 'scene' ? `outs/${s.name}` : `outs/${s.sceneRef}/variants/${s.name}`;
jest.mock('..', () => ({
  backend,
  imageHistoryService: { resolve: async (e: any) => ({ session, scene: session.getScene(e.sceneType, e.sceneName) }), relinkMovedImage: relink },
  imageService: { getOutputDir: output, getSceneGalleryEntries: (_session: any, s: any) => s.imageMap.map((filename: string) => ({ owner: s, filename, path: output(session, s) + '/' + filename })), refreshBatch: async () => {} },
  sessionService: { isMirror: () => false, guardCrossWindowLock: async () => true, withLock: async (_keys: any, run: any) => run(), commitSceneMerge: commit },
  taskQueueService: { statsTasksFromScene: stats },
}));
jest.mock('../galleryReorder', () => ({ moveCombinedGalleryImage: reorder }));
jest.mock('../undoService', () => ({ undoService: { canRecord: () => true, record } }));
import { dropHistoryImage } from '../historyImageDrop';

const scene = (name: string, imageMap: string[]) => ({ type: 'scene', name, imageMap, mains: [...imageMap], meta: new Map() });
const json = (s: any) => ({ ...s, meta: Object.fromEntries(s.meta) });
const entry = () => ({ id: 'outs/source/a.png', path: 'outs/source/a.png', sessionName: 'P', sceneType: 'scene' as const, sceneName: 'source', filename: 'a.png', createdAt: 1 });
async function write(p: string, content = p) { await fs.mkdir(path.dirname(local(p)), { recursive: true }); await fs.writeFile(local(p), content); }
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sdstudio-history-drop-'));
  jest.clearAllMocks();
  commit.mockResolvedValue(undefined);
  stats.mockReturnValue({ total: 0, done: 0 });
  source = scene('source', ['a.png', 'b.png']); target = scene('target', ['a.png']);
  session = { name: 'P', scenes: new Map([['source', source], ['target', target]]), inpaints: new Map(),
    getScene: (type: string, name: string) => (type === 'scene' ? session.scenes : session.inpaints).get(name),
    toJSON: () => ({ scenes: Object.fromEntries([...session.scenes].map(([k, s]: any) => [k, json(s)])), inpaints: Object.fromEntries([...session.inpaints].map(([k, s]: any) => [k, json(s)])) }),
  };
  await write('outs/source/a.png', 'original'); await write('outs/target/a.png', 'existing');
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

test('moves the real file without overwriting a collision and carries favorites; undo/redo use live paths', async () => {
  const dest = await dropHistoryImage(entry(), session, target);
  expect(dest).toBe('outs/target/a_moved1.png');
  expect(await fs.readFile(local(dest), 'utf8')).toBe('original');
  expect(await fs.readFile(local('outs/target/a.png'), 'utf8')).toBe('existing');
  expect(await backend.existFile('outs/source/a.png')).toBe(false);
  expect(source.imageMap).toEqual(['b.png']);
  expect(target.mains).toContain('a_moved1.png');
  await record.mock.calls[0][1].undo();
  expect(await backend.existFile('outs/source/a_moved1.png')).toBe(true);
  await record.mock.calls[0][1].redo();
  expect(await backend.existFile('outs/target/a_moved1.png')).toBe(true);
});

test('moves descendant work including masks and nested source links', async () => {
  const edit = { ...scene('paint', ['r.png']), type: 'inpaint', sceneRef: 'source', sourceImage: 'a.png', outputInSourceScene: true };
  const child = { ...scene('child', []), type: 'inpaint', sceneRef: 'source', sourceInpaint: 'paint', sourceImage: 'r.png', outputInSourceScene: true };
  session.inpaints.set('paint', edit); session.inpaints.set('child', child);
  await write('outs/source/variants/paint/vibes/mask.png');
  await write('outs/source/variants/child/vibes/input.png');
  await dropHistoryImage(entry(), session, target);
  expect(await backend.existFile('outs/target/variants/paint/vibes/mask.png')).toBe(true);
  expect(await backend.existFile('outs/target/variants/child/vibes/input.png')).toBe(true);
  expect(edit.sourceImage).toBe('a_moved1.png');
  expect(child.sceneRef).toBe('target');
  expect(child.sourceInpaint).toBe('paint');
});

test('rolls file moves back when project persistence fails', async () => {
  commit.mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(dropHistoryImage(entry(), session, target)).rejects.toThrow('disk unavailable');
  expect(await backend.existFile('outs/source/a.png')).toBe(true);
  expect(source.imageMap).toEqual(['a.png', 'b.png']);
  expect(target.imageMap).toEqual(['a.png']);
  expect(record).not.toHaveBeenCalled();
});

test('uses existing gallery reorder and refuses to move queued work', async () => {
  await dropHistoryImage(entry(), session, source, 'outs/source/b.png');
  expect(reorder).toHaveBeenCalledTimes(1);
  stats.mockReturnValue({ total: 1, done: 0 });
  await expect(dropHistoryImage(entry(), session, target)).rejects.toThrow('생성 예약');
  expect(rename).not.toHaveBeenCalled();
});
