const handler = jest.fn(async (..._args: any[]) => {});
const fetchImage = jest.fn(async () => 'data:image/png;base64,PIXELS');
const fetchInput = jest.fn(async () => 'data:image/png;base64,PIXELS');
const metadata = jest.fn(async (): Promise<any> => ({
  prompt: 'exact image prompt',
  uc: 'negative',
  characterPrompts: [],
}));
const answer = jest.fn(async () => 'single');
jest.mock('..', () => ({
  backend: { lookupTag: jest.fn(async () => null) },
  isMobile: false,
  globalPieceService: { library: new Map() },
  get promptService() {
    return new (jest.requireActual('../PromptService').PromptService)();
  },
  sessionService: { markDirty: jest.fn() },
  imageService: {
    fetchImage,
    fetchInpaintInput: fetchInput,
    fetchVibeImage: fetchInput,
    storeWorkImage: jest.fn(async () => 'snapshot.png'),
  },
  workFlowService: {
    createPreset: (type: string, meta: any) => {
      const { WFWorkFlow } = jest.requireActual('../workflows/WorkFlow');
      const sd = jest.requireActual('../workflows/SDWorkFlow');
      const preset = new WFWorkFlow([sd.SDInpaintDef, sd.SDI2IDef].find(d => d.type === type)).buildPreset();
      for (const key of ['prompt', 'uc', 'characterPrompts', 'useCoords', 'legacyPromptConditioning']) {
        if (key in meta) preset[key] = meta[key];
      }
      return preset;
    },
    buildPreset: (type: string) => {
      const { WFWorkFlow } = jest.requireActual('../workflows/WorkFlow');
      const sd = jest.requireActual('../workflows/SDWorkFlow');
      return new WFWorkFlow([sd.SDInpaintDef, sd.SDI2IDef, sd.SDImageGenDef].find(d => d.type === type)).buildPreset();
    },
    presetFromJSON: (value: any) => ({ ...value, toJSON(this: any) { const {toJSON,...data}=this; return data; } }),
    getDef: () => ({ handler }),
  },
}));
jest.mock('../AppService', () => ({
  appState: { pushDialogAsync: answer, pushMessage: jest.fn() },
}));
jest.mock('../appStateRef', () => ({
  getAppState: () => ({ pushDialogAsync: answer, pushMessage: jest.fn() }),
}));
jest.mock('../sceneStructureUndo', () => ({
  recordScenesCreated: jest.fn(),
  mirrorImageHooks: () => ({}),
}));
jest.mock('../inpaintResolution', () => ({
  workflowUsesImageResolution: () => false,
  inpaintSceneResolutionFields: () => ({ resolution: 'portrait' }),
  paidResolutionNotice: () => undefined,
}));
jest.mock('../ImageService', () => ({
  dataUriToBase64: (data: string) => data.split(',')[1],
}));
jest.mock('../util', () => ({
  extractPromptDataFromBase64: metadata,
  sleep: async () => {},
  getPlatform: () => 'electron',
}));
import { createSourceVariant, openSourceVariant } from '../sourceVariant';
import {
  ensureSingleImagePrompt,
  SINGLE_IMAGE_BACKUP,
  KEEP_COMBINATIONS,
} from '../singleImageEdit';
import { SOURCE_IMAGE_COMBINATION } from '../sourceImageCombination';
import { lowerPromptNode } from '../PromptService';
import { InpaintScene, PromptPiece, Scene, Session } from '../types';
import { queueI2IWorkflow } from '../TaskQueueService';

beforeEach(() => {
  jest.clearAllMocks();
  answer.mockResolvedValue('single');
  metadata.mockResolvedValue({
    prompt: 'exact image prompt',
    uc: 'negative',
    characterPrompts: [],
  });
});
function setup() {
  const session = new Session();
  session.name = 'test';
  const scene = new Scene();
  scene.name = 'source';
  scene.slots = [
    Array.from({ length: 6 }, (_, i) =>
      PromptPiece.fromJSON({
        id: String(i),
        prompt: 'combo' + i,
        characterPrompts: [],
      }),
    ),
  ];
  session.scenes.set(scene.name, scene);
  session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: 'main' };
  const preset = jest.requireMock('..').workFlowService.buildPreset('SDImageGen');
  Object.assign(preset, { frontPrompt: 'front', backPrompt: 'back', uc: 'global-negative' });
  (session as any).getCommonSetup = () => ['SDImageGen', preset, { type: 'SDImageGen' }];
  return { session, scene };
}

