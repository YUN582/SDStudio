import { ReactNode, useEffect, useRef, useState } from 'react';
import { FaChevronLeft, FaChevronRight, FaImages } from 'react-icons/fa';
import { imageService, taskQueueService } from '../models';
import { appState } from '../models/AppService';
import { InpaintScene, Session } from '../models/types';
import { isTextEntryFocused } from '../models/keyTargetGuard';
import { hasOpenContextMenu } from './contextMenuBack';
import { ActionIcon } from './ActionIcon';

/** Result browsing never changes or unmounts the editing input, mask, or viewport. */
export default function InpaintResultPreview({
  session, scene, inputImage, active, onModeChange, children,
}: {
  session: Session;
  scene: InpaintScene;
  inputImage: string;
  active: boolean;
  onModeChange: (viewingResult: boolean) => void;
  children: ReactNode;
}) {
  const [paths, setPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>();
  const [loaded, setLoaded] = useState<{ path: string; image: string }>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const followResults = useRef(true);
  const viewingResult = showResults && paths.length > 0;

  useEffect(() => onModeChange(viewingResult), [viewingResult, onModeChange]);

  useEffect(() => {
    let cancelled = false;
    let scanRunning = false;
    let scanAgain = false;
    let followRequested = false;
    let known = new Set<string>();
    setShowResults(false);
    setLoaded(undefined);
    followResults.current = true;
    const matchesSession = (other: Session | undefined) => other === session ||
      !!(other && (session.id && other.id ? session.id === other.id : session.name === other.name));
    const sync = (allowFollow: boolean) => {
      if (cancelled) return;
      const names = [...imageService.getOutputs(session, scene)].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      const next = names.map(name => imageService.getOutputDir(session, scene) + '/' + name);
      const added = names.some(name => !known.has(name));
      known = new Set(names);
      const follow = allowFollow && added && followResults.current;
      setPaths(next);
      setSelected(current => follow || !current || !next.includes(current) ? next[next.length - 1] : current);
      if (follow) setShowResults(true);
    };
    // Serialize rescans from delegated generation completions, without touching the input files.
    const scan = async (allowFollow: boolean) => {
      followRequested ||= allowFollow;
      if (scanRunning) { scanAgain = true; return; }
      scanRunning = true;
      try {
        do {
          scanAgain = false;
          await imageService.refresh(session, scene, false);
          sync(followRequested);
          followRequested = false;
        } while (scanAgain && !cancelled);
      } catch { /* Keep usable results if the output folder is temporarily unavailable. */ }
      finally { scanRunning = false; }
    };
    const added = (event: Event) => {
      const d = (event as CustomEvent).detail;
      if (matchesSession(d?.session) && d.sceneType === 'inpaint' && d.sceneName === scene.name) sync(true);
    };
    const updated = (event: Event) => {
      const d = (event as CustomEvent).detail;
      if (d?.session && !matchesSession(d.session)) return;
      if (d?.scene && d.scene !== scene && (d.scene.type !== 'inpaint' || d.scene.name !== scene.name)) return;
      sync(true);
    };
    const completed = () => { void scan(true); };
    sync(false);
    void scan(false);
    imageService.addEventListener('image-added', added);
    imageService.addEventListener('updated', updated);
    taskQueueService.addEventListener('complete', completed);
    return () => {
      cancelled = true;
      imageService.removeEventListener('image-added', added);
      imageService.removeEventListener('updated', updated);
      taskQueueService.removeEventListener('complete', completed);
    };
  }, [session, scene]);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (!selected) { setLoaded(undefined); return; }
    imageService.fetchImage(selected).then(image => {
      if (cancelled) return;
      if (image) setLoaded({ path: selected, image });
      else setError(true);
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [selected, retry]);

  const index = selected ? paths.indexOf(selected) : -1;
  const navigate = (direction: number) => {
    const next = paths[Math.max(0, Math.min(paths.length - 1, index + direction))];
    if (next) setSelected(next);
  };
  useEffect(() => {
    if (!active || !viewingResult) return;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          isTextEntryFocused() || appState.dialogs.length || appState.modalOverlayCount || appState.configScreenOpen || hasOpenContextMenu()) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      navigate(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, viewingResult, paths, index]);

  return <div className="sds-inpaint-preview" data-inpaint-preview="">
    <div className="sds-inpaint-input" data-result-hidden={viewingResult || undefined} aria-hidden={viewingResult}>
      {children}
    </div>
    {viewingResult && <div className="sds-inpaint-results" data-inpaint-results="" aria-label="생성 결과" aria-busy={!error && loaded?.path !== selected}>
      {error ? <div className="text-sm text-sub text-center">
        <p>결과 이미지를 불러오지 못했습니다.</p>
        <button className="round-button back-gray mt-2" onClick={() => setRetry(value => value + 1)}>다시 불러오기</button>
      </div> : loaded ? <img className="sds-inpaint-result-image" src={loaded.image} alt="생성 결과" draggable={false} /> : <span className="text-sm text-sub">이미지 불러오는 중…</span>}
      {paths.length > 1 && <>
        <button type="button" className="sds-inpaint-result-prev round-button back-gray disabled:opacity-30" aria-label="이전 결과 이미지" title="이전 이미지 ←" disabled={index <= 0} onClick={() => navigate(-1)}><FaChevronLeft size={16} /></button>
        <button type="button" className="sds-inpaint-result-next round-button back-gray disabled:opacity-30" aria-label="다음 결과 이미지" title="다음 이미지 →" disabled={index >= paths.length - 1} onClick={() => navigate(1)}><FaChevronRight size={16} /></button>
      </>}
      <span className="sds-inpaint-result-count">{index + 1} / {paths.length}</span>
    </div>}
    {paths.length > 0 && inputImage && <button type="button" className="sds-inpaint-preview-switch"
      aria-label={viewingResult ? '원본 이미지 편집' : '생성 결과 보기'}
      title={viewingResult ? '원본 이미지 편집' : '생성 결과 보기'}
      onClick={() => {
        followResults.current = !viewingResult;
        if (!viewingResult) setSelected(paths[paths.length - 1]);
        setShowResults(!viewingResult);
      }}>
      <img src={viewingResult ? inputImage : loaded?.image} alt="" draggable={false} />
      <span>{viewingResult ? <><ActionIcon id="edit" size={11} /> 원본</> : <><FaImages size={11} /> 결과</>}</span>
    </button>}
  </div>;
}
