import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GenericScene,
  InpaintScene,
  ImportableMetadata,
  PromptPiece,
  VibeItem,
  ReferenceItem,
} from '../models/types';
import {
  importedModelVersionOf,
  planPromptImport,
  planSelectedPromptImport,
  joinPromptSections,
  sceneSlotsMatchMiddle,
  skipsFixedSamplingImport,
} from '../models/sdstudioPromptImport';
import {
  activatePresetSamplingFamily,
  samplingFamilyForModel,
} from '../models/modelSamplingProfiles';
import { base64ToDataUri, getImageDimensions } from './BrushTool';
import { importedI2IResizeSize, ImportedImageSize, resizeImportedI2IImage } from '../models/importedImageResize';
import { PromptHighlighter } from './SceneEditor';
import { extractPromptDataFromBase64 } from '../models/util';
import { appState } from '../models/AppService';
import {
  backend,
  imageService,
  sessionService,
  workFlowService,
  globalPresetService,
} from '../models';
import {
  GenerationUcPreset,
  ModelVersion,
  Resolution,
  Sampling,
} from '../backends/imageGen';
import { runInAction } from 'mobx';
import { beginMetaApplyRecord } from '../models/imageStateUndo';
import { undoService, UNDO_TEXT } from '../models/undoService';
import { v4 } from 'uuid';
import ModalOverlay from './ModalOverlay';
import { appendImportedImage, createImportedI2I, ImportedImageUse } from '../models/importedImageActions';
import { referenceDefaultsFor } from '../models/referenceDefaults';
import { useGlobalModelVersion } from './useGlobalModelVersion';
import { naiCapabilitiesOf } from '../backends/genVendors/naiModelCapabilities';
import { FloatView } from './FloatView';
import InPaintEditor from './InPaintEditor';

interface ImportOptions {
  prompt: boolean;
  promptBack: boolean;
  uc: boolean;
  characters: boolean;
  charactersAppend: boolean;
  vibes: boolean;
  vibesAppend: boolean;
  settings: boolean;
  seed: boolean;
  resolution: boolean;
  references: boolean;
  modelSettings: boolean;
  /** SDStudio 구획 메타가 있을 때 씬(중간) 구획으로 현재 씬 조합을 교체할지(기본: 현재 사전설정 대상만). */
  sceneMiddle: boolean;
}

interface ExternalImageViewProps {
  image: string;
  onClose: () => void;
  scene?: GenericScene;
  sourcePath?: string;
}

