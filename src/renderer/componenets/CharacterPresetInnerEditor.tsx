import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  FaArrowLeft,
  FaCheck,
  FaChevronDown,
  FaChevronRight,
  FaChevronUp,
  FaToggleOff,
  FaToggleOn,
  FaTrash,
  FaPlus,
} from 'react-icons/fa';
import { CharacterPreset, ReferenceItem, VibeItem } from '../models/types';
import { appState } from '../models/AppService';
import PromptEditTextArea from './PromptEditTextArea';
import { referenceDefaultsFor } from '../models/referenceDefaults';
import { ReferenceTypeControl } from './ReferenceTypeControl';
import { useGlobalModelVersion } from './useGlobalModelVersion';
import {
  REFERENCE_EDITOR_TEXT,
  referenceEditorSpec,
  showCostumeUnsupported,
} from '../models/referenceEditorSpec';
import { EditableSliderValue } from './VibeEditor';
import { ReferenceStrengthSlider } from './ReferenceStrengthSlider';
import { PresetImageBackend, VibeImage } from './CharacterPresetCards';
import { useBackLayer } from '../models/BackStackService';
import { useGuardedClose } from './backdropClose';
import { OverlayFooterBar, DIALOG_PRIMARY_BTN, DIALOG_SECONDARY_BTN } from './ModalOverlay';

function PresetMediaPanel({ title, onUpload, multiple = false, children, footer }: {
  title: string; onUpload: (base64: string) => Promise<void>; multiple?: boolean; children?: React.ReactNode; footer?: React.ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files) return;
    try {
      for (const file of Array.from(files).filter(file => file.type.startsWith('image/')).slice(0, multiple ? undefined : 1)) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = reject; reader.readAsDataURL(file);
        });
        await onUpload(data);
      }
    } catch { appState.pushMessage('이미지를 추가하지 못했습니다. 파일을 확인해주세요.', 'error'); }
  };
  return <section data-preset-media={title} className={'relative min-w-0 rounded-lg border p-3 bg-[var(--c-surface-2)] ' + (dragging ? 'border-sky-500 ring-2 ring-sky-500' : 'line-color')}
    onDragEnter={event => { event.preventDefault(); event.stopPropagation(); setDragging(true); }}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); void upload(event.dataTransfer.files); }}>
    <header className="flex items-center justify-between gap-2 mb-3">
      <h3 className="text-sm font-medium text-default">{title}</h3>
      <button type="button" aria-label={`${title} 이미지 추가`} title="이미지 추가" className="back-sky rounded-full h-8 w-8 flex-none flex items-center justify-center hover:brightness-110 active:brightness-90" onClick={() => input.current?.click()}><FaPlus size={14} /></button>
      <input ref={input} type="file" accept="image/*" multiple={multiple} className="hidden" aria-label={`${title} 파일 선택`}
        onChange={event => { void upload(event.target.files); event.target.value = ''; }} />
    </header>
    {children || <button type="button" className="w-full min-h-72 border-2 border-dashed line-color rounded-lg flex flex-col items-center justify-center gap-2 text-muted hover:text-sky-500 hover:border-sky-500" onClick={() => input.current?.click()}>
      <FaPlus size={22} /><span className="text-sm">드래그하거나 클릭하여 이미지 추가</span>
    </button>}
    {footer}
  </section>;
}

function RemovablePresetImage({ path, label, onRemove, imageClass = 'h-44' }: {
  path: string; label: string; onRemove: () => void; imageClass?: string;
}) {
  return <button type="button" aria-label={`${label} 제거`} title="클릭하여 이미지 제거" className="group/media relative block w-full overflow-hidden rounded-lg bg-[var(--c-surface)] focus-visible:ring-2 focus-visible:ring-red-400" onClick={onRemove}>
    <VibeImage path={path} className={`w-full object-contain ${imageClass}`} />
    <span className="absolute inset-0 flex items-center justify-center gap-2 bg-black/65 text-red-200 opacity-0 group-hover/media:opacity-100 group-focus-visible/media:opacity-100 transition-opacity"><FaTrash size={16} /><span className="text-sm">클릭하여 제거</span></span>
  </button>;
}

