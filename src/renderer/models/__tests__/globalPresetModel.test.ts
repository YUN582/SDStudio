const metadata = jest.fn();
const readJSON = jest.fn();
const backend = {
  existFile: jest.fn(async () => true),
  readDataFile: jest.fn(async () => 'data:image/png;base64,profile'),
  writeDataFile: jest.fn(async () => {}),
};
const imageService = { storeVibeImage: jest.fn(async () => 'local.png') };
const workFlowService = {
  buildPreset: (type: string) => ({ type, name: '', frontPrompt: '', backPrompt: '' }),
  presetFromJSON: (json: any) => ({ ...json }),
};
jest.mock('..', () => ({ backend, imageService, workFlowService }));
jest.mock('../PersistenceService', () => ({ persistService: { write: jest.fn(async () => {}) } }));
jest.mock('../SessionService', () => ({
  readJSONFromPNG: (...args: any[]) => readJSON(...args),
  normalizePresetJson: (json: any) => json,
}));
jest.mock('../util', () => ({ extractPromptDataFromBase64: (...args: any[]) => metadata(...args) }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (uri: string) => uri.split(',')[1] }));
jest.mock('../types', () => ({}));
import { GlobalPresetService } from '../GlobalPresetService';
import { ModelVersion } from '../../backends/imageGen';

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); readJSON.mockReturnValue(undefined); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test.each(['importFromImage', 'addImageAsPreset'] as const)('%s keeps the image model and sampling settings in its saved preset', async (method) => {
  metadata.mockResolvedValue({ prompt: 'scenery', uc: 'blur', steps: 24, promptGuidance: 6,
    naiDiagnostics: { modelVersion: ModelVersion.V4_5Curated } });
  const service = new GlobalPresetService();
  const entry = await service[method]('image', 'style');
  expect(entry?.preset).toMatchObject({ modelVersion: ModelVersion.V4_5Curated, steps: 24, promptGuidance: 6 });
});

test.each([undefined, ModelVersion.V5Medium])('applying a legacy or new global preset preserves its exact model: %s', async (model) => {
  metadata.mockResolvedValue({ naiDiagnostics: { modelVersion: ModelVersion.V4_5 } });
  const service = new GlobalPresetService();
  service.presets = [{ id: 'one', name: 'style', workflowType: 'SDImageGen', profile: 'one.png',
    preset: { type: 'SDImageGen', name: 'style', modelVersion: model }, isDefault: false, createdAt: 1, updatedAt: 1 }];
  const session = { selectedWorkflow: undefined, addPreset: jest.fn() } as any;
  const preset = await service.instantiateIntoSession(session, 'one', 'SDImageGenEasy');
  expect(preset.modelVersion).toBe(model ?? ModelVersion.V4_5);
  expect(preset.type).toBe('SDImageGenEasy');
  expect(preset.profile).toBe('local.png');
  expect(session.addPreset).toHaveBeenCalledWith(preset);
});

test('unreadable legacy metadata does not discard its copied representative image', async () => {
  metadata.mockRejectedValue(new Error('no metadata'));
  const service = new GlobalPresetService();
  service.presets = [{ id: 'one', name: 'style', workflowType: 'SDImageGen', profile: 'one.png',
    preset: { type: 'SDImageGen', name: 'style' }, isDefault: false, createdAt: 1, updatedAt: 1 }];
  const preset = await service.instantiateIntoSession({ addPreset: jest.fn() } as any, 'one');
  expect(preset.profile).toBe('local.png');
  expect(preset.modelVersion).toBeUndefined();
});
