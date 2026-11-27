import { observable, runInAction } from 'mobx';
import { ModelVersion } from '../../backends/imageGen';
import { PresetModelService } from '../PresetModelService';

function style(name: string, modelVersion: ModelVersion | undefined) {
  return observable({ name, type: 'SDImageGen', modelVersion, steps: 28, promptGuidance: 7, profile: '' });
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
let service: PresetModelService, state: any, a: any, b: any, config: any, deps: any;
const choose = (name: string) => runInAction(() => { state.session.selectedWorkflow = { workflowType: 'SDImageGen', presetName: name }; });
beforeEach(() => {
  a = style('a', ModelVersion.V4_5); b = style('b', ModelVersion.V5);
  state = observable({ session: { name: 'project', selectedWorkflow: { workflowType: 'SDImageGen', presetName: 'a' },
    presets: new Map([['SDImageGen', [a, b]]]) } });
  config = { modelVersion: ModelVersion.V5, furryMode: true, ucPreset: 'none' };
  deps = { getSession: () => state.session, getConfig: jest.fn(async () => ({ ...config })),
    setConfig: jest.fn(async (value: any) => { config = { ...value }; }), recoverModel: jest.fn(async () => undefined),
    canWrite: () => true, markDirty: jest.fn(), changed: jest.fn(), onError: jest.fn() };
  service = new PresetModelService(deps);
});
afterEach(() => service.stop());

test('selecting styles switches their exact models without changing unrelated settings or other styles', async () => {
  service.start(); await service.ready();
  expect(config.modelVersion).toBe(ModelVersion.V4_5);
  choose('b'); await service.ready(); expect(config.modelVersion).toBe(ModelVersion.V5);
  choose('a'); await service.ready(); expect(config.modelVersion).toBe(ModelVersion.V4_5);
  expect(config).toMatchObject({ furryMode: true, ucPreset: 'none' });
  expect(a.modelVersion).toBe(ModelVersion.V4_5); expect(b.modelVersion).toBe(ModelVersion.V5);
});

test('manual changes remember exact Curated and Medium versions for subsequent selections', async () => {
  service.start(); await service.ready();
  await service.changeModel(ModelVersion.V4_5Curated);
  choose('b'); await service.ready(); await service.changeModel(ModelVersion.V5Medium);
  choose('a'); await service.ready(); expect(config.modelVersion).toBe(ModelVersion.V4_5Curated);
  choose('b'); await service.ready(); expect(config.modelVersion).toBe(ModelVersion.V5Medium);
});

test('legacy profiles recover the known metadata model before binding the preset', async () => {
  a.modelVersion = undefined; a.profile = 'old.png';
  deps.recoverModel.mockResolvedValue(ModelVersion.V4_5);
  service.start(); await service.ready();
  expect(config.modelVersion).toBe(ModelVersion.V4_5); expect(a.modelVersion).toBe(ModelVersion.V4_5);
  expect(deps.markDirty).toHaveBeenCalled();
  choose('b'); await service.ready(); choose('a'); await service.ready();
  expect(deps.recoverModel).toHaveBeenCalledTimes(1);
});

test('without model metadata, a legacy preset retains the current model rather than guessing from its name', async () => {
  a.modelVersion = undefined; a.name = 'style for 4.5'; choose(a.name);
  service.start(); await service.ready();
  expect(a.modelVersion).toBe(ModelVersion.V5); expect(config.modelVersion).toBe(ModelVersion.V5);
});

test('a slow metadata read cannot override a later selection', async () => {
  a.modelVersion = undefined;
  let release!: (version: ModelVersion) => void;
  deps.recoverModel.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  service.start(); await flush(); choose('b'); release(ModelVersion.V4_5);
  await service.ready();
  expect(config.modelVersion).toBe(ModelVersion.V5); expect(b.modelVersion).toBe(ModelVersion.V5);
  expect(a.modelVersion).toBeUndefined();
});

test('serialized writes finish at the latest selection even when a prior write is already in flight', async () => {
  config.modelVersion = ModelVersion.V4_5;
  service.start(); await service.ready();
  let release!: () => void;
  deps.setConfig.mockImplementationOnce(async (value: any) => { config = { ...value }; await new Promise<void>(resolve => { release = resolve; }); });
  choose('b'); await flush(); choose('a'); release(); await service.ready();
  expect(config.modelVersion).toBe(ModelVersion.V4_5);
});

test('changing a saved model directly, including undo restoration, synchronizes the effective model', async () => {
  service.start(); await service.ready();
  runInAction(() => { a.modelVersion = ModelVersion.V5; }); await service.ready();
  expect(config.modelVersion).toBe(ModelVersion.V5);
  runInAction(() => { a.modelVersion = ModelVersion.V4_5; }); await service.ready();
  expect(config.modelVersion).toBe(ModelVersion.V4_5);
});

test('a failed manual save restores the prior preset model', async () => {
  service.start(); await service.ready();
  deps.setConfig.mockRejectedValueOnce(new Error('disk busy'));
  await expect(service.changeModel(ModelVersion.V5)).rejects.toThrow('disk busy');
  await service.ready(); expect(a.modelVersion).toBe(ModelVersion.V4_5);
});

test('viewing a read-only project does not rewrite its preset', async () => {
  deps.canWrite = () => false;
  service.start(); await service.ready();
  expect(config.modelVersion).toBe(ModelVersion.V4_5); expect(deps.markDirty).not.toHaveBeenCalled();
  await expect(service.changeModel(ModelVersion.V5)).rejects.toThrow('소유 창');
  expect(a.modelVersion).toBe(ModelVersion.V4_5);
});
