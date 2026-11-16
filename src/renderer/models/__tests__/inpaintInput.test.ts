import {
  fetchInpaintInput,
  maskPixelsHavePaint,
  DETACHED_INPUT_META,
} from '../inpaintInput';

const fixture = () => {
  const parent = { name: 'source', type: 'scene' };
  const session = { scenes: new Map([['source', parent]]) } as any;
  const work = {
    workflowType: 'SDInpaint',
    sceneRef: 'source',
    sourceImage: 'original.png',
    preset: { image: 'snapshot.png' },
    meta: new Map(),
  } as any;
  const access = {
    getOutputDir: () => 'workspace/id/outs/source',
    fetchImage: jest.fn(async () => 'current'),
    fetchVibeImage: jest.fn(async () => 'snapshot'),
  };
  return { session, work, access };
};

test('linked input reads the current output, including subsequent external changes', async () => {
  const { session, work, access } = fixture();
  expect(await fetchInpaintInput(access, session, work)).toBe('current');
  access.fetchImage.mockResolvedValue('edited');
  expect(await fetchInpaintInput(access, session, work)).toBe('edited');
  expect(access.fetchVibeImage).not.toHaveBeenCalled();
});
test('deleted sources fail instead of silently using an old duplicate', async () => {
  const { session, work, access } = fixture();
  session.scenes.clear();
  await expect(fetchInpaintInput(access, session, work)).rejects.toThrow(
    '원본 씬',
  );
  expect(access.fetchVibeImage).not.toHaveBeenCalled();
});
test('explicit input replacement and queued pixel snapshots are independent from the linked source', async () => {
  const { session, work, access } = fixture();
  work.meta.set(DETACHED_INPUT_META, true);
  expect(await fetchInpaintInput(access, session, work)).toBe('snapshot');
  work.meta.clear();
  expect(
    await fetchInpaintInput(access, session, work, { image: 'PIXELS' }),
  ).toBe('data:image/png;base64,PIXELS');
  expect(access.fetchImage).not.toHaveBeenCalled();
});
test('transparent white and opaque black are not mask paint; opaque colored pixels are', () => {
  expect(
    maskPixelsHavePaint(
      new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 255]),
    ),
  ).toBe(false);
  expect(maskPixelsHavePaint(new Uint8ClampedArray([0, 0, 255, 255]))).toBe(
    true,
  );
});