// CharacterPresetEditor.tsx 에서 분리된 프리셋 편집 폼.
// ─── 편집 폼 ─────────────────────────────────────────────────
interface CharacterPresetInnerEditorProps {
  preset: CharacterPreset;
  onSave: (preset: CharacterPreset) => void;
  onCancel: () => void;
  isNew: boolean;
  imageBackend: PresetImageBackend;
  /**
   * 미저장 판정을 바깥 창(캐릭터 프리셋 관리 ModalOverlay 의 dirty)에 알려 주는 자리(2026-10-03 E2-4).
   * 편집 중에는 「처음 값과 다른가」 함수를, 편집이 끝나면(언마운트) null 을 넣는다.
   * 이 prop 을 준 곳(캐릭터 프리셋 관리)만 미저장 가드·「목록으로」 닫기 층이 켜진다 — 일괄 생성·템플릿 관리의
   * 인라인 편집은 예전 그대로.
   */
  dirtyRef?: React.MutableRefObject<(() => boolean) | null>;
  /**
   * 배치(2026-11-15 C-3). 'inline'(기본) = 종전 한 열 폼(템플릿 관리·일괄 생성·모바일 — DOM 그대로).
   * 'frame' = 캐릭터 프리셋 관리(PC) 전용 — 창 본문(bodyPadding 'none')을 채우는 h-full 배치:
   * 돌아가기 줄 → 두 열(열마다 스크롤) → 표시 전용 바닥줄 [프리셋 저장/추가][취소].
   */
  layout?: 'inline' | 'frame';
  active?: boolean;
}

