const storedVibe = jest.fn(async () => 'new-vibe.png');
const storedReference = jest.fn(async () => ({ path: 'new-ref.png', srcWidth: 832, srcHeight: 1216 }));
const storedWork = jest.fn(async () => 'owned-input.png');
const createdRecord = jest.fn();
const openSource = jest.fn();
const state: any = { curSession: undefined };
const services = {
  imageService: { storeVibeImage: storedVibe, storeReferenceImageWithSize: storedReference, storeWorkImage: storedWork },
  workFlowService: {
    getDef: () => ({ sharedVars: [{ name: 'vibes' }, { name: 'characterReferences' }] }),
    createPreset: jest.fn((_type: string, values: any) => ({ ...values, type: 'SDI2I' })),
    presetFromJSON: (value: any) => ({ ...value, toJSON() { return value; } }),
    buildShared: () => ({ vibes: [], characterReferences: [] }),
  },
};
jest.mock('..', () => services);
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../presetUndo', () => ({ editWorkflowFields: (_s: any, _h: any, _t: any, _l: any, mutate: () => void) => mutate() }));
jest.mock('../sceneStructureUndo', () => ({ recordScenesCreated: (...args: any[]) => createdRecord(...args) }));
jest.mock('../undoService', () => ({ UNDO_TEXT: { vibeAdd: 'add vibe', referenceAdd: 'add ref', variantSceneCreate: (name: string) => name } }));
jest.mock('../inpaintResolution', () => ({ resolutionFromImage: async () => ({ width: 832, height: 1216 }), inpaintSceneResolutionFields: () => ({ resolution: 'custom', resolutionWidth: 832, resolutionHeight: 1216 }) }));
jest.mock('../singleImageEdit', () => ({ SINGLE_IMAGE_EDIT: 'codex.singleImageEdit.v1' }));
jest.mock('../sourceVariant', () => ({ openSourceVariant: (...args: any[]) => openSource(...args) }));
import { appendImportedImage, createImportedI2I } from '../importedImageActions';
import { Scene, Session, VibeItem, ReferenceItem } from '../types';
import { ModelVersion } from '../../backends/imageGen';

const defaults = { strength: 0.7, fidelity: 1.2, referenceType: 'character' };
let session: Session, shared: any;
beforeEach(() => {
  jest.clearAllMocks();
  storedVibe.mockImplementation(async () => 'new-vibe.png');
  session = new Session(); session.name = 'test';
  session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: 'current' };
  session.presets.set('SDImageGen', [{ name: 'current', frontPrompt: 'current front', backPrompt: 'current back', uc: 'current negative', steps: 28, characterPrompts: [{ prompt: 'enabled character' }, { prompt: 'disabled character', enabled: false }] }]);
  session.extraPrompt = 'current extra';
  shared = { vibes: [VibeItem.fromJSON({ path: 'old-vibe.png', info: 1, strength: 0.6 })], characterReferences: [ReferenceItem.fromJSON({ path: 'old-ref.png', info: 1, strength: 0.6, fidelity: 1, referenceType: 'character' })] };
  session.presetShareds.set('SDImageGen', shared);
  shared = session.presetShareds.get('SDImageGen');
  state.curSession = session;
});

test('vibe and reference append the imported pixels and preserve existing entries', async () => {
  await appendImportedImage(session, 'PIXELS', 'vibe', ModelVersion.V4_5, defaults);
  expect(storedVibe).toHaveBeenCalledWith(session, 'PIXELS', false, true);
  expect(shared.vibes.map((v: any) => v.path)).toEqual(['old-vibe.png', 'new-vibe.png']);
  await appendImportedImage(session, 'PIXELS', 'reference', ModelVersion.V4_5, defaults);
  expect(shared.characterReferences.map((r: any) => r.path)).toEqual(['old-ref.png', 'new-ref.png']);
  expect(shared.characterReferences[1]).toMatchObject({ srcWidth: 832, srcHeight: 1216, strength: 0.7, fidelity: 1.2 });
  expect(session.presets.get('SDImageGen')![0].frontPrompt).toBe('current front');
});

test('unsupported reference model cannot write image files', async () => {
  await expect(appendImportedImage(session, 'PIXELS', 'reference', ModelVersion.V4, defaults)).rejects.toThrow('지원하지');
  expect(storedReference).not.toHaveBeenCalled();
});

test('changing project during a write cannot modify either project settings', async () => {
  storedVibe.mockImplementationOnce(async () => { state.curSession = new Session(); return 'new.png'; });
  await expect(appendImportedImage(session, 'PIXELS', 'vibe', ModelVersion.V4_5, defaults)).rejects.toThrow('프로젝트');
  expect(shared.vibes).toHaveLength(1);
});

test('I2I without metadata copies current settings into exactly one work and stores an owned input', async () => {
  const work = (await createImportedI2I(session, 'PIXELS'))!;
  expect(work.preset).toMatchObject({ prompt: 'current front, current extra, current back', uc: 'current negative', image: 'owned-input.png' });
  expect(work.preset.characterPrompts.map((p: any) => p.prompt)).toEqual(['enabled character']);
  expect(work.slots).toHaveLength(0);
  expect(work.comboMode).toBeUndefined();
  expect(work.meta.get('codex.singleImageEdit.v1')).toBe(true);
  expect(session.inpaints.size).toBe(1);
  expect(storedWork).toHaveBeenCalledWith(session, work, 'input', 'PIXELS');
  expect(createdRecord).toHaveBeenCalledWith(session, [work], work.name);
});

test('metadata is used for a new external work without overwriting current generation settings', async () => {
  const work = (await createImportedI2I(session, 'PIXELS', { prompt: 'image prompt', uc: 'image negative', characterPrompts: [] } as any))!;
  expect(work.preset.prompt).toBe('image prompt');
  expect(session.presets.get('SDImageGen')![0].frontPrompt).toBe('current front');
});

test('known generated image reuses the original one-combination flow', async () => {
  const source = new Scene(); source.name = 'alpha'; session.addScene(source);
  const expected = { name: 'existing-flow-work' };
  openSource.mockImplementationOnce(async (_s, _o, _t, _p, open) => open(expected));
  expect(await createImportedI2I(session, 'PIXELS', { prompt: 'image prompt' } as any, { scene: source, path: 'outs/alpha/image.png' })).toBe(expected);
  expect(openSource).toHaveBeenCalledWith(session, source, 'SDI2I', 'outs/alpha/image.png', expect.any(Function));
  expect(storedWork).not.toHaveBeenCalled();
});

test('known image without metadata still retains its scene and source image link', async () => {
  const source = new Scene(); source.name = 'alpha'; session.addScene(source);
  const work = (await createImportedI2I(session, 'PIXELS', undefined, { scene: source, path: 'outs/alpha/image.png' }))!;
  expect(work.sceneRef).toBe('alpha');
  expect(work.sourceImage).toBe('image.png');
  expect(work.outputInSourceScene).toBe(true);
  expect(work.slots).toHaveLength(0);
});
