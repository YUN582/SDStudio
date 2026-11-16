import React, { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { gameService, imageService } from '../models';
import { appState } from '../models/AppService';
import { getMainImage } from '../models/ImageService';
import { platform } from '../models/platform';
import { combinationCount } from '../models/PromptService';
import { linkedImageVariants } from '../models/sceneImageVariants';
import { mergeSelectedScenes } from '../models/sceneMerge';
import { mergeSceneSettingsDiffer, type SceneMergeMode } from '../models/sceneMergeCombinations';
import type { Scene, Session } from '../models/types';
import ModalOverlay from './ModalOverlay';

export type SceneMergeRequest = { session: Session; selected?: readonly Scene[] };

function SceneMergeCard({ session, scene, pressed, onClick }: {
  session: Session;
  scene: Scene;
  pressed: boolean;
  onClick: () => void;
}) {
  const [image, setImage] = useState<string>();
  const variantOutputs = linkedImageVariants(scene, session.inpaints.values()).flatMap((owner) =>
    gameService.getOutputs(session, owner).map((name) => ({ owner, name })),
  );
  const imageCount = gameService.getOutputs(session, scene).length + variantOutputs.length;
  const fallback = variantOutputs[0];
  const fallbackPath = fallback && imageService.getOutputDir(session, fallback.owner) + '/' + fallback.name;
  useEffect(() => {
    let active = true;
    async function load() {
      const own = await getMainImage(session, scene, platform.sceneThumbSize);
      const preview = own ?? (fallbackPath && await imageService.fetchImageSmall(fallbackPath, platform.sceneThumbSize));
      if (active) setImage(preview || undefined);
    }
    void load().catch(() => { if (active) setImage(undefined); });
    return () => { active = false; };
  }, [session, scene, fallbackPath, imageCount]);
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick}
      className={`min-w-0 text-left rounded-lg border overflow-hidden clickable bg-[var(--c-surface-2)] ${pressed ? 'border-sky-500 ring-1 ring-sky-500' : 'line-color'}`}>
      <div className="aspect-[4/3] bg-[var(--c-zone)]">
        {image && <img alt="" draggable={false} src={image} className="w-full h-full object-cover" />}
      </div>
      <div className="flex items-start gap-2 p-2 text-sm text-default">
        <span className="flex-1 min-w-0 break-words">{scene.name}</span>
        <span className="flex-none text-faint tabular-nums">{imageCount}장</span>
      </div>
    </button>
  );
}

