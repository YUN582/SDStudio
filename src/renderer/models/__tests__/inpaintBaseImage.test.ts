jest.mock('..', () => ({ workFlowService: {} }));
const mockDraw = jest.fn();
jest.mock('../inpaintInput', () => ({
  ...jest.requireActual('../inpaintInput'),
  paintImage: jest.fn(async (src: string) => {
    if (src === 'invalid') throw new Error('invalid image');
    return { naturalWidth: 128, naturalHeight: 64, src };
  }),
  paintCanvas: (width: number, height: number) => ({
    getContext: () => ({ drawImage: (...args: any[]) => mockDraw(...args) }),
    toDataURL: () => `data:image/png;base64,converted-${width}x${height}`,
  }),
}));
import { replaceInpaintBaseImage } from '../inpaintBaseImage';
import { DETACHED_INPUT_META, PAINT_META, fetchInpaintInput } from '../inpaintInput';
import { UndoService } from '../undoService';

function fixture() {
  const scene: any = { name: 'edit', type: 'inpaint', workflowType: 'SDInpaint', sceneRef: 'source', sourceImage: 'original.png',
    resolution: 'custom', resolutionWidth: 1024, resolutionHeight: 1024, imageMap: ['result.png'], mains: ['result.png'],
    preset: { image: 'old-input.png', mask: 'old-mask.png', prompt: 'kept prompt', seed: 123 },
    meta: new Map<string, any>([[PAINT_META, { source: 'old-input.png', layer: 'old-drawing.png', owner: 'edit' }], ['unrelated', 'kept']]) };
  const session: any = { name: 'project', inpaints: new Map([['edit', scene]]), getScene: (_type: string, name: string) => session.inpaints.get(name) };
  const service = new UndoService({ curSession: () => session, isMirror: () => false, toast: jest.fn(), confirm: async () => true });
  const access = {
    fetchVibeImage: jest.fn(async (_s: any, path: string) => path),
    storeWorkImage: jest.fn(async (_s: any, _scene: any, role: string, _data: string) => `new-${role}.png`),
  };
  return { scene, session, service, access };
}

beforeEach(() => mockDraw.mockClear());

test('stores independent input, mask and drawing; one undo restores the old source without touching results or settings', async () => {
  const { scene, session, service, access } = fixture(), before = jest.fn(async () => {});
  const result = await replaceInpaintBaseImage(session, scene, 'new-base', access, { service, before });
  expect(before).toHaveBeenCalledTimes(1);
  expect(access.storeWorkImage.mock.calls.map(call => call[2])).toEqual(['input', 'mask', 'drawing']);
  expect(mockDraw.mock.calls.every(call => call.slice(1).join(',') === '0,0,128,64')).toBe(true);
  expect(result).toEqual({ image: 'converted-128x64', mask: 'converted-128x64', width: 128, height: 64 });
  expect(scene.preset).toMatchObject({ image: 'new-input.png', mask: 'new-mask.png', prompt: 'kept prompt', seed: 123 });
  expect(scene.meta.get(PAINT_META)).toEqual({ source: 'new-input.png', layer: 'new-drawing.png', owner: 'edit' });
  expect(scene.meta.get(DETACHED_INPUT_META)).toBe(true);
  expect([scene.resolutionWidth, scene.resolutionHeight]).toEqual([1024, 1024]);
  expect(service.entries(session).past).toHaveLength(1);
  scene.imageMap.push('generated-later.png');
  await service.undo(session);
  expect(scene.preset.image).toBe('old-input.png'); expect(scene.preset.mask).toBe('old-mask.png');
  expect(scene.meta.has(DETACHED_INPUT_META)).toBe(false);
  expect(scene.meta.get(PAINT_META).layer).toBe('old-drawing.png');
  expect(scene.imageMap).toEqual(['result.png', 'generated-later.png']); expect(scene.mains).toEqual(['result.png']);
  await service.redo(session);
  expect(scene.preset.image).toBe('new-input.png'); expect(scene.meta.get('unrelated')).toBe('kept');
});

test('generation reads the replacement instead of following the parent image', async () => {
  const { scene, session, service, access } = fixture();
  await replaceInpaintBaseImage(session, scene, 'new-base', access, { service });
  const fetchImage = jest.fn(async () => 'original output');
  expect(await fetchInpaintInput({ ...access, fetchImage, getOutputDir: () => 'outs/source' }, session, scene, scene.preset, false)).toBe('new-input.png');
  expect(fetchImage).not.toHaveBeenCalled();
});

test('invalid images and failed layer copies preserve the old input and undo history', async () => {
  const { scene, session, service, access } = fixture();
  await expect(replaceInpaintBaseImage(session, scene, 'invalid', access, { service })).rejects.toThrow('invalid image');
  expect(access.storeWorkImage).not.toHaveBeenCalled();
  access.fetchVibeImage.mockRejectedValueOnce(new Error('read failed'));
  await expect(replaceInpaintBaseImage(session, scene, 'new-base', access, { service })).rejects.toThrow('read failed');
  expect(scene.preset.image).toBe('old-input.png'); expect(scene.meta.has(DETACHED_INPUT_META)).toBe(false);
  expect(service.entries(session).past).toHaveLength(0);
});

test('switching work while loading cancels the replacement', async () => {
  const { scene, session, service, access } = fixture();
  let current = true;
  access.storeWorkImage.mockImplementationOnce(async () => { current = false; return 'unapplied.png'; });
  expect(await replaceInpaintBaseImage(session, scene, 'new-base', access, { service, isCurrent: () => current })).toBeUndefined();
  expect(scene.preset.image).toBe('old-input.png'); expect(service.entries(session).past).toHaveLength(0);
});

test('works without masks or drawing and does not add unused layer references', async () => {
  const { scene, session, service, access } = fixture();
  scene.preset.mask = ''; scene.meta.delete(PAINT_META);
  await replaceInpaintBaseImage(session, scene, 'new-base', access, { service });
  expect(access.storeWorkImage).toHaveBeenCalledTimes(1);
  expect(scene.preset.mask).toBe(''); expect(scene.meta.has(PAINT_META)).toBe(false);
});
