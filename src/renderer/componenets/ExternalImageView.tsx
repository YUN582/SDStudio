import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GenericScene,
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
  samplingFamilyForModel,
  switchSessionSamplingFamily,
} from '../models/modelSamplingProfiles';
import { base64ToDataUri } from './BrushTool';
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
}

export const ExternalImageView = observer(
  ({ image, onClose, scene }: ExternalImageViewProps) => {
    const [job, setJob] = useState<ImportableMetadata | undefined>(undefined);
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
      (async () => {
        if (!image) return;
        const newJob = await extractPromptDataFromBase64(image);
        if (!newJob) return;
        newJob.prompt = newJob.prompt ?? '';
        newJob.uc = newJob.uc ?? '';
        newJob.characterPrompts = newJob.characterPrompts ?? [];
        setJob(newJob);
        setOptions((prev) => ({
          ...prev,
          characters: (newJob.characterPrompts?.length ?? 0) > 0,
          vibes: (newJob.vibes?.length ?? 0) > 0,
          resolution: !!newJob.resolution,
        }));
      })();
    }, [image]);

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
    // 맞출 모델(SDStudio 메타 또는 공식 PNG 의 V5 Medium 해시) — 고정값 모델이면 스텝·샘플러·리스케일은 적용하지 않는다.
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
            target === 'current' && options.modelSettings ? importedModel : undefined;
          const applyFamily = applyModel ? samplingFamilyForModel(applyModel) : undefined;
          if (applyFamily) switchSessionSamplingFamily(session, applyFamily);
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
            // 공식 웹 V5 Medium 이미지 — 모델만 맞춘다(품질·UC 프리셋 등은 SDStudio 메타가 있을 때만).
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

    const choice = (key: keyof ImportOptions, label: string, disabled = false) => (
      <label className={'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-default ' + (disabled ? 'opacity-40' : 'cursor-pointer hover:bg-[var(--c-surface)]')}>
        <input type="checkbox" checked={!disabled && options[key]} disabled={disabled || importing}
          onChange={event => setOpt(key, event.target.checked)} className="w-4 h-4 accent-sky-500 flex-none" />
        {label}
      </label>
    );

    const controls = job && <div className="w-full max-h-[45vh] overflow-auto" data-metadata-options="">
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
          {choice('modelSettings', '모델·품질 전역 설정', target !== 'current' || !(importedModel || job.sdstudioMetadata?.generationSettings))}
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

    return createPortal(
      <ModalOverlay isOpen onClose={() => { if (!importing) onClose(); }} title="메타데이터 적용" size="xl" expandedHeight bodyPadding="none"
        toolbar={controls}
        footer={<button className="round-button back-sky px-5 py-2 text-sm font-medium" onClick={applyImport} disabled={importing || !job}>
          {importing ? '적용 중...' : '적용'}
        </button>}>
        <div className="h-full min-h-0 flex flex-col md:flex-row overflow-hidden" data-metadata-import="">
          <div className="flex-1 min-w-0 overflow-y-auto p-4 md:p-5" data-metadata-preview="" data-selectable-text tabIndex={0}>
            {!job && <div className="text-muted text-sm py-8 text-center">메타데이터를 추출하는 중...</div>}
            {job && <>
                  {job.naiDiagnostics && (
                    <div className="mb-4 rounded-lg border line-color p-3 bg-[var(--c-surface)]">
                      <div className="text-sm font-semibold text-default mb-2">
                        NAI 생성 정보
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="text-muted">모델</div>
                        <div className="text-body">
                          {job.naiDiagnostics.model}
                          {job.naiDiagnostics.modelHash
                            ? ` (${job.naiDiagnostics.modelHash})`
                            : ''}
                        </div>
                        <div className="text-muted">요청 형식</div>
                        <div className="text-body">
                          {job.naiDiagnostics.paramsVersion !== undefined
                            ? `params ${job.naiDiagnostics.paramsVersion}`
                            : job.naiDiagnostics.requestType
                              ? `${job.naiDiagnostics.requestType}${
                                  job.naiDiagnostics.metadataVersion !== undefined
                                    ? ` / metadata v${job.naiDiagnostics.metadataVersion}`
                                    : ''
                                }`
                              : job.naiDiagnostics.metadataVersion !== undefined
                                ? `metadata v${job.naiDiagnostics.metadataVersion}`
                                : '알 수 없음'}
                        </div>
                        <div className="text-muted">Noise Schedule</div>
                        <div className="text-body">
                          {job.naiDiagnostics.noiseSchedule ?? '알 수 없음'}
                        </div>
                        <div className="text-muted">품질 / UC 힌트</div>
                        <div className="text-body">
                          {job.naiDiagnostics.qualityHint ?? '-'} / {' '}
                          {job.naiDiagnostics.ucHint ?? '-'}
                        </div>
                        <div className="text-muted">투명 배경</div>
                        <div className="text-body">
                          {job.naiDiagnostics.transparentBackground ? 'ON' : 'OFF'}
                          {job.naiDiagnostics.straightAlpha !== undefined
                            ? ` / straight alpha ${job.naiDiagnostics.straightAlpha ? 'ON' : 'OFF'}`
                            : ''}
                        </div>
                      </div>
                    </div>
                  )}
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
                        {text?.trim() ? <PromptHighlighter text={text} className="w-full max-h-28 overflow-auto text-sm p-2 rounded" />
                          : <div className="text-xs text-muted px-2">비어 있음</div>}
                      </div>
                    ))}
                  </div>
                ) : <PromptHighlighter text={job.prompt} className="w-full max-h-28 overflow-auto text-sm p-2 rounded" />}
              </MetadataSection>
              <MetadataSection label="네거티브 프롬프트" selected={options.uc}>
                <PromptHighlighter text={job.uc} className="w-full max-h-28 overflow-auto text-sm p-2 rounded" />
              </MetadataSection>
              {hasCharacters && <MetadataSection label="캐릭터 프롬프트" selected={options.characters}>
                {job.characterPrompts.map(cp => <div key={cp.id} className="mb-2 p-2.5 bg-[var(--c-surface)] rounded-lg text-sm">
                  <div className="text-muted text-xs mb-1">Pos: ({cp.position?.x?.toFixed(2) ?? '-'}, {cp.position?.y?.toFixed(2) ?? '-'})</div>
                  <div className="text-body break-words">{cp.prompt}</div>
                  {cp.uc && <div className="text-muted mt-1 break-words text-xs">UC: {cp.uc}</div>}
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
              <MetadataSection label="파라미터" selected={options.settings}>
                <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-x-4 gap-y-2 text-sm min-w-0 break-words" data-metadata-parameters="">
                  {[
                    ['Steps', job.steps], ['CFG', job.promptGuidance], ['Rescale', job.cfgRescale], ['Sampler', job.sampling],
                    ['Noise', job.noiseSchedule], ['Variety+', job.varietyPlus ? 'ON' : 'OFF'],
                    ['Euler A Bug', job.deliberateEulerAncestralBug ? 'ON' : 'OFF'], ['Coords', job.useCoords ? 'ON' : 'OFF'],
                    ['Legacy UC', job.legacyPromptConditioning ? 'ON' : 'OFF'],
                  ].map(([label, value]) => <div key={String(label)}><span className="text-muted">{label}:</span> <span className="text-body">{value}</span></div>)}
                  <div className="mt-3 min-[480px]:col-start-1">
                    <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-default">시드{(!options.seed || isGlobalTarget) && <span className="text-xs font-normal text-muted">적용 안 함</span>}</div>
                    <div className="text-body tabular-nums">{job.seed ?? '없음'}</div>
                  </div>
                  {hasResolution && <div className="mt-3" data-metadata-resolution="">
                    <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-default">해상도{(!options.resolution || !scene || isGlobalTarget) && <span className="text-xs font-normal text-muted">적용 안 함</span>}</div>
                    <div className="text-body tabular-nums">{job.resolution!.width} × {job.resolution!.height}</div>
                  </div>}
                </div>
                {skipFixedSampling && <div className="text-xs text-muted mt-2" data-v5m-import-note="">V5M(Medium) 이미지라 스텝·샘플러·CFG 리스케일은 고정값이어서 적용하지 않습니다.</div>}
              </MetadataSection>
              {(job.sdstudioMetadata?.generationSettings || importedModel) && <MetadataSection label="모델·품질 전역 설정" selected={options.modelSettings && target === 'current'}>
                <div className="text-xs text-muted">{job.sdstudioMetadata?.generationSettings
                  ? '현재 사전설정에 적용할 때 모델, 품질, UC 프리셋과 투명 배경 설정을 생성 당시 값으로 맞춥니다.'
                  : '현재 사전설정에 적용할 때 모델을 V5M(Medium)으로 맞춥니다.'}</div>
              </MetadataSection>}
            </>}
          </div>
          <div className="hidden md:flex flex-none w-72 lg:w-80 border-l line-color items-center justify-center bg-[var(--c-surface)] p-3">
            {image && <img alt="메타데이터를 불러올 이미지" src={base64ToDataUri(image)} draggable={false} className="max-w-full max-h-full object-contain rounded-lg" />}
          </div>
        </div>
      </ModalOverlay>,
      document.querySelector('[data-app-theme-root]') ?? document.body,
    );
  },
);

function MetadataSection({ label, selected = true, children }: { label: string; selected?: boolean; children: React.ReactNode }) {
  return <section className="mb-3 rounded-lg border line-color p-3">
    <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-default">{label}{!selected && <span className="text-xs font-normal text-muted">적용 안 함</span>}</div>
    {children}
  </section>;
}