export const ExternalImageView = observer(
  ({ image, onClose, scene, sourcePath }: ExternalImageViewProps) => {
    const [job, setJob] = useState<ImportableMetadata | undefined>(undefined);
    const [metadataState, setMetadataState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
    const [target, setTarget] = useState<string>('new-normal');
    const [importing, setImporting] = useState(false);
    const [options, setOptions] = useState<ImportOptions>({
      prompt: true,
      promptBack: true,
      uc: true,
      characters: true,
      charactersAppend: false,
      vibes: true,
      vibesAppend: false,
      settings: true,
      seed: true,
      resolution: true,
      references: true,
      modelSettings: true,
      sceneMiddle: false,
    });
    // 씬 교체 기본값은 대상에 따른다 — 현재 사전설정이면 생성 당시 그대로(예전 「정확히 적용」), 새 사전설정이면 씬 유지.
    useEffect(() => {
      setOptions((prev) => ({ ...prev, sceneMiddle: target === 'current' || scene?.type !== 'scene' }));
    }, [target, scene]);

    useEffect(() => {
      let active = true;
      setJob(undefined);
      setMetadataState('loading');
      void (async () => {
        try {
          const newJob = image ? await extractPromptDataFromBase64(image) : undefined;
          if (!active) return;
          if (!newJob) { setMetadataState('empty'); return; }
          newJob.prompt = newJob.prompt ?? '';
          newJob.uc = newJob.uc ?? '';
          newJob.characterPrompts = newJob.characterPrompts ?? [];
          setJob(newJob);
          setMetadataState('ready');
          setOptions((prev) => ({
            ...prev,
            characters: (newJob.characterPrompts?.length ?? 0) > 0,
            vibes: (newJob.vibes?.length ?? 0) > 0,
            resolution: !!newJob.resolution,
          }));
        } catch {
          if (active) setMetadataState('error');
        }
      })();
      return () => { active = false; };
    }, [image]);

    const modelVersion = useGlobalModelVersion();
    const capabilities = naiCapabilitiesOf(modelVersion);
    const [usingImage, setUsingImage] = useState(false);
    const useRequest = useRef(false);
    const [addedUses, setAddedUses] = useState<ImportedImageUse[]>([]);
    const [editingWork, setEditingWork] = useState<InpaintScene | undefined>();
    const [resizeI2I, setResizeI2I] = useState(false);
    const [imageSize, setImageSize] = useState<{ image: string; size: ImportedImageSize }>();
    useEffect(() => {
      let active = true;
      setResizeI2I(false);
      setImageSize(undefined);
      getImageDimensions(image).then(size => { if (active) setImageSize({ image, size }); }).catch(() => {});
      return () => { active = false; };
    }, [image]);
    const resizeTarget = imageSize?.image === image && !(scene && sourcePath)
      ? importedI2IResizeSize(imageSize.size.width, imageSize.size.height) : undefined;
    useEffect(() => { setAddedUses([]); setEditingWork(undefined); }, [image, appState.curSession, appState.curSession?.selectedWorkflow?.workflowType, appState.curSession?.selectedWorkflow?.presetName]);
    const useImage = async (use: ImportedImageUse | 'i2i') => {
      const session = appState.curSession;
      if (useRequest.current || !session || !image) return;
      useRequest.current = true; setUsingImage(true);
      try {
        if (use === 'i2i') {
          const input = resizeI2I && resizeTarget ? await resizeImportedI2IImage(image, resizeTarget) : image;
          const work = await createImportedI2I(session, input, job, { scene, path: sourcePath });
          if (work && appState.curSession === session) setEditingWork(work);
        } else {
          await appendImportedImage(session, image, use, modelVersion, referenceDefaultsFor(modelVersion));
          setAddedUses(previous => [...previous, use]);
          appState.pushMessage(use === 'vibe' ? '바이브 트랜스퍼에 추가했습니다.' : '캐릭터 레퍼런스에 추가했습니다.');
        }
      } catch (error) {
        appState.pushMessage((error as Error).message || '이미지를 사용하지 못했습니다.', 'error');
      } finally { useRequest.current = false; setUsingImage(false); }
    };
    const imageUseDisabled = importing || usingImage || !image || !appState.curSession?.selectedWorkflow;

    const setOpt = (key: keyof ImportOptions, value: boolean) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    };

    const hasCharacters = (job?.characterPrompts?.length ?? 0) > 0;
    const hasVibes = (job?.vibes?.length ?? 0) > 0;
    const hasVibeImages = (job?.vibeImageData?.length ?? 0) > 0;
    const hasRefImages = (job?.referenceImageData?.length ?? 0) > 0;
    const hasCharRefs = (job?.characterReferences?.length ?? 0) > 0;
    const hasResolution = !!job?.resolution;
    const exactSource = job?.sdstudioMetadata?.promptSource;
    // Use the recorded model; fixed-sampling models ignore imported steps/sampler/rescale.
    const importedModel = importedModelVersionOf(job);
    const skipFixedSampling = skipsFixedSamplingImport(importedModel);
    const currentWorkflowType = appState.curSession?.selectedWorkflow?.workflowType;
    const isGlobalTarget = target.startsWith('new-global');
    // 구획 분배 계획(단일 출처 sdstudioPromptImport) — 메타가 없거나 생성 프리셋이 아니면 통합 프롬프트 → 상위.
    const targetPresetType =
      target === 'new-easy'
        ? 'SDImageGenEasy'
        : target === 'current'
          ? currentWorkflowType
          : 'SDImageGen';
    const normalScene = scene?.type === 'scene' ? scene : undefined;
    const middleMode: 'scene' | 'omit' | 'fold' = !normalScene
      ? 'fold'
      : options.sceneMiddle && !isGlobalTarget
        ? 'scene'
        : 'omit';
    const promptPlan = job
      ? planPromptImport(job.prompt, exactSource, {
          targetType: targetPresetType,
          placeExtra: !isGlobalTarget,
          middle: middleMode,
        })
      : undefined;
    const splitPrompt = !!promptPlan?.split;
    const selectedPlan = job ? planSelectedPromptImport(job.prompt, exactSource, {
      targetType: targetPresetType, placeExtra: !isGlobalTarget, middle: middleMode,
    }, { front: options.prompt, back: options.promptBack, extra: options.sceneMiddle, middle: options.sceneMiddle }) : undefined;

    const applyImport = async () => {
      if (!job || !appState.curSession || !selectedPlan) return;
      setImporting(true);

      try {
        const session = appState.curSession;
        const isGlobal = target.startsWith('new-global');
        const isNew = target.startsWith('new-') && !isGlobal;
        // 통합 글로벌 프리셋은 풍부한 타입(SDImageGen)으로 저장하고, 적용 시 현재 모드로 변환된다.
        let presetType =
          target === 'new-easy' ? 'SDImageGenEasy' : 'SDImageGen';

        let preset: any;
        if (isGlobal) {
          // 글로벌 프리셋 대상 — 메모리상에서만 빌드, 세션엔 넣지 않음
          preset = workFlowService.buildPreset(presetType);
          preset.name = 'external image';
        } else if (isNew) {
          preset = workFlowService.buildPreset(presetType);
          preset.name = 'external image';
        } else if (target === 'current') {
          const wf = session.selectedWorkflow;
          if (!wf) { setImporting(false); return; }
          presetType = wf.workflowType;
          const presets = session.presets.get(presetType);
          preset = presets?.find((p: any) => p.name === wf.presetName);
          if (!preset) { setImporting(false); return; }
        }

        // 되돌리기 기록(U3a) — 프로젝트(세션) 부분만: 추가 프롬프트·그림체·공용 설정·씬 조합·해상도·새 그림체 추가.
        // 환경설정(모델 설정)·글로벌 프리셋 대상은 기록하지 않는다. 대상마다 바꾸기 직전에 이전 값을 보관하고 끝에 1항목.
        const undoRec = beginMetaApplyRecord(session);
        let configWritten = false;
        try {
          const ensureShared = () => {
            let shared = session.presetShareds.get(presetType);
            if (!shared) {
              shared = workFlowService.buildShared(presetType);
              session.presetShareds.set(presetType, shared);
            }
            undoRec.shared(shared);
            return shared;
          };

          // 모델도 맞출 때는 값을 넣기 전에 대상 계열 프로필로 먼저 전환한다 — 넣은 뒤 config 변경으로 편집기가 계열을
          // 바꾸면 방금 넣은 값이 이전 계열 프로필로 들어가 사라진다(2026-11-06). 되돌리기는 전환 뒤 값부터 기록.
          const applyModel =
            !isGlobal && options.modelSettings ? importedModel : undefined;
          const applyFamily = applyModel ? samplingFamilyForModel(applyModel) : undefined;
          if (applyFamily) {
            // Other presets retain their own model and active sampling profile.
            activatePresetSamplingFamily(preset, applyFamily);
          }
          if (target === 'current') undoRec.preset(preset);
          undoRec.scene(normalScene, ['slots']);
          if (options.resolution && job.resolution) undoRec.scene(scene, ['resolution', 'resolutionWidth', 'resolutionHeight']);

          runInAction(() => {
            if (selectedPlan.frontPrompt !== undefined) preset.frontPrompt = selectedPlan.frontPrompt;
            if (selectedPlan.split) {
              if (selectedPlan.backPrompt !== undefined) preset.backPrompt = selectedPlan.backPrompt;
              if (!isGlobal && selectedPlan.extraPrompt !== undefined) {
                session.extraPrompt = selectedPlan.extraPrompt;
              }
              if (
                selectedPlan.middlePrompt !== undefined &&
                normalScene &&
                !sceneSlotsMatchMiddle(normalScene.slots, selectedPlan.middlePrompt)
              ) {
                normalScene.slots = selectedPlan.middlePrompt.trim()
                  ? [[
                      PromptPiece.fromJSON({
                        id: v4(),
                        prompt: selectedPlan.middlePrompt,
                        characterPrompts: [],
                        enabled: true,
                      }),
                    ]]
                  : [];
              }
              if (
                !isGlobal &&
                presetType === 'SDImageGenEasy' &&
                (selectedPlan.characterPrompt !== undefined || selectedPlan.backgroundPrompt !== undefined)
              ) {
                const shared = ensureShared();
                if (selectedPlan.characterPrompt !== undefined) shared.characterPrompt = selectedPlan.characterPrompt;
                if (selectedPlan.backgroundPrompt !== undefined) shared.backgroundPrompt = selectedPlan.backgroundPrompt;
              }
            } else if (options.prompt && (isNew || isGlobal)) {
              preset.backPrompt = '';
            }
            if (options.uc) {
              preset.uc = job.uc ?? '';
            }
            if (options.characters && hasCharacters) {
              if (options.charactersAppend && !isNew && !isGlobal) {
                preset.characterPrompts = [
                  ...(preset.characterPrompts || []),
                  ...job.characterPrompts.map((cp, i) => ({
                    ...cp,
                    id: `imported_${Date.now()}_${i}`,
                  })),
                ];
              } else {
                preset.characterPrompts = job.characterPrompts ?? [];
              }
            }
            if (options.settings) {
              if (!skipFixedSampling) {
                preset.sampling = job.sampling ?? Sampling.KEulerAncestral;
                preset.steps = job.steps ?? 28;
                preset.cfgRescale = job.cfgRescale ?? 0;
              }
              preset.noiseSchedule = job.noiseSchedule ?? 'karras';
              preset.promptGuidance = job.promptGuidance ?? 5;
              preset.useCoords = job.useCoords ?? false;
              preset.varietyPlus = job.varietyPlus ?? false;
              preset.deliberateEulerAncestralBug = job.deliberateEulerAncestralBug ?? false;
              preset.legacyPromptConditioning = job.legacyPromptConditioning ?? false;
            }
          });

          if (
            applyModel &&
            !job.sdstudioMetadata?.generationSettings
          ) {
            // Official metadata identifies the model; quality options require an SDStudio snapshot.
            const config = await backend.getConfig();
            await backend.setConfig({ ...config, modelVersion: applyModel });
            sessionService.configChanged();
            configWritten = true;
          }
          if (
            applyModel &&
            job.sdstudioMetadata?.generationSettings
          ) {
            const saved = job.sdstudioMetadata.generationSettings;
            const config = await backend.getConfig();
            await backend.setConfig({
              ...config,
              modelVersion: applyModel,
              furryMode: saved.furryMode,
              disableQuality: saved.disableQuality,
              qualityPreset: saved.qualityPreset,
              ucPreset: saved.ucPreset as GenerationUcPreset,
              transparentBackground: saved.transparentBackground ?? false,
            });
            sessionService.configChanged();
            configWritten = true;
          }

          // 글로벌 프리셋 대상: shared state(시드/바이브/캐릭터 레퍼런스)는 저장 안 함
          // Bind after config writes, so selection synchronization cannot race the quality import.
          if (importedModel && (isGlobal || options.modelSettings)) {
            runInAction(() => { preset.modelVersion = importedModel; });
          }
          // (글로벌 프리셋은 그림체 설정만 저장. 시드/바이브/레퍼런스는 세션 단위 데이터)
          if (isGlobal) {
            try {
              const entry = await globalPresetService.addFromPresetAndImage(
                preset,
                image,
                preset.name,
              );
              appState.pushMessage(`"${entry.name}" 프리셋을 글로벌로 복사했습니다.`);
              onClose();
            } catch (e: any) {
              appState.pushMessage(
                '글로벌로 복사 실패: ' + (e?.message || e),
              );
            }
            return;
          }

          // 시드는 presetShared에 저장
          if (options.seed && job.seed != null) {
            const shared = ensureShared();
            runInAction(() => {
              shared.seed = job.seed;
            });
          }

          if (options.vibes && hasVibes) {
            const shared = ensureShared();
            const newVibes: VibeItem[] = [];
            for (let i = 0; i < job.vibes.length; i++) {
              const vibe = job.vibes[i];
              // 더미 파일명 생성 (인코딩된 데이터의 키로 사용)
              const dummyName = v4() + '.png';
              if (job.vibeImageData?.[i]) {
                // 메타데이터의 바이브 데이터는 이미 인코딩된 상태
                // storeVibeImage (raw 이미지 저장) 대신 storeEncodedVibeImage로 직접 저장
                await imageService.storeEncodedVibeImage(
                  session, dummyName, job.vibeImageData[i], vibe.info,
                );
              }
              const item = new VibeItem();
              item.path = dummyName;
              item.strength = vibe.strength;
              item.info = vibe.info;
              newVibes.push(item);
            }
            runInAction(() => {
              if (options.vibesAppend && !isNew) {
                shared.vibes = [...(shared.vibes || []), ...newVibes];
              } else {
                shared.vibes = newVibes;
              }
              shared.normalizeStrength = job.normalizeStrength ?? true;
            });
          }

          if (options.references && hasCharRefs) {
            const shared = ensureShared();
            const newRefs: ReferenceItem[] = [];
            for (let i = 0; i < job.characterReferences.length; i++) {
              const ref = job.characterReferences[i];
              let path = '';
              if (job.referenceImageData?.[i]) {
                path = await imageService.storeReferenceImage(session, job.referenceImageData[i]);
              }
              const item = new ReferenceItem();
              item.path = path;
              item.strength = ref.strength;
              item.fidelity = ref.fidelity;
              item.info = ref.info;
              item.referenceType = ref.referenceType;
              // 「같은 의상 선호」 명시 값(V5 메타). 원본 크기는 적지 않는다 — 이미 가공된 그림이라 보낼 때 탐지에 맡긴다.
              if (typeof ref.preferSameOutfit === 'boolean') item.preferSameOutfit = ref.preferSameOutfit;
              item.enabled = true;
              newRefs.push(item);
            }
            runInAction(() => {
              shared.characterReferences = newRefs;
            });
          }

          if (options.resolution && job.resolution && scene) {
            runInAction(() => {
              scene.resolution = Resolution.Custom;
              scene.resolutionWidth = job.resolution!.width;
              scene.resolutionHeight = job.resolution!.height;
            });
          }

          if (isNew) {
            const prevSelected = session.selectedWorkflow;
            session.addPreset(preset);
            session.selectedWorkflow = {
              workflowType: preset.type,
              presetName: preset.name,
            };
            undoRec.presetAdded(preset, prevSelected);
          }
          onClose();
        } finally {
          undoRec.commit();
          if (configWritten && undoService.canRecord(session)) {
            appState.pushMessage(UNDO_TEXT.metaApplyConfigNotUndone, 'info');
          }
        }
      } finally {
        setImporting(false);
      }
    };

    const generationRows: { label: string; value: React.ReactNode; applied?: boolean }[] = job ? [
      { label: '모델', value: job.naiDiagnostics?.model ?? importedModel ?? '알 수 없음' },
      ...(job.naiDiagnostics?.modelHash ? [{ label: '모델 해시', value: job.naiDiagnostics.modelHash }] : []),
      ...(job.naiDiagnostics ? [
        { label: '요청 형식', value: job.naiDiagnostics.paramsVersion !== undefined ? 'params ' + job.naiDiagnostics.paramsVersion : job.naiDiagnostics.requestType ?? '알 수 없음' },
        ...(job.naiDiagnostics.metadataVersion !== undefined ? [{ label: '메타데이터 버전', value: 'v' + job.naiDiagnostics.metadataVersion }] : []),
        { label: '품질 / UC 힌트', value: (job.naiDiagnostics.qualityHint ?? '-') + ' / ' + (job.naiDiagnostics.ucHint ?? '-') },
        { label: '투명 배경', value: job.naiDiagnostics.transparentBackground ? 'ON' : 'OFF' },
        ...(job.naiDiagnostics.straightAlpha !== undefined ? [{ label: 'Straight alpha', value: job.naiDiagnostics.straightAlpha ? 'ON' : 'OFF' }] : []),
      ] : []),
      { label: '스텝', value: job.steps ?? '-' },
      { label: '가이던스', value: job.promptGuidance ?? '-' },
      { label: 'CFG 리스케일', value: job.cfgRescale ?? '-' },
      { label: '샘플러', value: job.sampling ?? '-' },
      { label: '노이즈 스케줄', value: job.noiseSchedule ?? job.naiDiagnostics?.noiseSchedule ?? '알 수 없음' },
      { label: 'Variety+', value: job.varietyPlus ? 'ON' : 'OFF' },
      { label: 'Euler A 버그', value: job.deliberateEulerAncestralBug ? 'ON' : 'OFF' },
      { label: '캐릭터 좌표', value: job.useCoords ? 'ON' : 'OFF' },
      { label: 'Legacy UC', value: job.legacyPromptConditioning ? 'ON' : 'OFF' },
      { label: '시드', value: job.seed ?? '없음', applied: options.seed && !isGlobalTarget },
      ...(hasResolution ? [{ label: '해상도', value: job.resolution!.width + ' × ' + job.resolution!.height, applied: options.resolution && !!scene && !isGlobalTarget }] : []),
    ] : [];
    const choice = (key: keyof ImportOptions, label: string, disabled = false) => (
      <label className={'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-default ' + (disabled ? 'opacity-40' : 'cursor-pointer hover:bg-[var(--c-surface)]')}>
        <input type="checkbox" checked={!disabled && options[key]} disabled={disabled || importing}
          onChange={event => setOpt(key, event.target.checked)} className="w-4 h-4 accent-sky-500 flex-none" />
        {label}
      </label>
    );

    const controls = job && <div className="w-full" data-metadata-options="">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
        <label htmlFor="metadata-import-target" className="text-sm font-medium text-default">적용할 프리셋</label>
        <select id="metadata-import-target" className="gray-input text-sm py-1.5 px-2 flex-1 min-w-48" value={target} disabled={importing}
          onChange={event => setTarget(event.target.value)}>
          <optgroup label="현재 프로젝트">
            <option value="new-normal">새 일반 사전설정</option>
            {appState.legacyWorkflowMode && <option value="new-easy">새 이지모드 사전설정</option>}
            {appState.curSession?.selectedWorkflow && <option value="current">현재 사전설정에 적용</option>}
          </optgroup>
          <optgroup label="글로벌 프리셋"><option value="new-global">새 글로벌 그림체</option></optgroup>
        </select>
      </div>
      <fieldset>
        <legend className="text-xs font-medium text-muted mb-1">불러올 항목</legend>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-2 gap-y-0.5">
          {choice('prompt', splitPrompt ? '상위 프롬프트' : '통합 프롬프트')}
          {choice('sceneMiddle', '중간 프롬프트', !splitPrompt)}
          {choice('promptBack', '하위 프롬프트', !splitPrompt)}
          {choice('uc', '네거티브 프롬프트')}
          {choice('characters', '캐릭터 프롬프트', !hasCharacters)}
          {choice('settings', '파라미터')}
          {choice('seed', '시드', job.seed == null || isGlobalTarget)}
          {choice('resolution', '해상도', !hasResolution || !scene || isGlobalTarget)}
          {choice('vibes', '바이브 트랜스퍼', !hasVibes || isGlobalTarget)}
          {choice('references', '캐릭터 레퍼런스', !hasCharRefs || isGlobalTarget)}
          {choice('modelSettings', '모델·공통 설정', isGlobalTarget || !(importedModel || job.sdstudioMetadata?.generationSettings))}
        </div>
        {target === 'current' && ((hasCharacters && options.characters) || (hasVibes && options.vibes)) && (
          <div className="flex flex-wrap gap-x-3 mt-1">
            {hasCharacters && options.characters && choice('charactersAppend', '캐릭터 프롬프트 추가 모드')}
            {hasVibes && options.vibes && choice('vibesAppend', '바이브 추가 모드')}
          </div>
        )}
      </fieldset>
      <p className="text-xs text-muted mt-2 mb-0">
        {!splitPrompt ? '구획 정보가 없어 통합 프롬프트를 상위 프롬프트에 적용합니다.'
          : isGlobalTarget ? '글로벌 그림체에는 프롬프트와 파라미터를 저장합니다. 씬 조합은 저장하지 않습니다.'
          : normalScene ? '중간을 선택하면 프로젝트 추가 프롬프트를 적용하고 씬 조합을 생성 당시 한 조합으로 교체합니다.'
          : '씬이 없어 선택한 중간 프롬프트는 하위 프롬프트 앞에 포함합니다.'}
      </p>
    </div>;

    return <>
      {createPortal(
      <ModalOverlay isOpen={!editingWork} onClose={() => { if (!importing && !usingImage) onClose(); }} title="메타데이터 적용" size="xl" expandedHeight bodyPadding="none"
        footerStart={<div role="group" aria-label="이미지 사용" className="flex flex-wrap items-center gap-2">
            <button type="button" className="round-button back-gray px-3 py-2 text-sm"
              title={capabilities.supportsVibeTransfer ? '불러온 이미지 자체를 현재 설정의 바이브에 추가합니다' : '현재 모델은 바이브 트랜스퍼를 지원하지 않습니다'}
              disabled={imageUseDisabled || !capabilities.supportsVibeTransfer || addedUses.includes('vibe')} onClick={() => void useImage('vibe')}>
              {addedUses.includes('vibe') ? '바이브 추가됨' : '바이브로 추가'}
            </button>
            <button type="button" className="round-button back-gray px-3 py-2 text-sm"
              title={capabilities.supportsCharacterReference ? '불러온 이미지 자체를 현재 설정의 레퍼런스에 추가합니다' : '현재 모델은 캐릭터 레퍼런스를 지원하지 않습니다'}
              disabled={imageUseDisabled || !capabilities.supportsCharacterReference || addedUses.includes('reference')} onClick={() => void useImage('reference')}>
              {addedUses.includes('reference') ? '레퍼런스 추가됨' : '레퍼런스로 추가'}
            </button>
            <button type="button" className="round-button back-green px-3 py-2 text-sm"
              title="이 이미지로 새 I2I 편집 작업을 엽니다" disabled={imageUseDisabled || metadataState === 'loading'} onClick={() => void useImage('i2i')}>I2I 편집</button>
            {resizeTarget && <label className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-default cursor-pointer"
              title="1,048,576픽셀 이하에서 원본 비율에 가까운 큰 크기로 입력 이미지를 축소합니다. 여백을 붙이거나 원본 파일을 바꾸지 않습니다.">
              <input type="checkbox" checked={resizeI2I} disabled={imageUseDisabled} onChange={event => setResizeI2I(event.target.checked)} />
              <span>사이즈 축소</span>
              <span className="text-xs text-muted tabular-nums">{imageSize!.size.width} × {imageSize!.size.height} → {resizeTarget.width} × {resizeTarget.height}</span>
            </label>}
        </div>}
        footer={<button className="round-button back-sky px-5 py-2 text-sm font-medium" onClick={applyImport} disabled={importing || usingImage || !job}>
            {importing ? '적용 중...' : '적용'}
        </button>}>
        <div className="sds-metadata-import" data-metadata-import="">
          <section className="sds-metadata-image" data-metadata-image="" data-image-only={!job || undefined} aria-label="불러온 이미지">
            {image && <img alt="메타데이터를 불러올 이미지" src={base64ToDataUri(image)} draggable={false} />}
          </section>
          {controls && <section className="sds-metadata-import-options">{controls}</section>}
          <div className={'sds-metadata-details' + (job ? ' sds-metadata-details--ready' : '')} data-metadata-preview="" data-selectable-text tabIndex={0}>
          <div className="sds-metadata-prompts">
            {metadataState === 'loading' && <div role="status" className="text-muted text-sm py-8 text-center">메타데이터를 추출하는 중...</div>}
            {metadataState === 'empty' && <div role="status" className="text-muted text-sm py-8 text-center">이 이미지에는 불러올 생성 정보가 없습니다.</div>}
            {metadataState === 'error' && <div role="alert" className="text-muted text-sm py-8 text-center">이미지의 생성 정보를 읽지 못했습니다. 이미지를 다시 열어 주세요.</div>}
            {job && <>
              <MetadataSection label="프롬프트">
                {splitPrompt && exactSource ? (
                  <div className="flex flex-col gap-3">
                    {([
                      ['상위 프롬프트', exactSource.frontPrompt, options.prompt],
                      ['중간 프롬프트', joinPromptSections(exactSource.extraPrompt, exactSource.middlePrompt), options.sceneMiddle],
                      ['하위 프롬프트', exactSource.backPrompt, options.promptBack],
                      ...(exactSource.characterPrompt !== undefined ? [['캐릭터 관련 태그', exactSource.characterPrompt, options.prompt]] : []),
                      ...(exactSource.backgroundPrompt !== undefined ? [['배경 관련 태그', exactSource.backgroundPrompt, options.promptBack]] : []),
                    ] as [string, string, boolean][]).map(([label, text, selected]) => (
                      <div key={label}>
                        <div className="flex items-center gap-2 text-xs text-muted mb-1">{label}{!selected && <span>적용 안 함</span>}</div>
                        {text?.trim() ? <PromptHighlighter text={text} expandable className="w-full max-h-[min(40vh,28rem)] overflow-auto text-sm p-2 rounded" />
                          : <div className="text-xs text-muted px-2">비어 있음</div>}
                      </div>
                    ))}
                  </div>
                ) : <PromptHighlighter text={job.prompt} expandable className="w-full max-h-[min(40vh,28rem)] overflow-auto text-sm p-2 rounded" />}
              </MetadataSection>
              <MetadataSection label="네거티브 프롬프트" selected={options.uc}>
                <PromptHighlighter text={job.uc} expandable className="w-full max-h-28 overflow-auto text-sm p-2 rounded" />
              </MetadataSection>
              {hasCharacters && <MetadataSection label="캐릭터 프롬프트" selected={options.characters}>
                {job.characterPrompts.map(cp => <div key={cp.id} className="mb-2 p-2.5 bg-[var(--c-surface)] rounded-lg text-sm">
                  <div className="text-muted text-xs mb-1">Pos: ({cp.position?.x?.toFixed(2) ?? '-'}, {cp.position?.y?.toFixed(2) ?? '-'})</div>
                  {cp.prompt?.trim() && <PromptHighlighter text={cp.prompt} expandable className="w-full max-h-[min(30vh,20rem)] overflow-auto text-sm p-2 rounded" />}
                  {cp.uc?.trim() && <>
                    <div className="text-muted mt-2 mb-1 text-xs">네거티브</div>
                    <PromptHighlighter text={cp.uc} expandable className="w-full max-h-28 overflow-auto text-xs p-2 rounded" />
                  </>}
                </div>)}
              </MetadataSection>}
              {hasVibes && <MetadataSection label={`바이브 트랜스퍼 (${job.vibes.length}개)`} selected={options.vibes && !isGlobalTarget}>
                {hasVibeImages ? <div className="flex gap-2 flex-wrap">{job.vibeImageData!.map((img, i) => (
                  <div key={i} className="text-center">
                    <img alt={`바이브 ${i + 1}`} src={`data:image/png;base64,${img}`} className="w-16 h-16 object-cover rounded-md border line-color" />
                    <div className="text-xs text-muted mt-1">S:{job.vibes[i]?.strength?.toFixed(2)} I:{job.vibes[i]?.info?.toFixed(2)}</div>
                  </div>
                ))}</div> : <div className="text-sm text-muted">
                  <p className="text-xs mb-2">원본 이미지 없이 인코딩된 바이브 데이터로 적용합니다.</p>
                  {job.vibes.map((v, i) => <div key={i} className="text-xs py-1">강도 (RS): {v.strength?.toFixed(2)} · 정보 (IS): {v.info?.toFixed(2)}</div>)}
                </div>}
              </MetadataSection>}
              {hasCharRefs && <MetadataSection label={`캐릭터 레퍼런스 (${job.characterReferences.length}개)`} selected={options.references && !isGlobalTarget}>
                {hasRefImages ? <div className="flex gap-2 flex-wrap">{job.referenceImageData!.map((img, i) => (
                  <div key={i} className="text-center">
                    <img alt={`캐릭터 레퍼런스 ${i + 1}`} src={`data:image/png;base64,${img}`} className="w-16 h-16 object-cover rounded-md border line-color" />
                    <div className="text-xs text-muted mt-1">S:{job.characterReferences[i]?.strength?.toFixed(2)}</div>
                  </div>
                ))}</div> : <div className="text-xs text-muted">원본 이미지는 없지만, 레퍼런스 설정으로 적용합니다.</div>}
              </MetadataSection>}
            </>}
          </div>
          {job && <aside className="sds-metadata-generation" aria-label="생성 정보" data-metadata-generation="">
            <MetadataSection label="생성 정보">
              {!options.settings && <p className="text-xs text-muted mb-3">파라미터 적용 안 함</p>}
              <dl className="sds-metadata-generation-list" data-metadata-parameters="">
                {generationRows.map(row => <div key={row.label} data-metadata-resolution={row.label === '해상도' ? '' : undefined}>
                  <dt>{row.label}{row.applied === false && <span className="ml-2 text-xs font-normal">적용 안 함</span>}</dt>
                  <dd>{row.value}</dd>
                </div>)}
              </dl>
              {skipFixedSampling && <p className="text-xs text-muted mt-3 mb-0" data-v5m-import-note="">V5M 이미지의 스텝·샘플러·CFG 리스케일은 고정값이어서 적용하지 않습니다.</p>}
              {(job.sdstudioMetadata?.generationSettings || importedModel) && <p className="text-xs text-muted mt-3 mb-0">
                {job.sdstudioMetadata?.generationSettings
                  ? '모델·공통 설정을 선택하면 사전설정의 모델과 공통 품질, UC 프리셋, 투명 배경 설정도 적용합니다.'
                  : '모델·공통 설정을 선택하면 이미지의 모델을 사전설정에 저장합니다.'}
              </p>}
            </MetadataSection>
          </aside>}
          </div>
        </div>
      </ModalOverlay>,
      document.querySelector('[data-app-theme-root]') ?? document.body,
      )}
      {editingWork && <FloatView priority={3} onEscape={() => setEditingWork(undefined)}>
        <InPaintEditor editingScene={editingWork} onConfirm={() => setEditingWork(undefined)} onDelete={() => setEditingWork(undefined)} />
      </FloatView>}
    </>;
  },
);

function MetadataSection({ label, selected = true, children }: { label: string; selected?: boolean; children: React.ReactNode }) {
  return <section className="mb-3 rounded-lg border line-color p-3">
    <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-default">{label}{!selected && <span className="text-xs font-normal text-muted">적용 안 함</span>}</div>
    {children}
  </section>;
}
