import { reaction, runInAction } from 'mobx';
import type { Config } from '../../main/config';
import { ModelVersion } from '../backends/imageGen';
import { isKnownModelVersion, normalizeModelVersion } from '../backends/genVendors/naiModelCapabilities';
import { activatePresetSamplingFamily, samplingFamilyForModel } from './modelSamplingProfiles';
import type { Session } from './types';

export function selectedModelPreset(session: Session | undefined): any | undefined {
  const selected = session?.selectedWorkflow;
  if (!selected) return undefined;
  const presets = session?.presets?.get(selected.workflowType);
  return selected.presetName ? presets?.find(p => p.name === selected.presetName) : presets?.[0];
}

export function savedPresetModel(preset: any): ModelVersion | undefined {
  return isKnownModelVersion(preset?.modelVersion) ? preset.modelVersion : undefined;
}

export function assignPresetModel(preset: any, version: ModelVersion): void {
  runInAction(() => {
    preset.modelVersion = version;
    const family = samplingFamilyForModel(version);
    if (family) activatePresetSamplingFamily(preset, family);
  });
}

interface Dependencies {
  getSession: () => Session | undefined;
  getConfig: () => Promise<Config>;
  setConfig: (config: Config) => Promise<void>;
  recoverModel: (session: Session, preset: any) => Promise<ModelVersion | undefined>;
  canWrite: (session: Session) => boolean;
  markDirty: (session: Session) => void;
  changed: () => void;
  onError: (error: unknown) => void;
}

/** Selection, undo, project changes and imports share one serialized model switch. */
export class PresetModelService {
  private pending: Promise<void> = Promise.resolve();
  private sequence = 0;
  private dispose?: () => void;

  constructor(private deps: Dependencies) {}

  start(): void {
    if (this.dispose) return;
    this.dispose = reaction(
      () => {
        const session = this.deps.getSession();
        const preset = selectedModelPreset(session);
        return { session, preset, model: preset?.modelVersion };
      },
      () => { void this.syncSelected().catch(this.deps.onError); },
      { fireImmediately: true, equals: (a, b) => a.session === b.session && a.preset === b.preset && a.model === b.model },
    );
  }

  stop(): void {
    this.dispose?.();
    this.dispose = undefined;
    this.sequence++;
  }

  syncSelected(globalOverride?: ModelVersion): Promise<void> {
    const sequence = ++this.sequence;
    const task = this.pending.catch(() => {}).then(async () => {
      if (sequence !== this.sequence) return;
      const session = this.deps.getSession(), preset = selectedModelPreset(session);
      if ((!session || !preset) && !globalOverride) return;
      const config = await this.deps.getConfig();
      const current = () => sequence === this.sequence && session === this.deps.getSession() &&
        preset === selectedModelPreset(session);
      if (!current()) return;
      let version = savedPresetModel(preset);
      if (!version && preset && session) {
        try { version = await this.deps.recoverModel(session, preset); }
        catch { /* Legacy profiles without readable metadata retain the current model. */ }
      }
      if (!current()) return;
      version ??= globalOverride ?? normalizeModelVersion(config.modelVersion);
      if (preset && session && this.deps.canWrite(session)) {
        const changed = savedPresetModel(preset) !== version;
        assignPresetModel(preset, version);
        if (changed) this.deps.markDirty(session);
      }
      if (config.modelVersion !== version) {
        // Re-read immediately before writing to preserve concurrent unrelated settings.
        const latest = await this.deps.getConfig();
        if (!current()) return;
        await this.deps.setConfig({ ...latest, modelVersion: version });
      }
      if (current()) this.deps.changed();
    });
    this.pending = task;
    return task;
  }

  async ready(): Promise<void> {
    // Rapid selections can schedule another switch while an earlier write finishes.
    let pending: Promise<void>;
    do { pending = this.pending; await pending; } while (pending !== this.pending);
  }

  async changeModel(version: ModelVersion): Promise<void> {
    const session = this.deps.getSession(), preset = selectedModelPreset(session);
    const previous = savedPresetModel(preset), previousFamily = preset?.samplingProfileFamily;
    if (preset && session) {
      if (!this.deps.canWrite(session)) throw new Error('이 프로젝트의 소유 창에서 모델을 변경해 주세요.');
      assignPresetModel(preset, version);
      this.deps.markDirty(session);
    }
    try { await this.syncSelected(preset ? undefined : version); }
    catch (error) {
      if (preset && preset.modelVersion === version) {
        runInAction(() => {
          preset.modelVersion = previous;
          if (previousFamily) activatePresetSamplingFamily(preset, previousFamily);
        });
        if (session) this.deps.markDirty(session);
      }
      throw error;
    }
  }
}
