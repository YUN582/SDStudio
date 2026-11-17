import type { GenericScene, Session } from '../types';
import { galleryImageKey, GALLERY_ORDER_KEY, orderGalleryEntries, sortGalleryEntries, SceneGalleryEntry } from '../sceneImageVariants';
import { sortSceneGallery, moveCombinedGalleryImage } from '../galleryReorder';
import { imageService, sessionService } from '..';
import { undoService } from '../undoService';

jest.mock('..', () => ({
  imageService: { getSceneGalleryEntries: jest.fn(), getGalleryImageKey: jest.fn() },
  gameService: {}, sessionService: { markDirty: jest.fn() },
}));
jest.mock('../imageStateUndo', () => ({ recordImageOrder: jest.fn() }));

const owner = (name: string, type = 'scene') => ({ name, type, mains: [], meta: new Map() } as unknown as GenericScene);
const entry = (owner: GenericScene, filename: string): SceneGalleryEntry => ({ owner, filename, path: `${owner.name}/${filename}` });

function fixture() {
  const root = owner('root'), variant = owner('paint', 'inpaint');
  const entries = [entry(root, '1700000000001.png'), entry(variant, '1700000000003.png'),
    entry(root, '1700000000004.png'), entry(variant, '1700000000001.png')];
  root.mains = ['1700000000001.png'];
  variant.mains = ['1700000000003.png'];
  const session = { name: 'fixture', getScene: () => root } as unknown as Session;
  const queues = [entries.filter(e => e.owner === root).reverse(), entries.filter(e => e.owner === variant)];
  const read = () => orderGalleryEntries(queues, root);
  (imageService.getSceneGalleryEntries as jest.Mock).mockImplementation(read);
  (imageService.getGalleryImageKey as jest.Mock).mockImplementation(galleryImageKey);
  undoService.configure({ curSession: () => session, isMirror: () => false, toast: () => {}, confirm: async () => true });
  return { root, variant, entries, session, queues, read };
}

beforeEach(() => jest.clearAllMocks());

test('favorites lead across original and variant owners; both groups are newest first', () => {
  const { entries } = fixture();
  const input = [...entries];
  expect(sortGalleryEntries(input)).toEqual([entries[1], entries[0], entries[2], entries[3]]);
  expect(input).toEqual(entries);
});

test('same timestamps and unknown dates stay stable; copied suffixes retain timestamps', () => {
  const root = owner('root'), variant = owner('paint', 'inpaint');
  const unknownA = entry(root, 'renamed.png'), unknownB = entry(variant, 'import.png');
  const a = entry(root, '1700000000002.png'), b = entry(variant, '1700000000002_copy.png');
  const newer = entry(root, '1700000000003.webp');
  expect(sortGalleryEntries([unknownA, b, unknownB, a, newer])).toEqual([newer, b, a, unknownA, unknownB]);
  expect(sortGalleryEntries([])).toEqual([]);
});

test('sorting persists combined keys, is undoable, and tolerates files added or removed afterward', async () => {
  const { root, entries, session, queues, read } = fixture();
  const original = read();
  expect(await sortSceneGallery(session, root)).toBe(true);
  expect(read()).toEqual([entries[1], entries[0], entries[2], entries[3]]);
  expect(root.meta.get(GALLERY_ORDER_KEY)).toEqual(read().map(e => galleryImageKey(e.owner, e.filename, root)));
  expect(sessionService.markDirty).toHaveBeenCalledWith('fixture');
  const fresh = entry(root, '1700000000005.png');
  queues[0].unshift(fresh);
  queues[1].splice(1, 1);
  await undoService.undo(session);
  expect(root.meta.has(GALLERY_ORDER_KEY)).toBe(false);
  expect(read()).toEqual([fresh, ...original.filter(e => e !== entries[3])]);
  await undoService.redo(session);
  expect(read()).toEqual([fresh, entries[1], entries[0], entries[2]]);
});

test('sort after a manual order restores that order on undo; repeated sort is a no-op', async () => {
  const { root, entries, session, read } = fixture();
  const previous = entries.map(e => galleryImageKey(e.owner, e.filename, root));
  root.meta.set(GALLERY_ORDER_KEY, previous);
  await sortSceneGallery(session, root);
  expect(await sortSceneGallery(session, root)).toBe(false);
  expect(undoService.entries(session).past).toHaveLength(1);
  await undoService.undo(session);
  expect(root.meta.get(GALLERY_ORDER_KEY)).toEqual(previous);
  expect(read()).toEqual(entries);
});

test('manual dragging after sorting stays possible and keeps matching original/variant names distinct', async () => {
  const { root, entries, session, read } = fixture();
  await sortSceneGallery(session, root);
  const current = read(), paths = current.map(e => e.path);
  await moveCombinedGalleryImage(session, root, paths, new Map(current.map(e => [e.path, e.owner])),
    entries[3].path, entries[1].path, paths, [entries[3].path]);
  expect(read()).toEqual([entries[3], entries[1], entries[0], entries[2]]);
  await undoService.undo(session);
  expect(read()).toEqual([entries[1], entries[0], entries[2], entries[3]]);
});