const sourceMetadata = () => ({
  prompt: 'front, combo4, back', uc: 'negative',
  characterPrompts: [{ id: 'c', prompt: 'character, fourth-expression', uc: 'character-negative', position: { x: 0.2, y: 0.7 } }],
  useCoords: true,
  sdstudioMetadata: { schemaVersion: 1, promptSource: {
    schemaVersion: 1, workflowType: 'SDImageGen', frontPrompt: 'front',
    extraPrompt: '', middlePrompt: 'combo4', backPrompt: 'back',
  } },
});

test.each(['shared', 'snapshot'])('%s image layout queues only the actual image combination, with ten samples', async (mode) => {
  const { session, scene } = setup();
  answer.mockResolvedValue(mode);
  metadata.mockResolvedValue(sourceMetadata());
  const open = jest.fn();
  await createSourceVariant(session, scene, 'SDInpaint', 'outputs/original.png', open);
  const work = open.mock.calls[0][0] as InpaintScene;
  expect(work.comboMode).toBe(mode);
  expect(work.slots.map(s => s.map(p => p.prompt))).toEqual([['combo4']]);
  expect(work.meta.get(SOURCE_IMAGE_COMBINATION)).toBe(true);
  expect(work.meta.get(KEEP_COMBINATIONS)).toBeUndefined();
  expect(await queueI2IWorkflow(session, 'SDInpaint', work.preset, work, 10)).toBe(1);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler.mock.calls[0][6]).toBe(10);
  expect(lowerPromptNode(handler.mock.calls[0][2])).toBe('front, combo4, back');
  expect(lowerPromptNode(handler.mock.calls[0][3][0])).toBe('character, fourth-expression');
  handler.mockClear();
  session.getCommonSetup(session.selectedWorkflow!)[1].frontPrompt = 'changed-front';
  await queueI2IWorkflow(session, 'SDInpaint', work.preset, work, 10);
  expect(lowerPromptNode(handler.mock.calls[0][2])).toBe(
    mode === 'shared' ? 'changed-front, combo4, back' : 'front, combo4, back',
  );
});
test('one image from a six-combination scene creates one work and queues exactly ten samples once', async () => {
  const { session, scene } = setup();
  let work: InpaintScene | undefined;
  await createSourceVariant(
    session,
    scene,
    'SDInpaint',
    'outputs/original.png',
    (value) => {
      work = value;
    },
  );
  expect(work!.comboMode).toBeUndefined();
  expect(work!.slots).toEqual([]);
  expect(work!.preset.prompt).toBe('exact image prompt');
  expect(work!.sourceImage).toBe('original.png');
  expect(
    await queueI2IWorkflow(session, 'SDInpaint', work!.preset, work!, 10),
  ).toBe(1);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler.mock.calls[0][6]).toBe(10);
});
test('explicit new-work entry creates another work; simultaneous clicks only open one creation dialog', async () => {
  const { session, scene } = setup();
  const open = jest.fn();
  await Promise.all([
    openSourceVariant(
      session,
      scene,
      'SDInpaint',
      'outputs/original.png',
      open,
    ),
    openSourceVariant(
      session,
      scene,
      'SDInpaint',
      'outputs/original.png',
      open,
    ),
  ]);
  expect(session.inpaints.size).toBe(1);
  expect(fetchImage).toHaveBeenCalledTimes(1);
  const work = [...session.inpaints.values()][0];
  work.imageMap = ['result.png'];
  await openSourceVariant(
    session,
    scene,
    'SDInpaint',
    'outputs/original.png',
    open,
  );
  expect(open.mock.calls.at(-1)![0]).not.toBe(work);
  expect(session.inpaints.size).toBe(2);
  expect(answer).toHaveBeenCalledTimes(2);
});

test('cancelled prompt choice stores no image and creates no work', async () => {
  const { session, scene } = setup();
  answer.mockResolvedValueOnce('');
  await createSourceVariant(session, scene, 'SDInpaint', 'outputs/original.png', jest.fn());
  expect(fetchImage).not.toHaveBeenCalled();
  expect(jest.requireMock('..').imageService.storeWorkImage).not.toHaveBeenCalled();
  expect(session.inpaints.size).toBe(0);
});

