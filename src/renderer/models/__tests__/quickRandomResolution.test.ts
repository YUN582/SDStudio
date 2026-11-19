const addTask = jest.fn(async () => {});
const capture = jest.fn(async () => ({ modelVersion: '4-5-full' }));
jest.mock('..', () => ({ backend: {}, isMobile: false, promptService: {},
  imageService: { getOutputDir: () => 'outs/quick/default' },
  taskQueueService: { addTask, captureGenerationSnapshot: capture },
}));
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../TaskQueueService', () => ({}));
jest.mock('../ImageService', () => ({ dataUriToBase64: (v: string) => v }));
import { queueQuickScene } from '../sceneQueueActions';
import { SDImageGenDef } from '../workflows/SDWorkFlow';
import { QUICK_RESOLUTION_META, readQuickResolutionSettings } from '../quickResolution';
import { seedForImageIndex } from '../seedSchedule';

afterEach(() => jest.restoreAllMocks());
beforeEach(() => jest.clearAllMocks());

test('normalizes saved choices without duplicates or malformed sizes', () => {
  expect(readQuickResolutionSettings(undefined).enabled).toBe(false);
  const saved = { enabled: true, choices: [{ resolution: 'square' }, { resolution: 'custom', width: 1024, height: 1024 },
    { resolution: 'nope' }, { resolution: 'custom', width: -1, height: 64 }, { resolution: 'custom', width: 768, height: 1280 }] };
  expect(readQuickResolutionSettings(JSON.parse(JSON.stringify(saved)))).toEqual({ enabled: true,
    choices: [{ resolution: 'square' }, { resolution: 'custom', width: 768, height: 1280 }] });
});

function setup(enabled: boolean) {
  const scene = { name: 'default', type: 'scene', resolution: 'portrait', meta: new Map([[QUICK_RESOLUTION_META,
    { enabled, choices: [{ resolution: 'square' }, { resolution: 'custom', width: 768, height: 1280 }] }]]) };
  const preset = { characterPrompts: [], backend: { type: 'NAI' } };
  const shared = { type: 'SDImageGen', seed: 1234 };
  const def = { ...SDImageGenDef, createPrompt: async () => [{ type: 'text', text: 'girl' }], createCharacterPrompts: async () => [[]] };
  const promptSession = { selectedWorkflow: {}, getCommonSetup: () => ['SDImageGen', preset, shared, def] };
  return { scene, preset, shared, promptSession, quickSession: { name: 'quick' } };
}

test('queues one selected size per image, preserving seeds and immutable request sizes', async () => {
  jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99).mockReturnValueOnce(0);
  const { scene, preset, shared, promptSession, quickSession } = setup(true);
  const original = JSON.stringify({ preset, shared, resolution: scene.resolution });
  await queueQuickScene(promptSession as any, quickSession as any, scene as any, 3);
  expect(capture).toHaveBeenCalledTimes(1);
  const calls = addTask.mock.calls as any[][];
  expect(calls.map(([, count]) => count)).toEqual([1, 1, 1]);
  expect(calls.map(([param]) => param.job.overrideResolution)).toEqual([
    { width: 1024, height: 1024 }, { width: 768, height: 1280 }, { width: 1024, height: 1024 }]);
  expect(calls.map(([param]) => param.job.seed)).toEqual([0, 1, 2].map(i => seedForImageIndex(1234, i)));
  expect(calls.every(([param]) => param.scene === scene && param.session === quickSession)).toBe(true);
  scene.meta.clear();scene.resolution = 'landscape';
  expect(calls[0][0].job.overrideResolution).toEqual({ width: 1024, height: 1024 });
  scene.resolution = 'portrait';
  expect(JSON.stringify({ preset, shared, resolution: scene.resolution })).toBe(original);
});

test('fixed mode keeps the original count and handler path', async () => {
  const { scene, promptSession, quickSession } = setup(false);
  await queueQuickScene(promptSession as any, quickSession as any, scene as any, 10);
  expect(addTask).toHaveBeenCalledTimes(1);
  expect((addTask.mock.calls as any[][])[0][1]).toBe(10);
  expect((addTask.mock.calls as any[][])[0][0].job.overrideResolution).toBeUndefined();
  expect(capture).not.toHaveBeenCalled();
});