export const CharacterPresetInnerEditor = observer(({
  preset,
  onSave,
  onCancel,
  isNew,
  imageBackend,
  dirtyRef,
  layout = 'inline',
  active = true,
}: CharacterPresetInnerEditorProps) => {
  // 레퍼런스 편집 규칙(상한·Fidelity·의상) — 전역 생성 모델 기준(세 편집기 공용 referenceEditorSpec).
  const globalModelVersion = useGlobalModelVersion();
  const refSpec = referenceEditorSpec(globalModelVersion);
  const [name, setName] = useState(preset.name);
  const [characterPrompt, setCharacterPrompt] = useState(preset.characterPrompt);
  const [characterUC, setCharacterUC] = useState(preset.characterUC);
  const [backgroundPrompt] = useState(preset.backgroundPrompt);
  const [vibes, setVibes] = useState<VibeItem[]>([...preset.vibes]);
  const [characterReferences, setCharacterReferences] = useState<ReferenceItem[]>([...preset.characterReferences]);
  const [representativeImage, setRepresentativeImage] = useState(preset.representativeImage || '');
  // 파일명 옵션
  const [filenamePrefix, setFilenamePrefix] = useState(preset.filenamePrefix || '');
  const [filenameSuffix, setFilenameSuffix] = useState(preset.filenameSuffix || '');
  const [showFilenameOptions, setShowFilenameOptions] = useState(true);

  // ── 미저장 가드(2026-10-03 E2-3·E2-4) ──
  // 저장 대상 필드의 처음 값과 비교한다(바이브·레퍼런스는 toJSON 으로 비교).
  const formSnapshot = () =>
    JSON.stringify({
      name,
      characterPrompt,
      characterUC,
      vibes,
      characterReferences,
      representativeImage,
      filenamePrefix,
      filenameSuffix,
    });
  const initialSnapshot = useRef<string | null>(null);
  if (initialSnapshot.current === null) initialSnapshot.current = formSnapshot();
  const isDirty = () => formSnapshot() !== initialSnapshot.current;
  if (dirtyRef) dirtyRef.current = isDirty;
  useEffect(
    () => () => {
      if (dirtyRef) dirtyRef.current = null;
    },
    [dirtyRef],
  );
  // 안쪽 편집의 Esc·뒤로 가기·「돌아가기」·[취소] = 목록으로(편집 폼 자체가 한 겹 — 관리 창 전체를 닫지 않는다).
  // 변경이 있으면 「버리고 닫을까요?」 확인 뒤 목록으로. 이름 칸 등 data-esc-cancel 입력칸의 Esc 는 그 칸이 처리한다.
  const guarded = !!dirtyRef;
  const requestBackToList = useGuardedClose(guarded ? isDirty : undefined, onCancel);
  useBackLayer(guarded && active, requestBackToList);

  // 바이브 이미지 추가
  const handleVibeChange = async (vibe: string) => {
    if (!vibe) return;
    const path = await imageBackend.storeVibe(vibe);
    const newVibe = VibeItem.fromJSON({ path: path, info: 1.0, strength: 0.6 });
    setVibes((prev) => [...prev, newVibe]);
  };

  // 캐릭터 레퍼런스 이미지 추가
  const handleReferenceChange = async (reference: string) => {
    if (!reference) return;
    // 사용자가 원본을 직접 넣는 경로 — 원본 크기를 항목에 적는다.
    const stored = await imageBackend.storeReference(reference);
    const defaults = referenceDefaultsFor(globalModelVersion);
    const newRef = ReferenceItem.fromJSON({
      path: stored.path,
      info: 1.0,
      strength: defaults.strength,
      fidelity: defaults.fidelity,
      referenceType: defaults.referenceType,
      ...(stored.srcWidth && stored.srcHeight
        ? { srcWidth: stored.srcWidth, srcHeight: stored.srcHeight }
        : {}),
    }) as ReferenceItem;
    setCharacterReferences((prev) => [...prev, newRef]);
  };

  // 대표 이미지 업로드
  const handleRepImageUpload = async (base64: string) => {
    if (!base64) return;
    const path = await imageBackend.storeVibe(base64);
    setRepresentativeImage(path);
  };

  // 바이브 슬라이더 업데이트
  const updateVibeField = (index: number, field: 'info' | 'strength', value: number) => {
    setVibes((prev) => {
      const updated = [...prev];
      const vibe = VibeItem.fromJSON(updated[index].toJSON());
      vibe[field] = value;
      updated[index] = vibe;
      return updated;
    });
  };

  // 레퍼런스 슬라이더 업데이트
  const updateRefField = (index: number, field: string, value: any) => {
    setCharacterReferences((prev) => {
      const updated = [...prev];
      const ref = ReferenceItem.fromJSON(updated[index].toJSON());
      (ref as any)[field] = value;
      // 종류를 바꾸면 「같은 의상 선호」 명시 값을 지워 그 종류의 기본으로
      if (field === 'referenceType') ref.preferSameOutfit = undefined;
      updated[index] = ref;
      return updated;
    });
  };

  // 저장 핸들러
  const handleSave = () => {
    if (!name.trim()) {
      appState.pushMessage('프리셋 이름을 입력해주세요');
      return;
    }
    const newPreset = new CharacterPreset();
    newPreset.name = name;
    newPreset.characterPrompt = characterPrompt;
    newPreset.characterUC = characterUC;
    newPreset.backgroundPrompt = backgroundPrompt;
    newPreset.vibes = vibes;
    newPreset.characterReferences = characterReferences;
    newPreset.filenamePrefix = filenamePrefix;
    newPreset.filenameSuffix = filenameSuffix;
    newPreset.representativeImage = representativeImage;
    onSave(newPreset);
  };

  // 파일명 미리보기
  const getFilenamePreview = () => {
    const parts: string[] = [];
    if (filenamePrefix) parts.push(filenamePrefix);
    parts.push('씬이름');
    if (filenameSuffix) parts.push(filenameSuffix);
    return parts.join('_') + '.png';
  };

  // 바이브/레퍼런스에서 대표 이미지 선택 가능한 이미지 목록
  const selectableImages = useMemo(() => {
    const images: { path: string; type: 'vibe' | 'reference' }[] = [];
    vibes.forEach((v) => images.push({ path: v.path, type: 'vibe' }));
    characterReferences.forEach((r) => images.push({ path: r.path, type: 'reference' }));
    return images;
  }, [vibes, characterReferences]);

  // ── 화면 조각(2026-11-15 C-3) — inline 은 종전 순서 그대로, frame 은 캐릭터 프리셋 관리(PC) 전용 두 열 배치 ──
  // 상단 바 — 돌아가기만
  const backButton = (
        <button
          className="flex items-center gap-1.5 text-sm text-muted hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          onClick={requestBackToList}
        >
          <FaArrowLeft size={12} />
          돌아가기
        </button>
  );
  const backBar = (
      <div className="flex items-center mb-4">
        {backButton}
      </div>
  );

  // 프리셋 이름
  const nameSection = (
      <div className="mb-4">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">프리셋 이름 *</label>
        <input
          className="w-full px-3 py-2 rounded-lg border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--c-focus-ring)]"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="캐릭터 프리셋 이름"
        />
      </div>
  );

  const repImageSection = (
    <PresetMediaPanel title="대표 이미지" onUpload={handleRepImageUpload}
      footer={selectableImages.length > 0 && <details className="mt-3 text-sm text-muted">
        <summary className="cursor-pointer">바이브·레퍼런스에서 선택</summary>
        <div className="flex flex-wrap gap-2 mt-2">{selectableImages.map((item, index) => <button type="button" key={item.path + index} aria-label={`대표 이미지로 선택 ${index + 1}`} className="rounded overflow-hidden border line-color hover:border-sky-500" onClick={event => { setRepresentativeImage(item.path); event.currentTarget.closest('details')?.removeAttribute('open'); }}>
          <VibeImage path={item.type === 'vibe' ? imageBackend.vibePath(item.path) : imageBackend.referencePath(item.path)} className="w-14 h-14 object-cover" />
        </button>)}</div>
      </details>}>
      {representativeImage ? <RemovablePresetImage path={imageBackend.vibePath(representativeImage)} label="대표 이미지" imageClass="h-72" onRemove={() => setRepresentativeImage('')} /> : null}
    </PresetMediaPanel>
  );
  const promptSection = (
    <div className="mb-4 min-w-0">
      <div className="text-sm font-medium text-default mb-1">캐릭터 프롬프트</div>
      <div className={layout === 'frame' ? 'flex flex-col h-52 min-h-40' : 'flex flex-col min-h-20 max-h-40'} data-preset-prompt-box="prompt">
        <PromptEditTextArea className="flex-1 min-h-0" value={characterPrompt} onChange={setCharacterPrompt} disabled={false} />
      </div>
    </div>
  );
  const ucSection = (
    <div className="mb-4 min-w-0">
      <div className="text-sm font-medium text-default mb-1">캐릭터 네거티브 프롬프트</div>
      <div className="flex flex-col min-h-20 max-h-40" data-preset-prompt-box="uc">
        <PromptEditTextArea className="flex-1 min-h-0" value={characterUC} onChange={setCharacterUC} disabled={false} />
      </div>
    </div>
  );
  const legacyBgSection = backgroundPrompt && <div className="mb-4 border line-color rounded-lg p-3 text-sm text-muted">
    <div className="mb-1 font-medium">Legacy: 배경 프롬프트</div><div className="whitespace-pre-wrap break-words">{backgroundPrompt}</div>
  </div>;
  const vibeSection = (
    <PresetMediaPanel title="바이브 트랜스퍼" onUpload={handleVibeChange} multiple>
      {vibes.length ? <div className="space-y-3">{vibes.map((vibe, index) => <div key={vibe.path + index} className="min-w-0 space-y-2">
        <RemovablePresetImage path={imageBackend.vibePath(vibe.path)} label={`바이브 ${index + 1}`} onRemove={() => {
          if (representativeImage === vibe.path) setRepresentativeImage('');
          setVibes(previous => previous.filter((_, i) => i !== index));
        }} />
        <div className="text-xs text-muted">정보 추출률 (IS)</div>
        <div className="flex items-center gap-2"><input className="flex-1 min-w-0" type="range" min="0" max="1" step="0.01" value={vibe.info} aria-label={`바이브 ${index + 1} 정보 추출률`} onChange={e => updateVibeField(index, 'info', Number(e.target.value))} /><EditableSliderValue value={vibe.info} min={0} max={1} onChange={value => updateVibeField(index, 'info', value)} /></div>
        <div className="text-xs text-muted">레퍼런스 강도 (RS)</div>
        <div className="flex items-center gap-2"><input className="flex-1 min-w-0" type="range" min="0" max="1" step="0.01" value={vibe.strength} aria-label={`바이브 ${index + 1} 강도`} onChange={e => updateVibeField(index, 'strength', Number(e.target.value))} /><EditableSliderValue value={vibe.strength} min={0} max={1} onChange={value => updateVibeField(index, 'strength', value)} /></div>
      </div>)}</div> : null}
    </PresetMediaPanel>
  );
  const refSection = (
    <PresetMediaPanel title="캐릭터 레퍼런스" onUpload={handleReferenceChange} multiple>
      {characterReferences.length ? <div className="space-y-3">{characterReferences.map((ref, index) => <div key={ref.path + index} className="min-w-0 space-y-2">
        <RemovablePresetImage path={imageBackend.referencePath(ref.path)} label={`캐릭터 레퍼런스 ${index + 1}`} onRemove={() => {
          if (representativeImage === ref.path) setRepresentativeImage('');
          setCharacterReferences(previous => previous.filter((_, i) => i !== index));
        }} />
        <button type="button" className={'round-button h-8 px-3 text-xs ' + (ref.enabled !== false ? 'back-sky' : 'back-gray')} aria-pressed={ref.enabled !== false} onClick={() => updateRefField(index, 'enabled', ref.enabled === false)}>
          {ref.enabled !== false ? <FaToggleOn /> : <FaToggleOff />}<span className="ml-1">{ref.enabled !== false ? '활성화됨' : '비활성화됨'}</span>
        </button>
        {(['strength', ...(refSpec.showFidelity ? ['fidelity'] : [])] as ('strength' | 'fidelity')[]).map(field => <div key={field}>
          <div className="text-xs text-muted mb-1">{field === 'strength' ? 'Strength' : 'Fidelity'}</div>
          <div className="flex items-center gap-2">
            {field === 'strength' ? <ReferenceStrengthSlider value={ref.strength} max={refSpec.strengthMax} onChange={value => updateRefField(index, 'strength', value)} />
              : <input className="flex-1 min-w-0" type="range" min="0" max="2" step="0.01" value={ref.fidelity} aria-label={`레퍼런스 ${index + 1} fidelity`} onChange={e => updateRefField(index, 'fidelity', Number(e.target.value))} />}
            <EditableSliderValue value={ref[field]} min={0} max={field === 'strength' ? refSpec.strengthMax : 2} onChange={value => updateRefField(index, field, value)} />
          </div>
        </div>)}
        <ReferenceTypeControl type={ref.referenceType} preferSameOutfit={ref.preferSameOutfit} spec={refSpec}
          onTypeChange={type => updateRefField(index, 'referenceType', type)}
          onSameOutfitChange={checked => updateRefField(index, 'preferSameOutfit', checked)} />
        {showCostumeUnsupported(refSpec, ref.referenceType) && <div className="text-xs text-muted">{REFERENCE_EDITOR_TEXT.costumeUnsupported}</div>}
      </div>)}</div> : null}
    </PresetMediaPanel>
  );
  const filenameSection = (
    <section className="min-w-0 border line-color rounded-lg p-3 text-default" data-preset-filename-options="">
      <button type="button" className="w-full flex items-center justify-between gap-2 text-sm font-medium" aria-expanded={showFilenameOptions} onClick={() => setShowFilenameOptions(value => !value)}>파일명 옵션 <span>{showFilenameOptions ? '−' : '+'}</span></button>
      {showFilenameOptions && <div className="space-y-3 mt-3">
        <label className="block text-xs text-muted">파일명 접두사<input aria-label="파일명 접두사" className="gray-input w-full min-w-0 mt-1 px-2 py-1.5 text-sm" value={filenamePrefix} onChange={e => setFilenamePrefix(e.target.value)} /></label>
        <label className="block text-xs text-muted">파일명 접미사<input aria-label="파일명 접미사" className="gray-input w-full min-w-0 mt-1 px-2 py-1.5 text-sm" value={filenameSuffix} onChange={e => setFilenameSuffix(e.target.value)} /></label>
        <div className="text-xs text-muted break-all"><div className="mb-1">파일명 미리보기</div><code>{getFilenamePreview()}</code></div>
      </div>}
    </section>
  );

  // 하단 저장 버튼
  const saveBar = (
      <div className="flex gap-2 pt-2 border-t line-color">
        <button
          className={DIALOG_PRIMARY_BTN + ' flex-1'}
          onClick={handleSave}
        >
          <FaCheck className="inline mr-1.5" size={11} />
          {isNew ? '프리셋 추가' : '프리셋 저장'}
        </button>
        <button
          className={DIALOG_SECONDARY_BTN + ' flex-1'}
          onClick={requestBackToList}
        >
          취소
        </button>
      </div>
  );

  if (layout === 'inline') {
    return (
      <div className="flex flex-col text-default">
        {backBar}
        {nameSection}
        {repImageSection}
        {promptSection}
        {ucSection}
        {legacyBgSection}
        {vibeSection}
        {refSection}
        {filenameSection}
        {saveBar}
      </div>
    );
  }

  // Frame: one scrolling body, wide prompts, compact filename options and three media cards.
  return (
    <div className="h-full min-h-0 flex flex-col text-default" data-preset-editor-layout="frame">
      <div className="flex-none flex items-center px-5 py-3 border-b line-color">
        {backButton}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4" data-preset-editor-columns="">
        {nameSection}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_240px] gap-5">
          <div className="min-w-0" data-preset-editor-col="left">{promptSection}{ucSection}{legacyBgSection}</div>
          <div className="min-w-0" data-preset-editor-col="right">{filenameSection}</div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start mt-2" data-preset-media-row="">
          {repImageSection}{vibeSection}{refSection}
        </div>
      </div>
      <OverlayFooterBar>
        <button
          className={DIALOG_PRIMARY_BTN}
          onClick={handleSave}
          data-preset-editor-save=""
        >
          {isNew ? '프리셋 추가' : '프리셋 저장'}
        </button>
        <button
          className={DIALOG_SECONDARY_BTN}
          onClick={requestBackToList}
        >
          취소
        </button>
      </OverlayFooterBar>
    </div>
  );
});