test('editing a generated result records its immediate work and filename without changing the root output scene', async () => {
  const { session, scene } = setup();
  const open = jest.fn();
  await createSourceVariant(session, scene, 'SDInpaint', 'outputs/original.png', open);
  const parent = open.mock.calls[0][0] as InpaintScene;
  await createSourceVariant(session, parent, 'SDInpaint', 'outputs/result.png', open);
  const child = open.mock.calls[1][0] as InpaintScene;
  expect(child).toMatchObject({ sceneRef: scene.name, sourceInpaint: parent.name, sourceImage: 'result.png', outputInSourceScene: true });
  expect(child.toJSON().sourceInpaint).toBe(parent.name);
  expect(InpaintScene.fromJSON(child.toJSON())!.sourceInpaint).toBe(parent.name);
});
test('legacy recovery asks first, preserves combinations in backup, and cancellation leaves all data intact', async () => {
  metadata.mockResolvedValue(sourceMetadata());
  const { session, scene } = setup();
  let work: InpaintScene | undefined;
  await createSourceVariant(
    session,
    scene,
    'SDInpaint',
    'outputs/original.png',
    (value) => {
      work = value;
    },
  );
  work!.comboMode = 'snapshot';
  work!.slots = scene.slots;
  work!.preset.prompt = 'manually changed';
  answer.mockResolvedValueOnce('');
  expect(await ensureSingleImagePrompt(session, work!, () => true)).toBe(false);
  expect(work!.preset.prompt).toBe('manually changed');
  expect(work!.comboMode).toBe('snapshot');
  expect(await ensureSingleImagePrompt(session, work!, () => true)).toBe(true);
  expect(work!.meta.get(SINGLE_IMAGE_BACKUP).preset.prompt).toBe(
    'manually changed',
  );
  expect(work!.slots).toHaveLength(1);
  expect(work!.comboMode).toBe('snapshot');
  expect(work!.slots[0]).toHaveLength(1);
  expect(work!.preset.prompt).toBe('combo4');
});

test('legacy keep flag from layout choice does not bypass recovery; captured painting and settings survive', async () => {
  const { session, scene } = setup();
  metadata.mockResolvedValue(sourceMetadata());
  const open = jest.fn();
  await createSourceVariant(session, scene, 'SDI2I', 'outputs/original.png', open);
  const work = open.mock.calls[0][0] as InpaintScene;
  work.comboMode = 'snapshot';
  work.slots = scene.slots;
  work.meta.set(KEEP_COMBINATIONS, true);
  Object.assign(work.preset, { frontPrompt: 'saved-front', backPrompt: 'saved-back', mask: 'mask.png', strength: 0.4 });
  const captured = { ...work.preset, image: 'DRAWN_PIXELS', mask: 'CAPTURED_MASK' };
  expect(await queueI2IWorkflow(session, 'SDI2I', captured, work, 10)).toBe(1);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler.mock.calls[0][6]).toBe(10);
  expect(handler.mock.calls[0][4]).toMatchObject({ image: 'DRAWN_PIXELS', mask: 'CAPTURED_MASK', strength: 0.4 });
  expect(work.preset).toMatchObject({ mask: 'mask.png', strength: 0.4 });
  expect(lowerPromptNode(handler.mock.calls[0][2])).toBe('saved-front, combo4, saved-back');
  expect(work.meta.get(SINGLE_IMAGE_BACKUP).slots[0]).toHaveLength(6);
  const reloaded = InpaintScene.fromJSON(work.toJSON())!;
  answer.mockClear();
  await ensureSingleImagePrompt(session, reloaded, () => true);
  expect(answer).not.toHaveBeenCalled();
});

test('missing section metadata matches the actual prompt instead of choosing the first combination', async () => {
  const { session, scene } = setup();
  answer.mockResolvedValue('snapshot');
  metadata.mockResolvedValue({ ...sourceMetadata(), sdstudioMetadata: undefined });
  const open = jest.fn();
  await createSourceVariant(session, scene, 'SDI2I', 'outputs/original.png', open);
  expect(open.mock.calls[0][0].preset.prompt).toBe('combo4');
});

test('unidentifiable source combination creates no work or orphan image', async () => {
  const { session, scene } = setup();
  answer.mockResolvedValue('snapshot');
  await expect(createSourceVariant(session, scene, 'SDI2I', 'outputs/original.png', jest.fn())).rejects.toThrow('정확히 확인');
  expect(session.inpaints.size).toBe(0);
  expect(jest.requireMock('..').imageService.storeWorkImage).not.toHaveBeenCalled();
});
test('choosing to retain manually edited combinations never replaces their prompts', async () => {
  const { session, scene } = setup();
  let work: InpaintScene | undefined;
  await createSourceVariant(
    session,
    scene,
    'SDI2I',
    'outputs/original.png',
    (value) => {
      work = value;
    },
  );
  work!.comboMode = 'snapshot';
  work!.preset.prompt = 'manually changed';
  answer.mockResolvedValueOnce('keep');
  expect(await ensureSingleImagePrompt(session, work!, () => true)).toBe(true);
  expect(work!.preset.prompt).toBe('manually changed');
  expect(work!.comboMode).toBe('snapshot');
  answer.mockClear();
  await ensureSingleImagePrompt(session, work!, () => true);
  expect(answer).not.toHaveBeenCalled();
});
