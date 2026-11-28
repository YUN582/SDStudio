import { prepareInpaintRequestPixels } from '../inpaintRequestPixels';
import { loadImageFromBase64 } from '../focusedInpaintCanvas';

jest.mock('../focusedInpaintCanvas', () => ({ loadImageFromBase64: jest.fn() }));
const load = loadImageFromBase64 as jest.Mock;
let contexts: any[];
let canvases: any[];

beforeEach(() => {
  jest.clearAllMocks();
  contexts = [];
  canvases = [];
  load.mockResolvedValue({ naturalWidth: 3212, naturalHeight: 2043 });
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const context = { drawImage: jest.fn(), imageSmoothingEnabled: true };
    contexts.push(context);
    canvases.push(this);
    return context as any;
  });
  jest.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,RESIZED');
});

afterEach(() => jest.restoreAllMocks());

test('large replacement image and mask match the requested size with separate interpolation', async () => {
  const size = Object.freeze({ width: 1280, height: 768 });
  const result = await prepareInpaintRequestPixels('IMAGE', 'MASK', size);
  expect(result).toEqual({ image: 'RESIZED', mask: 'RESIZED' });
  expect(canvases.map(c => [c.width, c.height])).toEqual([[1280, 768], [1280, 768]]);
  expect(contexts[0].imageSmoothingEnabled).toBe(true);
  expect(contexts[0].imageSmoothingQuality).toBe('high');
  expect(contexts[1].imageSmoothingEnabled).toBe(false);
  contexts.forEach(ctx => expect(ctx.drawImage).toHaveBeenCalledWith(
    expect.objectContaining({ naturalWidth: 3212 }), 0, 0, 1280, 768,
  ));
});

test('matching inputs retain their bytes without canvas conversion', async () => {
  load.mockResolvedValue({ naturalWidth: 1280, naturalHeight: 768 });
  expect(await prepareInpaintRequestPixels('IMAGE', 'MASK', { width: 1280, height: 768 }))
    .toEqual({ image: 'IMAGE', mask: 'MASK' });
  expect(canvases).toHaveLength(0);
});

test('image and mask are checked independently and data URIs are stripped', async () => {
  load.mockResolvedValueOnce({ naturalWidth: 1280, naturalHeight: 768 });
  expect(await prepareInpaintRequestPixels('data:image/png;base64,IMAGE', 'MASK', { width: 1280, height: 768 }))
    .toEqual({ image: 'IMAGE', mask: 'RESIZED' });
  expect(load).toHaveBeenNthCalledWith(1, 'IMAGE');
  expect(contexts[0].imageSmoothingEnabled).toBe(false);
});

test.each([0, -1, NaN, Infinity, 1.5])('rejects invalid request dimension %s', async width => {
  await expect(prepareInpaintRequestPixels('IMAGE', 'MASK', { width, height: 768 })).rejects.toThrow();
  expect(load).not.toHaveBeenCalled();
});

test('unreadable or missing inputs fail locally', async () => {
  load.mockRejectedValueOnce(new Error('decode'));
  await expect(prepareInpaintRequestPixels('BAD', 'MASK', { width: 1280, height: 768 })).rejects.toThrow('decode');
  await expect(prepareInpaintRequestPixels('IMAGE', '', { width: 1280, height: 768 })).rejects.toThrow('마스크');
});
