jest.mock('../inpaintRequestPixels', () => ({
  prepareI2IRequestPixels: jest.fn(async (image: string) => image),
  prepareInpaintRequestPixels: jest.fn(async (image: string, mask: string) => ({ image, mask })),
}));

const getConfig = jest.fn(async () => ({}));
const generateImage = jest.fn(async (_arg: any) => {});
const deleteFile = jest.fn(async (_p: string) => {});
const onAddImage = jest.fn();

jest.mock('..', () => ({
  backend: {
    getConfig,
    generateImage,
    deleteFile,
    delegateComplete: jest.fn(async () => {}),
  },
  imageService: { onAddImage, onAddInPaint: jest.fn(), removeImageReference: jest.fn() },
  isMobile: false,
  localAIService: {},
  loginService: {},
  opusUsageService: {
    refresh: jest.fn(async () => undefined),
    takeLowWarning: jest.fn(() => false),
    takePurchasedNotice: jest.fn(() => false),
    needsPaidConfirm: jest.fn(() => false),
  },
  promptService: {},
  globalPieceService: { library: new Map() },
  sessionService: {},
  taskQueueService: {},
  workFlowService: {},
}));

jest.mock('../AppService', () => ({
  appState: { pushMessage: jest.fn(), pushDialog: jest.fn(), confirmAsync: jest.fn() },
}));

jest.mock('../PersistenceService', () => ({
  persistService: { write: jest.fn(async () => {}) },
}));

jest.mock('../PromptService', () => {
  const actual = jest.requireActual('../PromptService');
  Object.setPrototypeOf(require('..').promptService, actual.PromptService.prototype);
  return actual;
});

jest.mock('../ImageService', () => ({
  dataUriToBase64: jest.fn((data: string) => data.split(',')[1]),
}));

jest.mock('../workflows/SDWorkFlow', () => ({
  prepareMirrorCanvas: jest.fn(),
}));

jest.mock('../../componenets/BrushTool', () => ({
  getImageDimensions: jest.fn(),
}));

jest.mock('../focusedInpaintCanvas', () => ({
  prepareFocusedRequest: jest.fn(),
  composeFocusedResult: jest.fn(),
}));

import { ModelVersion, Resolution } from '../../backends/imageGen';
import { taskHandlers } from '../TaskHandlers';

function genTask(seed: number | undefined) {
  return {
    params: {
      session: { name: 'project' },
      scene: {
        name: 'scene',
        type: 'scene',
        resolution: Resolution.Custom,
        resolutionWidth: 832,
        resolutionHeight: 1216,
      },
      outputPath: 'outs/project/scene',
      nodelay: false,
      generationSnapshot: {
        schemaVersion: 1,
        modelVersion: ModelVersion.V4_5,
        furryMode: false,
        disableQuality: true,
        ucPreset: 'none',
        autoConvertWebp: false,
        autoConvertWebpQuality: 80,
      },
      job: {
        type: 'sd',
        cfgRescale: 0,
        steps: 28,
        promptGuidance: 5,
        prompt: { type: 'text', text: 'girl' },
        sampling: 'k_euler_ancestral',
        uc: '',
        characterPrompts: [],
        useCoords: false,
        legacyPromptConditioning: false,
        normalizeStrength: true,
        varietyPlus: false,
        noiseSchedule: 'karras',
        characterReferences: [],
        backend: { type: 'NAI' },
        vibes: [],
        seed,
      },
    },
    done: 0,
    total: 10,
  } as any;
}


import { promptService } from '..';
import { toPARR } from '../PromptService';

afterEach(() => jest.restoreAllMocks());

test.each(['sd', 'sd_i2i', 'sd_inpaint'])('%s resolves randomizers in every outgoing prompt per image', async type => {
  jest.clearAllMocks();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const task = genTask(1000);
  const source = 'front, ||red hair|##disabled##|blue hair||, back';
  task.params.job = { ...task.params.job, type,
    prompt: { type: 'group', children: toPARR(source).map(word => promptService.parseWord(word)) },
    uc: '||lowres|noise||',
    characterPrompts: [{ prompt: { type: 'text', text: 'test ||smile|frown||' }, uc: '||bad hands|bad feet||', position: { x: 0.5, y: 0.5 } }],
    image: 'input', mask: 'mask', strength: 0.5, noise: 0,
    sdstudioPromptSource: { schemaVersion: 1, workflowType: 'SDImageGen', frontPrompt: source, middlePrompt: '', backPrompt: '' },
  };
  const original = JSON.stringify(task.params.job);
  const handler = taskHandlers.find(h => h.checkTask(task))!;
  expect(handler).toBeDefined();
  await handler.handleTask(task, { stopped: false });
  random.mockReturnValue(0.99);
  await handler.handleTask(task, { stopped: false });
  const first = generateImage.mock.calls[0][0], second = generateImage.mock.calls[1][0];
  expect(first.prompt).toBe('front, red hair, back');
  expect(second.prompt).toBe('front, blue hair, back');
  expect(first.uc).toBe('lowres'); expect(second.uc).toBe('noise');
  expect(first.characterPrompts).toEqual(['test smile']); expect(second.characterPrompts).toEqual(['test frown']);
  expect(first.characterUCs).toEqual(['bad hands']); expect(second.characterUCs).toEqual(['bad feet']);
  for (const request of [first, second]) {
    expect([request.prompt, request.uc, ...request.characterPrompts, ...request.characterUCs].join(' ')).not.toContain('||');
    expect(request.sdstudioMetadata.promptSource.frontPrompt).toBe(source);
  }
  expect(JSON.stringify(task.params.job)).toBe(original);
});

test.each(['sd', 'sd_i2i', 'sd_inpaint'])('%s excludes commented piece rows from every outgoing prompt field', async type => {
  jest.clearAllMocks();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0.3);
  const task = genTask(1000);
  const source = 'alpha\n##hidden one\nhidden two##\n##hidden three,##\nomega';
  task.params.session.library = new Map([['L', { pieces: [{ name: 'P', multi: true, prompt: source }] }]]);
  const node = () => promptService.parseWord('<L.P>', task.params.session);
  task.params.job = { ...task.params.job, type,
    prompt: node(), uc: '<L.P>',
    characterPrompts: [{ prompt: node(), uc: '<L.P>', position: { x: 0.5, y: 0.5 } }],
    image: 'input', mask: 'mask', strength: 0.5, noise: 0,
  };
  const handler = taskHandlers.find(h => h.checkTask(task))!;
  for (const [value, expected] of [[0.3, 'alpha'], [0.5, 'omega']] as const) {
    random.mockReturnValue(value);
    await handler.handleTask(task, { stopped: false });
    const request = generateImage.mock.calls[generateImage.mock.calls.length - 1][0];
    expect(request.prompt).toBe(expected);
    expect(request.uc).toBe(expected);
    expect(request.characterPrompts).toEqual([expected]);
    expect(request.characterUCs).toEqual([expected]);
  }
  expect(task.params.session.library.get('L').pieces[0].prompt).toBe(source);
});

