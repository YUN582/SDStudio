/** @jest-environment node */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { migrateVariantOutputs } from '../variantOutputMigration';

let root: string;
let project: string;

async function put(relative: string, contents: string) {
  const file = path.join(project, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
}

const record = (name: string, workflowType = 'SDI2I', imageMap = ['out.webp']) => ({
  type: 'inpaint', name, workflowType, imageMap, sceneRef: 'source',
});

async function prepare(inpaints: Record<string, ReturnType<typeof record>>) {
  await put('meta.json', JSON.stringify({ id: 'p1', name: 'Project' }));
  await put('project.json', JSON.stringify({ id: 'p1', name: 'Project', scenes: { source: { name: 'source' } }, inpaints }));
}

const read = (file: string) => fs.readFile(path.join(project, file), 'utf8');
const manifest = async () => JSON.parse(await read('project.json')).inpaints;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'variant-output-test-'));
  project = path.join(root, 'workspace', 'project__p1');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('fresh data root is a no-op', async () => {
  expect(await migrateVariantOutputs(root)).toEqual({ migrated: 0, deferred: 0 });
  expect(await fs.readdir(root)).toEqual([]);
});

test('moves verified linked results and their image trash, retaining an original backup', async () => {
  await prepare({
    repair: record('repair', 'SDInpaint'),
    touchup: record('touchup', 'Augment', []),
    mirror: record('mirror', 'SDMirror'),
  });
  const original = await read('project.json');
  await put('inpaints/repair/out.webp', 'image');
  await put('inpaints/repair/.trash/deleted.png', 'deleted image');
  await put('inpaints/repair/.trash/.trash_meta.json', '{}');
  await put('inpaints/mirror/out.webp', 'mirror image');

  expect(await migrateVariantOutputs(root)).toEqual({ migrated: 2, deferred: 0 });
  const jobs = await manifest();
  expect(jobs.repair.outputInSourceScene).toBe(true);
  expect(jobs.touchup.outputInSourceScene).toBe(true);
  expect(jobs.mirror.outputInSourceScene).toBeUndefined();
  expect(await read('outs/source/variants/repair/out.webp')).toBe('image');
  expect(await read('outs/source/variants/repair/.trash/deleted.png')).toBe('deleted image');
  expect(await read('variant-output-backup-v1/project.json')).toBe(original);
  expect(await read('variant-output-backup-v1/inpaints/repair/out.webp')).toBe('image');
  await expect(read('inpaints/repair/out.webp')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await migrateVariantOutputs(root)).toEqual({ migrated: 0, deferred: 0 });
});

test('keeps the old folder on commit failure, then resumes from the verified copy', async () => {
  await prepare({ retry: record('retry') });
  await put('inpaints/retry/out.webp', 'same bytes');
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const result = await migrateVariantOutputs(root, async () => { throw new Error('Write failed'); });
    expect(result).toEqual({ migrated: 0, deferred: 1 });
    expect((await manifest()).retry.outputInSourceScene).toBeUndefined();
    expect(await read('inpaints/retry/out.webp')).toBe('same bytes');
    expect(await migrateVariantOutputs(root)).toEqual({ migrated: 1, deferred: 0 });
  } finally {
    warn.mockRestore();
  }
});

test('retains legacy paths when a folder conflicts or recorded outputs are missing', async () => {
  await prepare({ conflict: record('conflict'), absent: record('absent'), partial: record('partial') });
  await put('inpaints/conflict/out.webp', 'old content');
  await put('inpaints/partial/other.webp', 'untracked output');
  await put('outs/source/variants/conflict/out.webp', 'different content');
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await migrateVariantOutputs(root)).toEqual({ migrated: 0, deferred: 3 });
    expect((await manifest()).conflict.outputInSourceScene).toBeUndefined();
    expect(await read('inpaints/conflict/out.webp')).toBe('old content');
    expect(await read('outs/source/variants/conflict/out.webp')).toBe('different content');
  } finally {
    warn.mockRestore();
  }
});
