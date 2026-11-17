const backend = { listFiles: jest.fn(async (_path: string) => ['same.png']), renameDir: jest.fn() };
const services: any = { backend, isMobile: false, taskQueueService: { addLog: jest.fn() } };
jest.mock('..', () => services);
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../appStateRef', () => ({ getAppState: () => ({}) }));

import { ImageService } from '../ImageService';
import { GameService } from '../GameService';
import { SessionService } from '../SessionService';
import { galleryPreviewEntry, linkedImageVariants } from '../sceneImageVariants';
import { physicalDirOf, registerProjectDir, setWorkspaceLayoutActive } from '../storageLayout';

function fixture() {
  const image = services.imageService = new ImageService();
  const game = services.gameService = new GameService();
  const svc: any = new SessionService();
  const root: any = { type: 'scene', name: 'root', imageMap: ['same.png'], mains: [], meta: new Map() };
  const variant: any = { type: 'inpaint', name: 'paint', sceneRef: 'root', sourceImage: 'same.png', outputInSourceScene: true,
    imageMap: ['same.png'], mains: ['same.png'], meta: new Map() };
  const child: any = { ...variant, name: 'child', sourceInpaint: 'paint', mains: [] };
  const session: any = { name: 'before', scenes: new Map([['root', root]]), inpaints: new Map([['paint', variant], ['child', child]]),
    getScenes(type: string) { return [...(type === 'scene' ? this.scenes : this.inpaints).values()]; } };
  image.images.before = { root: ['same.png'] };
  image.inpaints.before = { paint: ['same.png'], child: ['same.png'] };
  image.dispatchEvent(new CustomEvent('updated', { detail: { batch: true, session } }));
  svc.entries.set('before', { state: 'ready', dirty: false, seq: 0, instance: session });
  svc.updateWorkspaceMeta = jest.fn(async () => {});
  svc.watch = jest.fn(() => jest.fn());
  svc.migrateRenameSidecars = jest.fn(async () => {});
  svc.update = jest.fn(async () => {});
  setWorkspaceLayoutActive(true);
  registerProjectDir('before', 'fixed__12345678');
  return { image, game, svc, root, variant, child, session };
}

beforeEach(() => { jest.clearAllMocks(); backend.listFiles.mockImplementation(async () => ['same.png']); });
afterEach(() => setWorkspaceLayoutActive(false));

test('workspace rename preserves loaded original/variant favorites, order, links and physical paths without rescanning', async () => {
  const { image, game, svc, session, root, variant, child } = fixture();
  root.meta.set(image.galleryOrderKey, [image.getGalleryImageKey(variant, 'same.png', root), image.getGalleryImageKey(child, 'same.png', root)]);
  const before = image.getSceneGalleryEntries(session, root);
  expect(before).toHaveLength(3);
  expect(galleryPreviewEntry(before)?.owner).toBe(variant);
  const changed = jest.fn(() => expect(image.getSceneGalleryEntries(session, root)).toEqual(before));
  game.addEventListener('updated', changed);
  await svc.renameProject('before', 'after');
  expect(session.name).toBe('after');
  expect(image.getSceneGalleryEntries(session, root)).toEqual(before);
  expect(galleryPreviewEntry(image.getSceneGalleryEntries(session, root))?.owner).toBe(variant);
  expect(linkedImageVariants(variant, session.inpaints.values(), 'same.png')).toEqual([child]);
  expect(physicalDirOf('after')).toBe('fixed__12345678');
  expect(image.images.before).toBeUndefined();
  expect(image.inpaints.before).toBeUndefined();
  expect(game.outputList.scene.before).toBeUndefined();
  expect(game.outputList.inpaint.before).toBeUndefined();
  expect(changed).toHaveBeenCalledTimes(1);
  expect(backend.listFiles).not.toHaveBeenCalled();
  expect(backend.renameDir).not.toHaveBeenCalled();
  await svc.renameProject('after', 'before');
  expect(image.getSceneGalleryEntries(session, root)).toEqual(before);
});

test('failed metadata write leaves the project and loaded galleries intact', async () => {
  const { image, svc, session, root } = fixture();
  const before = image.getSceneGalleryEntries(session, root);
  svc.updateWorkspaceMeta.mockRejectedValueOnce(new Error('write failed'));
  await expect(svc.renameProject('before', 'after')).rejects.toThrow('write failed');
  expect(session.name).toBe('before');
  expect(image.getSceneGalleryEntries(session, root)).toEqual(before);
  expect(svc.migrateRenameSidecars).not.toHaveBeenCalled();
});

test('an in-flight refresh follows the renamed project and releases its deduplication entry', async () => {
  const { image, svc, session, root } = fixture();
  let resolve!: (files: string[]) => void;
  const reading = new Promise<string[]>(done => { resolve = done; });
  backend.listFiles.mockImplementation(() => reading);
  const first = image.refreshBatch(session);
  await svc.renameProject('before', 'after');
  const second = image.refreshBatch(session);
  expect(backend.listFiles).toHaveBeenCalledTimes(3);
  resolve(['same.png']);
  await Promise.all([first, second]);
  expect(image.getSceneGalleryEntries(session, root)).toHaveLength(3);
  await image.refreshBatch(session);
  expect(backend.listFiles).toHaveBeenCalledTimes(6);
  expect(image.images.before).toBeUndefined();
  expect(image.inpaints.before).toBeUndefined();
});
