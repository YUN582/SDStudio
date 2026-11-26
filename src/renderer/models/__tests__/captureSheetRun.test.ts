import { captureSceneData } from '../captureSheetRun';
import { galleryPreviewEntry } from '../sceneImageVariants';
const mockEntries: any[] = [];
const mockGallery = jest.fn((..._args: any[]) => mockEntries);
jest.mock('..', () => ({ imageService: { getSceneGalleryEntries: (...args: any[]) => mockGallery(...args) }, backend: {}, imageDownloadService: {} }));
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../platform', () => ({ platform: { isMobile: false } }));
jest.mock('../captureSheetRender', () => ({}));

const session: any = { mirrorImage: 'mirror-input-token.png' };
const scene: any = { type: 'scene', name: 'alpha', mains: ['original.png'] };
const work: any = { type: 'inpaint', name: 'paint', mains: ['edited.png'], preset: { image: 'owned-input-token.png' } };
beforeEach(() => { mockEntries.length = 0; mockGallery.mockClear(); });

test('scene capture collects original and nested work paths through the combined gallery', () => {
  const nested = { type: 'inpaint', name: 'paint-again', mains: [] };
  mockEntries.push(
    { owner: scene, filename: 'original.png', path: 'workspace/alpha/outs/original.png' },
    { owner: work, filename: 'edited.png', path: 'workspace/alpha/outs/variants/paint/edited.png' },
    { owner: nested, filename: 'edited.png', path: 'workspace/alpha/outs/variants/paint-again/edited.png' },
  );
  const data = captureSceneData(session, scene);
  expect(data.outputs).toEqual(mockEntries.map(entry => entry.path));
  expect(data.outputs).toHaveLength(3);
  expect(mockGallery).toHaveBeenCalledWith(session, scene);
});

test('variant-only favorites determine both the favorite list and the scene-card preview', () => {
  const root = { ...scene, mains: [] };
  mockEntries.push(
    { owner: root, filename: 'original.png', path: 'outs/alpha/original.png' },
    { owner: work, filename: 'edited.png', path: 'outs/alpha/variants/paint/edited.png' },
  );
  const data = captureSceneData(session, root);
  expect(data.favorites).toEqual(['outs/alpha/variants/paint/edited.png']);
  expect(data.main).toEqual({ kind: 'output', path: galleryPreviewEntry(mockEntries)!.path });
});

test('manual gallery order is retained for outputs and favorites', () => {
  const root = { ...scene, mains: ['first.png', 'last.png'] };
  mockEntries.push(
    { owner: root, filename: 'last.png', path: 'outs/alpha/last.png' },
    { owner: work, filename: 'edited.png', path: 'outs/alpha/variants/paint/edited.png' },
    { owner: root, filename: 'first.png', path: 'outs/alpha/first.png' },
  );
  const data = captureSceneData(session, root);
  expect(data.outputs).toEqual(['outs/alpha/last.png', 'outs/alpha/variants/paint/edited.png', 'outs/alpha/first.png']);
  expect(data.favorites).toEqual(data.outputs);
  expect(data.main?.path).toBe('outs/alpha/last.png');
});

test('work cards retain the opaque owned input token instead of constructing a flat vibes path', () => {
  const data = captureSceneData(session, work);
  expect(data.main).toEqual({ kind: 'input', path: 'owned-input-token.png' });
  expect(data.outputs).toEqual([]);
  expect(data.favorites).toEqual([]);
});

test('mirror without a per-work input falls back to the project mirror token', () => {
  expect(captureSceneData(session, { ...work, workflowType: 'SDMirror', preset: {} }).main)
    .toEqual({ kind: 'input', path: 'mirror-input-token.png' });
});
