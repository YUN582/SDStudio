const files = new Map<string, string>();
const backend = {
  writeDataFile: jest.fn(async (p: string, data: string) => {
    files.set(p, data);
  }),
  existFile: jest.fn(async (p: string) => files.has(p)),
  listFiles: jest.fn(async () => []),
};
const services: any = { backend, isMobile: false };
jest.mock('..', () => services);
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../appStateRef', () => ({ getAppState: () => ({}) }));
import { ImageService } from '../ImageService';
import { SessionService } from '../SessionService';
import {
  WORK_ASSET_META,
  collectAssetReferences,
  sceneAssetOwner,
  vibeAssetToken,
} from '../workAssets';
import { setWorkspaceLayoutActive, registerProjectDir } from '../storageLayout';
function work(name: string): any {
  return {
    type: 'inpaint',
    name,
    preset: { image: '', mask: '' },
    imageMap: [],
    meta: new Map(),
    toJSON() {
      return {
        type: this.type,
        name: this.name,
        preset: { ...this.preset },
        meta: Object.fromEntries(this.meta),
      };
    },
  };
}
function fixture() {
  const service = (services.imageService = new ImageService());
  service.fetchImage = jest.fn(async (p: string) =>
    files.has(p) ? 'data:image/png;base64,' + files.get(p) : null,
  );
  const session: any = {
    name: 'P',
    scenes: new Map(),
    inpaints: new Map(),
    toJSON() {
      return {
        inpaints: Object.fromEntries(
          [...this.inpaints].map(([n, w]: any) => [n, w.toJSON()]),
        ),
      };
    },
  };
  return { service, session };
}
beforeEach(() => {
  files.clear();
  jest.clearAllMocks();
  setWorkspaceLayoutActive(true);
  registerProjectDir('P', 'P__12345678');
});
afterEach(() => setWorkspaceLayoutActive(false));
test('owned files share a work directory and full/relative paths resolve without basename loss', async () => {
  const { service, session } = fixture();
  const scene = work('paint');
  session.inpaints.set(scene.name, scene);
  scene.sceneRef = 'alpha'; scene.outputInSourceScene = true;
  const image = await service.storeWorkImage(session, scene, 'input', 'BASE');
  const mask = await service.storeWorkImage(session, scene, 'mask', 'MASK');
  expect(sceneAssetOwner(image)).toBe(sceneAssetOwner(mask));
  expect(sceneAssetOwner(image)).toBe(scene.meta.get(WORK_ASSET_META));
  const full = service.getVibeImagePath(session, image);
  expect(full).toBe('workspace/P__12345678/outs/alpha/variants/paint/vibes/' + image);
  expect(vibeAssetToken(full)).toBe(image);
  expect(await service.fetchVibeImage(session, full)).toBe(
    'data:image/png;base64,BASE',
  );
  expect(vibeAssetToken('vibes/' + image)).toBe(image);
});
test('copied work gets independent images, masks, drawing layers and metadata references', async () => {
  const { service, session } = fixture();
  const source = work('source');
  session.inpaints.set(source.name, source);
  source.preset.image = await service.storeWorkImage(
    session,
    source,
    'input',
    'BASE',
  );
  source.preset.mask = await service.storeWorkImage(
    session,
    source,
    'mask',
    'MASK',
  );
  const layer = await service.storeWorkImage(
    session,
    source,
    'drawing',
    'DRAW',
  );
  source.meta.set('codex.inpaintDrawing.v1', {
    source: source.preset.image,
    layer,
  });
  const copy = work('copy');
  copy.preset = { ...source.preset };
  copy.meta = new Map(source.meta); // Real scene serializers can retain nested metadata references.
  await service.cloneWorkAssets(session, copy);
  session.inpaints.set(copy.name, copy);
  expect(copy.meta.get(WORK_ASSET_META)).not.toBe(
    source.meta.get(WORK_ASSET_META),
  );
  expect(copy.preset.image).not.toBe(source.preset.image);
  expect(source.meta.get('codex.inpaintDrawing.v1').layer).toBe(layer);
  expect(copy.meta.get('codex.inpaintDrawing.v1').source).toBe(
    copy.preset.image,
  );
  await service.writeVibeImage(session, copy.preset.mask, 'ERASED');
  expect(await service.fetchVibeImage(session, source.preset.mask)).toBe(
    'data:image/png;base64,MASK',
  );
  expect(await service.fetchVibeImage(session, copy.preset.mask)).toBe(
    'data:image/png;base64,ERASED',
  );
});
test('project archives include nested input, mask and drawing files at their relative paths', async () => {
  const { service, session } = fixture();
  const scene = work('paint');
  session.inpaints.set(scene.name, scene);
  scene.preset.image = await service.storeWorkImage(
    session,
    scene,
    'input',
    'BASE',
  );
  scene.preset.mask = await service.storeWorkImage(
    session,
    scene,
    'mask',
    'MASK',
  );
  const layer = await service.storeWorkImage(session, scene, 'drawing', 'DRAW');
  scene.meta.set('codex.inpaintDrawing.v1', {
    source: scene.preset.image,
    layer,
  });
  const archive = await new SessionService().buildSessionDeepEntries(session);
  for (const token of collectAssetReferences(session.toJSON())) {
    expect(archive).toContainEqual({
      name: 'inpaints/paint/vibes/' + token,
      path: service.getVibeImagePath(session, token),
    });
  }
});
test('copying to a different project saves the input in the destination work', async () => {
  const { service, session } = fixture();
  const source = work('original');
  source.sceneRef = 'alpha';
  source.outputInSourceScene = true;
  session.inpaints.set(source.name, source);
  source.preset.image = await service.storeWorkImage(session, source, 'input', 'PIXELS');
  registerProjectDir('Target', 'Target__abc12345');
  const target = { ...session, name: 'Target', inpaints: new Map() };
  const copy = work('copy');
  copy.preset = { ...source.preset };
  copy.meta = new Map(source.meta);
  await service.cloneWorkAssets(target, copy, session);
  target.inpaints.set(copy.name, copy);
  const path = service.getVibeImagePath(target, copy.preset.image);
  expect(path).toBe('workspace/Target__abc12345/inpaints/copy/vibes/' + copy.preset.image);
  expect(files.get(path)).toBe('PIXELS');
  expect(await service.fetchVibeImage(session, source.preset.image)).toBe('data:image/png;base64,PIXELS');
});
test('traversal and malformed managed paths cannot escape the asset directory', () => {
  for (const value of [
    '../x.png',
    'works/../x.png',
    'works/fake/input.png',
    'workspace/P/vibes/../project.json',
  ])
    expect(() => vibeAssetToken(value)).toThrow();
  expect(vibeAssetToken('workspace/old/vibes/legacy.png')).toBe('legacy.png');
});
