const handler = jest.fn(async (..._args: any[]) => {});
const fetchImage = jest.fn(async () => 'data:image/png;base64,PIXELS');
const fetchInput = jest.fn(async () => 'data:image/png;base64,PIXELS');
const metadata = jest.fn(async () => ({
  prompt: 'exact image prompt',
  uc: 'negative',
  characterPrompts: [],
}));
const answer = jest.fn(async () => 'single');
jest.mock('..', () => ({
  backend: {},
  isMobile: false,
  sessionService: { markDirty: jest.fn() },
  imageService: {
    fetchImage,
    fetchInpaintInput: fetchInput,
    fetchVibeImage: fetchInput,
    storeVibeImage: jest.fn(async () => 'snapshot.png'),
  },
  workFlowService: {
    createPreset: (type: string, meta: any) => ({ type, ...meta }),
    buildPreset: (type: string) => ({ type }),
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
} from '../singleImageEdit';
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
  return { session, scene };
}
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
  expect(jest.requireMock('..').imageService.storeVibeImage).not.toHaveBeenCalled();
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
  expect(work!.comboMode).toBeUndefined();
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
