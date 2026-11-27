const storedVibe = jest.fn(async () => 'new-vibe.png');
const storedReference = jest.fn(async () => ({ path: 'new-ref.png', srcWidth: 832, srcHeight: 1216 }));
const storedWork = jest.fn(async () => 'owned-input.png');
const createdRecord = jest.fn();
const openSource = jest.fn();
const chooseCombo = jest.fn();
const state: any = { curSession: undefined, pushMessage: jest.fn() };
const services = {
  imageService: { storeVibeImage: storedVibe, storeReferenceImageWithSize: storedReference, storeWorkImage: storedWork },
  workFlowService: {
    getDef: () => ({ sharedVars: [{ name: 'vibes' }, { name: 'characterReferences' }] }),
    createPreset: jest.fn((type: string, values: any) => ({ ...values, type })),
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
jest.mock('../singleImageEdit', () => ({ SINGLE_IMAGE_EDIT: 'codex.singleImageEdit.v1', EXPLICIT_COMBINATIONS: 'sdstudio.explicitImageEditCombinations.v1' }));
jest.mock('../sourceVariant', () => ({ openSourceVariant: (...args: any[]) => openSource(...args) }));
jest.mock('../comboSource', () => ({ chooseNewVariantCombo: (...args: any[]) => chooseCombo(...args), COMBO_SOURCE_TEXT: { currentNotice: 'current prompt becomes middle' } }));
import { appendImportedImage, createImportedI2I } from '../importedImageActions';
import { Scene, Session, VibeItem, ReferenceItem, PromptPiece } from '../types';
import { ModelVersion } from '../../backends/imageGen';

const defaults = { strength: 0.7, fidelity: 1.2, referenceType: 'character' };
let session: Session, shared: any;
beforeEach(() => {
  jest.clearAllMocks();
  chooseCombo.mockResolvedValue({ kind: 'single' });
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
  expect(work.workflowType).toBe('SDInpaint');
  expect(work.preset).toMatchObject({ type: 'SDInpaint', mask: '', strength: 0.6 });
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

test('cancelling the external prompt choice creates no work or input file', async () => {
  chooseCombo.mockResolvedValueOnce(undefined);
  expect(await createImportedI2I(session, 'PIXELS')).toBeUndefined();
  expect(chooseCombo).toHaveBeenCalledWith(session, undefined, 'SDInpaint');
  expect(storedWork).not.toHaveBeenCalled();
  expect(createdRecord).not.toHaveBeenCalled();
  expect(session.inpaints.size).toBe(0);
});

const useCombo = (mode: 'shared' | 'snapshot') => chooseCombo.mockResolvedValueOnce({
  kind: 'combo', mode, fromCurrent: true,
  apply: (work: any) => {
    work.comboMode = mode;
    work.slots = [[PromptPiece.fromJSON({ id: 'imported-middle', prompt: work.preset.prompt, characterPrompts: [], enabled: true })]];
  },
});

test.each(['shared', 'snapshot'] as const)('external %s starts with the exact image middle and one explicit combination', async mode => {
  useCombo(mode);
  const metadata: any = { prompt: 'image front, image middle, image back', uc: 'image negative', characterPrompts: [], sdstudioMetadata: { promptSource: { middlePrompt: 'image middle' } } };
  const work = (await createImportedI2I(session, 'PIXELS', metadata))!;
  expect(work.comboMode).toBe(mode);
  expect(work.preset).toMatchObject({ prompt: 'image middle', uc: 'image negative', useGlobalUc: false, image: 'owned-input.png', mask: '' });
  expect(work.slots.map(slot => slot.map(piece => piece.prompt))).toEqual([['image middle']]);
  expect(work.meta.get('sdstudio.explicitImageEditCombinations.v1')).toBe(true);
  expect(session.inpaints.size).toBe(1);
  expect(state.pushMessage).not.toHaveBeenCalled();
});

test('metadata-free combo mode leaves the middle empty so current upper, extra, lower and negative prompts are not duplicated', async () => {
  useCombo('shared');
  const work = (await createImportedI2I(session, 'PIXELS'))!;
  expect(work.preset).toMatchObject({ prompt: '', uc: '', useGlobalUc: true });
  expect(work.slots.map(slot => slot.map(piece => piece.prompt))).toEqual([['']]);
  expect(work.preset.characterPrompts.map((p: any) => p.prompt)).toEqual(['enabled character']);
  expect(session.extraPrompt).toBe('current extra');
  expect(session.presets.get('SDImageGen')![0].frontPrompt).toBe('current front');
});

test('external metadata without prompt sections retains the full prompt and explains the middle fallback', async () => {
  useCombo('snapshot');
  const work = (await createImportedI2I(session, 'PIXELS', { prompt: 'whole external prompt', uc: 'image negative' } as any))!;
  expect(work.slots[0][0].prompt).toBe('whole external prompt');
  expect(work.preset.uc).toBe('image negative');
  expect(state.pushMessage).toHaveBeenCalledWith('current prompt becomes middle', 'info');
});

test('changing project while the mode chooser is open cannot write an input or add a work', async () => {
  chooseCombo.mockImplementationOnce(async () => { state.curSession = new Session(); return { kind: 'single' }; });
  await expect(createImportedI2I(session, 'PIXELS')).rejects.toThrow('프로젝트');
  expect(storedWork).not.toHaveBeenCalled();
  expect(session.inpaints.size).toBe(0);
});

test('known generated image reuses the original one-combination flow', async () => {
  const source = new Scene(); source.name = 'alpha'; session.addScene(source);
  const expected = { name: 'existing-flow-work', preset: {} };
  openSource.mockImplementationOnce(async (_s, _o, _t, _p, open) => open(expected));
  expect(await createImportedI2I(session, 'PIXELS', { prompt: 'image prompt' } as any, { scene: source, path: 'outs/alpha/image.png' })).toBe(expected);
  expect(openSource).toHaveBeenCalledWith(session, source, 'SDInpaint', 'outs/alpha/image.png', expect.any(Function));
  expect(expected.preset).toEqual({ strength: 0.6, mask: '' });
  expect(storedWork).not.toHaveBeenCalled();
  expect(chooseCombo).not.toHaveBeenCalled();
});

test('known image without metadata still retains its scene and source image link', async () => {
  const source = new Scene(); source.name = 'alpha'; session.addScene(source);
  const work = (await createImportedI2I(session, 'PIXELS', undefined, { scene: source, path: 'outs/alpha/image.png' }))!;
  expect(work.sceneRef).toBe('alpha');
  expect(work.sourceImage).toBe('image.png');
  expect(work.outputInSourceScene).toBe(true);
  expect(work.slots).toHaveLength(0);
});