const SceneMergeForm = observer(function SceneMergeForm({ request }: { request: SceneMergeRequest }) {
  const { session } = request;
  const [selected, setSelected] = useState<Scene[]>(() => [...(request.selected ?? [])]);
  const [picking, setPicking] = useState(request.selected === undefined);
  const [target, setTarget] = useState<Scene>();
  const [mode, setMode] = useState<SceneMergeMode>('combine');
  const [overwrite, setOverwrite] = useState<Scene>();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [, refresh] = useState(0);
  const running = useRef(false);
  useEffect(() => {
    const onUpdate = () => refresh((value) => value + 1);
    gameService.addEventListener('updated', onUpdate);
    return () => gameService.removeEventListener('updated', onUpdate);
  }, []);
  const sources = selected.filter((scene) => scene !== target);
  const cards = picking ? [...session.scenes.values()].filter((scene) =>
    scene.name.toLowerCase().includes(query.trim().toLowerCase()),
  ) : selected;
  const count = mode === 'combine' ? selected.reduce((total, scene) => total + combinationCount(scene), 0)
    : overwrite ? combinationCount(overwrite) : 0;
  const imageCount = selected.reduce((total, scene) => total + gameService.getOutputs(session, scene).length +
    linkedImageVariants(scene, session.inpaints.values()).reduce((n, variant) => n + gameService.getOutputs(session, variant).length, 0), 0);
  const conflicts = target && sources.some((source) => mergeSceneSettingsDiffer(target, source));
  const close = () => { if (!running.current) appState.sceneMergeRequest = undefined; };
  const commit = async () => {
    if (running.current || !target || (mode === 'overwrite' && !overwrite)) return;
    if (appState.curSession !== session) {
      setError('열려 있는 프로젝트가 변경됐습니다. 씬을 다시 선택해 주세요.');
      return;
    }
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await mergeSelectedScenes(session, selected, target, mode === 'overwrite' ? overwrite : undefined);
      appState.clearSceneSelection();
      appState.sceneSelectionMode = false;
      appState.sceneMergeRequest = undefined;
      appState.pushMessage(`“${target.name}”에 씬 ${sources.length}개를 합쳤어요. 이미지 ${result.movedCount}장 · 변형 작업 ${result.variantCount}개 이동`);
      if (result.refreshFailed) appState.pushMessage('병합은 저장됐어요. 북마크나 목록을 불러오는 데 실패했다면 프로젝트를 다시 열어 주세요.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <ModalOverlay isOpen title="씬 합치기" size="m" onClose={close}
      footer={<>
        {picking ? (
          <button type="button" className="round-button back-sky" disabled={selected.length < 2}
            onClick={() => { setPicking(false); setError(''); }}>다음</button>
        ) : (
          <button type="button" className="round-button back-sky"
            disabled={busy || !target || (mode === 'overwrite' && !overwrite)} onClick={() => void commit()}>
            {busy ? '합치는 중…' : '씬 합치기'}
          </button>
        )}
        {!picking && !request.selected && (
          <button type="button" className="round-button back-gray" disabled={busy}
            onClick={() => { setPicking(true); setTarget(undefined); setError(''); }}>이전</button>
        )}
        <button type="button" className="round-button back-gray" disabled={busy} onClick={close}>취소</button>
      </>}>
      <div className="space-y-4">
        {picking && (
          <input aria-label="씬 이름 검색" placeholder="씬 이름 검색…" className="gray-input w-full px-2 py-1"
            value={query} onChange={(event) => setQuery(event.target.value)} />
        )}
        <fieldset disabled={busy} className="min-w-0">
          <legend className="mb-2 font-semibold text-default">
            {picking ? `합칠 씬 선택 (${selected.length}개)` : '남길 씬'}
          </legend>
          <div className="grid gap-2 overflow-auto p-1"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(7rem, 1fr))', maxHeight: '24rem' }}>
            {cards.map((scene) => (
              <SceneMergeCard key={scene.name} session={session} scene={scene}
                pressed={picking ? selected.includes(scene) : target === scene}
                onClick={() => {
                  if (picking) {
                    setSelected((current) => current.includes(scene) ? current.filter((item) => item !== scene) : [...current, scene]);
                  } else {
                    setTarget(scene);
                    setOverwrite(selected.find((item) => item !== scene));
                    setError('');
                  }
                }} />
            ))}
          </div>
        </fieldset>
        {!picking && target && (
          <>
            <fieldset disabled={busy} className="space-y-2">
              <legend className="mb-2 font-semibold text-default">생성 조합</legend>
              <div className="flex flex-wrap gap-4 text-default">
                <label className="flex items-center gap-2"><input type="radio" name="scene-merge-mode" checked={mode === 'combine'}
                  onChange={() => { setMode('combine'); setError(''); }} />조합 합치기</label>
                <label className="flex items-center gap-2"><input type="radio" name="scene-merge-mode" checked={mode === 'overwrite'}
                  onChange={() => { setMode('overwrite'); setError(''); }} />조합 덮어쓰기</label>
              </div>
              {mode === 'overwrite' && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-sub">가져올 조합</span>
                  {sources.map((scene) => (
                    <button key={scene.name} type="button" aria-pressed={overwrite === scene}
                      className={`round-button ${overwrite === scene ? 'back-sky' : 'back-gray'}`}
                      onClick={() => setOverwrite(scene)}>{scene.name}</button>
                  ))}
                </div>
              )}
            </fieldset>
            <div className="rounded-lg bg-[var(--c-surface-2)] p-3 text-sm text-sub space-y-1" aria-live="polite">
              <p className="font-semibold text-default">
                {target.name}에 씬 {sources.length}개 합치기 · 이미지 {imageCount}장 · 생성 후보 {count}개
              </p>
              {conflicts && <p>해상도, 시드, 씬 전용 프롬프트 등 서로 다른 씬 설정은 “{target.name}”의 값을 사용해요.</p>}
              {mode === 'overwrite' && overwrite && <p>“{overwrite.name}”의 조합으로 교체해요.</p>}
              <p>합쳐지는 씬은 목록에서 사라져요. 합치기 전 데이터는 백업에 보관해요.</p>
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-400 break-words" role="alert">{error}</p>}
      </div>
    </ModalOverlay>
  );
});

export default observer(function SceneMergeDialog() {
  const request = appState.sceneMergeRequest;
  return request ? <SceneMergeForm request={request} /> : null;
});
