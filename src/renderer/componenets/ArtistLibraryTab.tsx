import { EmptyState } from './EmptyState';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Buffer } from 'buffer';
import {
  FaPlus,
  FaHeart,
  FaRegHeart,
  FaCopy,
  FaTrash,
  FaImage,
  FaFileAlt,
  FaPen,
  FaFileArchive,
  FaFileImport,
  FaCheck,
  FaCheckSquare,
  FaGlobe,
  FaCompressArrowsAlt,
  FaMagic,
  FaTimes,
} from 'react-icons/fa';
import { GridSearchBar, GridToolbarGroup, LibraryAction, LibraryToolbar } from './GridToolbar';
import { useLibraryGridSelection } from './LibraryGridSelection';
import { focusGridSurface, gridCardUsesSelection } from '../models/gridSelection';
import { Menu, Item, Separator, useContextMenu } from 'react-contexify';
import { contextMenuBackLayer } from './contextMenuBack';
import { ActionIcon } from './ActionIcon';
import { LIBRARY_CARD_SELECTED, LibraryCardHover, LibraryCardSelection } from './LibraryCardVisuals';
import { queueArtistSample } from '../models/sceneQueueActions';
import { artistLibraryService, imageService, backend, isMobile } from '../models';
import { IArtistEntry, IArtistImage } from '../models/ArtistLibraryService';
import { ModelBaseFamily } from '../models/modelSamplingProfiles';
import { appState } from '../models/AppService';
import {
  addArtistTagPresetRecorded,
  addArtistTagRecorded,
  removeArtistTagPresetRecorded,
  removeArtistTagRecorded,
  renameArtistRecorded,
  setArtistImageFamilyRecorded,
  setArtistThumbnailRecorded,
  toggleArtistFavoriteRecorded,
  setArtistsFavoriteRecorded,
} from '../models/globalLibraryUndo';
import { promptName } from '../models/nameInput';
import {
  batchResultLine,
  deleteConfirmText,
  failedNamesLine,
} from '../models/deleteFlowRules';

// 작가 삭제 확인 창의 덧붙임 줄 — 단건·여러 명 공통
const ARTIST_DELETE_EXTRA = '첨부된 이미지도 함께 삭제됩니다.';
import { dataUriToBase64 } from '../models/ImageService';
import { extractPromptDataFromBase64 } from '../models/util';
import { IMPORT_IMAGE_ACCEPT } from '../models/imageFormats';
import Tooltip from './Tooltip';
import ModalOverlay from './ModalOverlay';

// ─── 모델 계열 보기(2026-09-26): 같은 작가라도 v4.5/v5 의 학습 여부·출력 화풍이 달라 구분한다 ───
type FamilyView = 'all' | ModelBaseFamily;
const FAMILY_VIEW_KEY = 'sdstudio-artist-lib-family';
const FAMILY_LABEL: Record<ModelBaseFamily, string> = { v4_5: 'v4.5', v5: 'v5' };
const loadFamilyView = (): FamilyView => {
  try {
    const v = localStorage.getItem(FAMILY_VIEW_KEY);
    return v === 'v4_5' || v === 'v5' ? v : 'all';
  } catch (e) {
    return 'all';
  }
};
const saveFamilyView = (v: FamilyView) => {
  try {
    localStorage.setItem(FAMILY_VIEW_KEY, v);
  } catch (e) {
    /* 무시 */
  }
};
/** 보기 계열에 맞는 이미지들(전체 보기면 전부). */
const imagesFor = (artist: IArtistEntry, view: FamilyView): IArtistImage[] =>
  view === 'all' ? artist.images : artist.images.filter((i) => i.family === view);
/** 썸네일 구석의 계열 배지. 미지정은 표시하지 않는다. */
const FamilyBadge = ({ family, className }: { family?: ModelBaseFamily; className?: string }) =>
  family ? (
    <span className={'pointer-events-none text-[11px] leading-none px-1 py-0.5 rounded bg-black/60 text-white ' + (className || '')}>
      {FAMILY_LABEL[family]}
    </span>
  ) : null;

const copyText = async (text: string, msg: string) => {
  try {
    await navigator.clipboard.writeText(text);
    appState.pushMessage(msg);
  } catch (e) {
    appState.pushMessage('복사 실패');
  }
};

const fileToBase64 = async (file: File): Promise<string> => {
  const buf = await file.arrayBuffer();
  return Buffer.from(buf).toString('base64');
};

// ─── 이미지 표시 ───
// fit: 기본 'cover'(카드·썸네일). 작가 상세 PC 큰 이미지만 'contain'(창 높이를 채우되 잘리지 않게, 2026-11-15 C-1)
const ArtistImage = observer(
  ({
    path,
    className,
    onClick,
    fit = 'cover',
  }: {
    path: string;
    className?: string;
    onClick?: () => void;
    fit?: 'cover' | 'contain';
  }) => {
    const [image, setImage] = useState<string | null>(null);
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const data = await imageService.fetchImage(path);
          if (!cancelled) setImage(data);
        } catch (e) {
          if (!cancelled) setImage(null);
        }
      })();
      return () => { cancelled = true; };
    }, [path]);
    if (image) {
      return <img className={(className || '') + (fit === 'contain' ? ' object-contain' : ' object-cover')} src={image} draggable={false} onClick={onClick} />;
    }
    return (
      <div className={(className || '') + ' flex items-center justify-center bg-[var(--c-surface)]'} onClick={onClick}>
        <FaImage className="text-faint" />
      </div>
    );
  },
);

// ─── 태그 프리셋 관리 ───
const TagPresetManageModal = observer(({ onClose }: { onClose: () => void }) => {
  const [input, setInput] = useState('');
  // 공백뿐이면 [추가] 비활성·Enter 무시, 이미 있는 태그면 안내 후 입력 유지(2026-11-15). 판정 = 추가 전후 목록 길이
  // (태그 정규화 규칙은 서비스 한 곳 — 여기서 다시 만들지 않는다)
  const blank = !input.trim();
  const add = () => {
    if (blank) return;
    const before = artistLibraryService.tagPresets.length;
    addArtistTagPresetRecorded(input);
    if (artistLibraryService.tagPresets.length === before) {
      appState.pushMessage('이미 있는 태그 프리셋입니다.');
      return;
    }
    setInput('');
  };
  return (
    <ModalOverlay isOpen={true} onClose={onClose} title="태그 프리셋 관리" size="s">
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            className="flex-1 gray-input text-sm"
            placeholder="새 태그 (예: 러프)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }}
          />
          <button className="back-sky !rounded-md px-3 py-1.5 text-sm disabled:opacity-50" disabled={blank} onClick={add} data-tag-preset-add="">추가</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {artistLibraryService.tagPresets.length === 0 && (
            <span className="text-sm text-faint">프리셋이 없습니다.</span>
          )}
          {artistLibraryService.tagPresets.map((t) => (
            <span key={t} className="flex items-center gap-1 text-sm px-2 py-1 rounded-md bg-[var(--c-surface)] text-body">
              {t}
              <Tooltip content={`태그 프리셋 ${t} 삭제`}>
                <button className="text-muted hover:text-red-500" aria-label={`태그 프리셋 ${t} 삭제`} onClick={() => removeArtistTagPresetRecorded(t)}>
                  <FaTrash size={14} />
                </button>
              </Tooltip>
            </span>
          ))}
        </div>
      </div>
    </ModalOverlay>
  );
});

// ─── 프롬프트 보기 ───
// 읽기 전용 표시 상자는 높이 상한·안쪽 스크롤 없이 글자만큼 자란다 — 창의 스크롤 하나(PC = 작가 상세 오른쪽 열,
// 모바일 = 본문)가 맡는다(2026-11-15 C-1, SPEC 「높이 규칙 우선순위」 허용 (3)).
const PromptView = observer(({ path }: { path: string }) => {
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [uc, setUc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPrompt(null);
      setUc(null);
      try {
        const dataUri = await backend.readDataFile(path);
        const base64 = dataUriToBase64(dataUri);
        const job = await extractPromptDataFromBase64(base64);
        if (!cancelled) {
          setPrompt(job?.prompt ?? null);
          setUc(job?.uc ?? null);
        }
      } catch (e) {
        if (!cancelled) { setPrompt(null); setUc(null); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path]);

  if (loading) return <div className="text-xs text-faint py-2">프롬프트 추출 중...</div>;
  if (!prompt && !uc) return <div className="text-xs text-faint py-2">이 이미지에서 프롬프트 메타데이터를 찾지 못했습니다.</div>;
  return (
    <div className="flex flex-col gap-2 mt-2">
      {prompt && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted">프롬프트</span>
            <button className="text-xs btn-link" onClick={() => copyText(prompt, '프롬프트를 복사했습니다')}>
              <FaCopy className="inline mr-1" size={10} />복사
            </button>
          </div>
          <div className="text-xs p-2 rounded bg-[var(--c-surface)] text-default break-words" data-artist-prompt-text="">{prompt}</div>
        </div>
      )}
      {uc && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted">네거티브</span>
            <button className="text-xs btn-link" onClick={() => copyText(uc, '네거티브를 복사했습니다')}>
              <FaCopy className="inline mr-1" size={10} />복사
            </button>
          </div>
          <div className="text-xs p-2 rounded bg-[var(--c-surface)] text-default break-words" data-artist-uc-text="">{uc}</div>
        </div>
      )}
    </div>
  );
});

// ─── 카드 상세 모달 ───
export const ArtistDetailModal = observer(({ artistId, onClose }: { artistId: string; onClose: () => void }) => {
  const artist = artistLibraryService.getArtist(artistId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [managePreset, setManagePreset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!artist) { onClose(); return null; }

  const selected: IArtistImage | undefined =
    artist.images.find((i) => i.id === selectedId) || artist.images[0];

  const addImages = async (files: FileList) => {
    for (let i = 0; i < files.length; i++) {
      const b64 = await fileToBase64(files[i]);
      await artistLibraryService.addImage(artist.id, b64);
    }
  };

  return (
    <>
      {/* 작가 상세(2026-11-12 오버레이 묶음 A → 2026-11-15 C-1): l 등급(고정 높이) 두 열. 작가 태그+동작 줄(복사·이름 변경·
          즐겨찾기·삭제)은 도구줄(toolbar) 슬롯 — 본문 스크롤 밖에 고정. 모바일(md 미만)은 태그가 한 줄 전체를 쓰고 버튼은 다음 줄(2026-10-02 I1).
          PC 본문은 스크롤하지 않는다(h-full min-h-0): 왼쪽 = 이미지가 남은 높이를 채움(스크롤 없음), 오른쪽 = 이 창의 유일한
          세로 스크롤(태그·태그 프리셋·이 이미지의 프롬프트). 모바일 = 한 열, 본문 스크롤 하나(SPEC 「높이 규칙 우선순위」) */}
      <ModalOverlay
        isOpen={true}
        onClose={onClose}
        title={artist.name}
        size="l"
        toolbar={
          <div className="w-full flex flex-wrap md:flex-nowrap items-center justify-end gap-2" data-artist-detail-actions="">
            <span className="basis-full md:basis-auto flex-1 min-w-0 text-sm font-mono px-2 py-1.5 rounded bg-[var(--c-surface)] text-default truncate" title={'artist:' + artist.name}>artist:{artist.name}</span>
            <button className="back-sky !rounded-md px-3 py-1.5 text-sm" onClick={() => copyText('artist:' + artist.name, '작가 태그를 복사했습니다')}>
              <FaCopy className="inline mr-1" size={12} />복사
            </button>
            <Tooltip content="작가 이름 변경">
              <button
                className="icon-button back-gray !rounded-md p-2"
                onClick={async () => {
                  // 현재 이름을 채워 연다 — 다른 작가와 같은 이름(대소문자·공백 무시)은 창 안에서 거부(D2)
                  const newName = await promptName({
                    title: `새 작가 이름을 입력하세요 (현재: ${artist.name})`,
                    kind: 'artist',
                    current: artist.name,
                    existing: (n) => !!artistLibraryService.findArtistByName(n, artist.id),
                  });
                  if (newName) {
                    renameArtistRecorded(artist.id, newName);
                  }
                }}
              >
                <FaPen />
              </button>
            </Tooltip>
            <Tooltip content="즐겨찾기">
              <button className="icon-button back-gray !rounded-md p-2" onClick={() => toggleArtistFavoriteRecorded(artist.id)}>
                {artist.favorite ? <FaHeart className="text-red-500" /> : <FaRegHeart />}
              </button>
            </Tooltip>
            <Tooltip content="작가 삭제">
            <button
              className="icon-button btn-solid-red !rounded-md p-2"
              onClick={() => {
                appState.pushDialog({
                  type: 'confirm',
                  // 휴지통이 없다 — 영구 삭제(Enter 무시, 2026-10-03 E1)
                  ...deleteConfirmText({
                    kind: 'artist',
                    name: artist.name,
                    outcome: 'permanent',
                    extra: ARTIST_DELETE_EXTRA,
                  }),
                  callback: () => {
                    artistLibraryService.deleteArtist(artist.id);
                    onClose();
                  },
                });
              }}
            >
              <FaTrash />
            </button>
            </Tooltip>
          </div>
        }
      >
        <div
          className={isMobile ? 'flex flex-col gap-4' : 'h-full min-h-0 flex gap-4'}
          data-artist-detail-body=""
        >
          {/* 좌: 이미지(PC 는 스크롤 없음 — 큰 이미지가 남은 높이를 채우고 썸네일은 가로 띠 한 줄) */}
          <div
            className={isMobile ? 'min-w-0 flex flex-col' : 'flex-1 min-w-0 min-h-0 flex flex-col'}
            data-artist-detail-left=""
          >
            <div
              className={
                (isMobile ? 'w-full aspect-[3/4]' : 'w-full flex-1 min-h-0') +
                ' rounded-lg overflow-hidden bg-[var(--c-surface)] flex items-center justify-center'
              }
              data-artist-detail-image=""
            >
              {selected ? (
                <ArtistImage path={selected.path} className="w-full h-full" fit={isMobile ? 'cover' : 'contain'} />
              ) : (
                <div className="text-faint text-sm">이미지가 없습니다</div>
              )}
            </div>
            {/* 썸네일 스트립 — PC 는 한 줄 가로 스크롤(세로 중첩 아님), 모바일은 종전 줄바꿈 */}
            <div
              className={
                isMobile
                  ? 'flex flex-wrap gap-2 mt-2'
                  : 'flex-none flex flex-nowrap overflow-x-auto gap-2 mt-2 pb-1'
              }
              data-artist-detail-thumbs=""
            >
              {artist.images.map((img) => (
                <div key={img.id} className={'relative flex-none w-14 h-14 rounded overflow-hidden cursor-pointer border-2 ' + (selected?.id === img.id ? 'border-sky-500' : 'border-transparent')}>
                  <ArtistImage path={img.path} className="w-full h-full" onClick={() => { setSelectedId(img.id); setShowPrompt(false); }} />
                  <FamilyBadge family={img.family} className="absolute left-0.5 bottom-0.5" />
                </div>
              ))}
              <Tooltip content="이미지 추가">
                <button className="add-slot flex-none w-14 h-14 flex items-center justify-center"
                  aria-label="이미지 추가"
                  onClick={() => fileRef.current?.click()}>
                  <FaPlus />
                </button>
              </Tooltip>
              {/* 샘플 생성(2026-09-26): 현재 프리셋에서 다른 작가 태그를 빼고 이 작가만으로 1장 생성해 카드에 저장 */}
              <Tooltip content="현재 프리셋에서 다른 artist: 태그를 빼고 이 작가만으로 1장 생성해 카드에 저장">
                <button
                  className="add-slot flex-none w-14 h-14 flex flex-col items-center justify-center gap-0.5 disabled:opacity-50"
                  disabled={!appState.curSession}
                  data-artist-sample-generate=""
                  onClick={() => {
                    if (!appState.curSession) {
                      appState.pushMessage('프로젝트를 먼저 여세요.');
                      return;
                    }
                    queueArtistSample(appState.curSession, artist.id, artist.name);
                  }}
                >
                  <FaMagic />
                  <span className="text-[11px] leading-none">샘플 생성</span>
                </button>
              </Tooltip>
              <input type="file" accept={IMPORT_IMAGE_ACCEPT} multiple ref={fileRef} className="hidden"
                onChange={(e) => { if (e.target.files) addImages(e.target.files); e.target.value = ''; }} />
            </div>
            {selected && (
              <div className="flex-none flex items-center gap-1.5 mt-2 text-xs">
                <span className="text-muted mr-1">모델 계열</span>
                {(['v4_5', 'v5'] as ModelBaseFamily[]).map((f) => (
                  <button
                    key={f}
                    className={'px-2 py-0.5 rounded-full border ' + (selected.family === f ? 'border-sky-500 text-[color:var(--c-link)] bg-sky-100 dark:bg-sky-900/40' : 'line-color text-muted hover:border-sky-400')}
                    onClick={() => setArtistImageFamilyRecorded(artist.id, selected.id, selected.family === f ? undefined : f)}
                    title="이 샘플이 나온 모델 계열(다시 누르면 미지정)"
                  >
                    {FAMILY_LABEL[f]}
                  </button>
                ))}
                {!selected.family && <span className="text-faint">미지정 — 메타데이터에서 못 읽음</span>}
              </div>
            )}
            {selected && (
              <div className="flex-none flex gap-2 mt-2" data-artist-detail-image-actions="">
                {artist.images[0]?.id !== selected.id && (
                  <button className="text-xs back-gray !rounded-md px-2 py-1" onClick={() => setArtistThumbnailRecorded(artist.id, selected.id)}>
                    <ActionIcon id="pin-default" className="inline mr-1" size={10} />대표로 지정
                  </button>
                )}
                <button
                  className="text-xs icon-button btn-solid-red !rounded-md px-2 py-1"
                  onClick={() => {
                    // 샘플 이미지 파일을 영구 삭제하므로 확인 1회(X11)
                    const imageId = selected.id;
                    appState.pushDialog({
                      type: 'confirm',
                      ...deleteConfirmText({ kind: 'sampleImage', outcome: 'permanent' }),
                      callback: async () => {
                        await artistLibraryService.removeImage(artist.id, imageId);
                        setSelectedId(null);
                        setShowPrompt(false);
                      },
                    });
                  }}
                >
                  <FaTrash className="inline mr-1" size={10} />이미지 삭제
                </button>
              </div>
            )}
          </div>

          {/* 우: 태그 → 태그 프리셋 → 이 이미지의 프롬프트(PC = 이 창의 유일한 세로 스크롤) */}
          <div
            className={isMobile ? 'min-w-0' : 'flex-1 min-w-0 min-h-0 overflow-y-auto pr-1'}
            data-artist-detail-right=""
          >
            <div className="text-xs text-muted mb-1">태그</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {artist.tags.length === 0 && <span className="text-xs text-faint">태그 없음</span>}
              {artist.tags.map((t) => (
                <span key={t} className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300">
                  {t}
                  <button className="hover:text-red-500" aria-label={`태그 ${t} 삭제`} onClick={() => removeArtistTagRecorded(artist.id, t)}><FaTimes size={10} className="block" /></button>
                </span>
              ))}
            </div>
            <input
              className="w-full gray-input text-sm mb-3"
              placeholder="태그 추가 후 Enter (예: 러프)"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { addArtistTagRecorded(artist.id, tagInput); setTagInput(''); } }}
            />
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted">태그 프리셋 (클릭해서 추가)</span>
              <button className="text-xs btn-link" onClick={() => setManagePreset(true)}>
                <ActionIcon id="edit" className="inline mr-1" size={9} />관리
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {artistLibraryService.tagPresets.length === 0 && (
                <span className="text-xs text-faint">프리셋 없음 — "관리"에서 추가</span>
              )}
              {artistLibraryService.tagPresets.map((t) => {
                const has = artist.tags.includes(t);
                return (
                  <button key={t} disabled={has}
                    className={'text-xs px-2.5 py-1 rounded-full border ' + (has ? 'line-color text-faint' : 'line-color text-muted hover:border-sky-500 hover:text-sky-500')}
                    onClick={() => addArtistTagRecorded(artist.id, t)}>
                    {/* 이미 추가된 태그는 색 말고도 체크 아이콘으로 구분(UI 정돈 그룹 1) — 「+」 자리에 체크 */}
                    {has ? <FaCheck size={10} className="inline mr-1 align-[-1px]" aria-hidden="true" /> : '+ '}{t}
                  </button>
                );
              })}
            </div>
            {selected && (
              <div className="mt-4 pt-3 border-t line-color" data-artist-detail-prompt-section="">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">이 이미지의 프롬프트</span>
                  <button
                    className="text-xs back-gray !rounded-md px-2 py-1"
                    data-artist-prompt-toggle=""
                    onClick={() => setShowPrompt((v) => !v)}
                  >
                    <FaFileAlt className="inline mr-1" size={10} />{showPrompt ? '프롬프트 닫기' : '프롬프트 보기'}
                  </button>
                </div>
                {showPrompt && <PromptView path={selected.path} />}
              </div>
            )}
          </div>
        </div>
      </ModalOverlay>
      {managePreset && <TagPresetManageModal onClose={() => setManagePreset(false)} />}
    </>
  );
});

// ─── 카드 ───
const ArtistCard = observer(({
  artist,
  onOpen,
  multiSelectMode,
  selected,
  onToggleSelect,
  familyView,
  onContextMenu,
}: {
  artist: IArtistEntry;
  onOpen: () => void;
  multiSelectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  familyView: FamilyView;
  onContextMenu: (event: React.MouseEvent) => void;
}) => {
  // 계열 보기면 그 계열의 첫 이미지가 대표(없으면 "샘플 없음"), 전체 보기면 대표 썸네일(images[0])
  const shown = imagesFor(artist, familyView);
  const thumb = shown[0];
  const handleClick = (event: React.MouseEvent) => {
    if (!isMobile && gridCardUsesSelection(event)) return;
    if (isMobile && multiSelectMode) onToggleSelect(); else onOpen();
  };
  return (
    <div data-artist-id={artist.id} data-library-selected={selected ? 'true' : 'false'} onContextMenu={onContextMenu} className={
      'group relative flex-none w-[calc(50%-8px)] md:w-60 rounded-lg overflow-hidden flex flex-col border-2 bg-[var(--c-surface-2)] ' +
      (selected
        ? LIBRARY_CARD_SELECTED
        : 'line-color hover:border-sky-400')
    }>
      {/* 대표 이미지 */}
      <div className="relative w-full aspect-[3/4] md:aspect-auto md:h-72 bg-[var(--c-surface)] cursor-pointer" data-library-card-activate="" title={artist.name + ' · 상세·수정 열기'} onClick={handleClick}>
        {thumb ? (
          <ArtistImage path={thumb.path} className="w-full h-full" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-faint">
            <FaImage size={30} />
            {familyView !== 'all' && artist.images.length > 0 && (
              <span className="text-xs">{FAMILY_LABEL[familyView]} 샘플 없음</span>
            )}
          </div>
        )}
        {shown.length > 0 && (
          <span className="absolute bottom-2 right-2 z-10 text-xs bg-black/60 text-white rounded-md px-2 py-0.5 pointer-events-none">
            {familyView === 'all' ? `${shown.length}장` : `${FAMILY_LABEL[familyView]} ${shown.length}장`}
          </span>
        )}
        {familyView === 'all' && <FamilyBadge family={thumb?.family} className="absolute bottom-2 left-2 z-10" />}
        {multiSelectMode && <LibraryCardSelection selected={selected} onToggle={onToggleSelect} />}
        <LibraryCardHover hint="카드를 클릭하여 상세 보기" />
        <div data-library-card-actions="" className="absolute top-0 left-0 right-0 flex flex-wrap justify-center items-center gap-1 z-20 py-1.5 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity duration-200">
          <Tooltip content="작가 태그 복사">
            <button type="button" aria-label="작가 태그 복사" title="작가 태그 복사" className="w-8 h-8 rounded-full btn-solid-sky flex items-center justify-center shadow-lg transition-colors"
              onClick={event => { event.stopPropagation(); copyText('artist:' + artist.name, '작가 태그를 복사했습니다'); }}><FaCopy size={14} /></button>
          </Tooltip>
          {(isMobile || appState.webSearchEnabled) && <Tooltip content="Danbooru에서 검색">
            <button type="button" aria-label="Danbooru에서 검색" title="Danbooru에서 검색" className="w-8 h-8 rounded-full btn-solid-purple flex items-center justify-center shadow-lg transition-colors"
              onClick={event => { event.stopPropagation(); window.dispatchEvent(new CustomEvent('danbooru-search-request', { detail: { text: artist.name } })); }}><FaGlobe size={14} /></button>
          </Tooltip>}
          <Tooltip content={artist.favorite ? '즐겨찾기 해제' : '즐겨찾기 지정'}>
            <button type="button" aria-label={artist.favorite ? '즐겨찾기 해제' : '즐겨찾기 지정'} title={artist.favorite ? '즐겨찾기 해제' : '즐겨찾기 지정'} className="w-8 h-8 rounded-full btn-solid-red flex items-center justify-center shadow-lg transition-colors"
              onClick={event => { event.stopPropagation(); toggleArtistFavoriteRecorded(artist.id); }}>
              {artist.favorite ? <FaHeart size={14} /> : <FaRegHeart size={14} />}
            </button>
          </Tooltip>
        </div>
      </div>
      {/* 이름·태그는 정보 영역에, 동작은 이미지 상단에 둔다. */}
      <div className="p-2.5">
          <span className="block min-w-0 text-sm font-medium text-default truncate cursor-pointer" title={artist.name} onClick={handleClick}>{artist.name}</span>
        {artist.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {artist.tags.slice(0, 4).map((t) => (
              <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--c-surface)] text-muted">{t}</span>
            ))}
            {artist.tags.length > 4 && <span className="text-[11px] text-faint">+{artist.tags.length - 4}</span>}
          </div>
        )}
      </div>
    </div>
  );
});

// ─── 그리드 끝 "새 작가 추가" 카드 ───
const AddArtistCard = ({ onClick }: { onClick: () => void }) => (
  <button
    className="flex-none w-[calc(50%-8px)] md:w-60 self-stretch min-h-[16rem] rounded-lg border-2 border-dashed line-color flex flex-col items-center justify-center text-faint"
    onClick={onClick}
  >
    <FaPlus size={30} />
    <span className="mt-2 text-sm font-medium">새 작가 추가</span>
  </button>
);

// ─── 탭 ───
type SortKey = 'recent' | 'name' | 'favorite';

const ArtistLibraryTab = observer(({ isActive = true }: { isActive?: boolean }) => {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const [favOnly, setFavOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [contextId, setContextId] = useState<string>();
  const { show: showContextMenu } = useContextMenu({ id: 'artist-library-menu' });
  const [mobileSelectMode, setMultiSelectMode] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const [mergingDuplicates, setMergingDuplicates] = useState(false);
  const [familyView, setFamilyViewState] = useState<FamilyView>(loadFamilyView);
  const setFamilyView = (v: FamilyView) => {
    setFamilyViewState(v);
    saveFamilyView(v);
  };
  // 프롬프트 편집기의 「작가 라이브러리」 버튼 → 해당 카드 열기(appState.openArtistInLibrary)
  const focus = appState.artistLibraryFocus;
  useEffect(() => {
    if (!focus) return;
    if (artistLibraryService.getArtist(focus.id)) setOpenId(focus.id);
  }, [focus?.id, focus?.nonce]);

  const exitMultiSelect = () => {
    setMultiSelectMode(false);
    selection.clear();
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const doBulkDelete = () => {
    if (selectedIds.size === 0) return;
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({
        kind: 'artist',
        count: selectedIds.size,
        outcome: 'permanent',
        extra: ARTIST_DELETE_EXTRA,
      }),
      callback: async () => {
        // 한 명이 실패해도 나머지를 계속 지우고 결과를 알린다(X13 — 예전에는 첫 실패에서 멈추고 무안내)
        const ids = Array.from(selectedIds);
        const failedNames: string[] = [];
        for (const id of ids) {
          try {
            await artistLibraryService.deleteArtist(id);
          } catch (e) {
            console.error('작가 삭제 실패:', id, e);
            failedNames.push(artistLibraryService.getArtist(id)?.name ?? id);
          }
        }
        exitMultiSelect();
        if (failedNames.length > 0) {
          appState.pushDialog({
            type: 'yes-only',
            text:
              `작가 ${batchResultLine(ids.length - failedNames.length, failedNames.length)}\n` +
              `삭제하지 못한 작가: ${failedNamesLine(failedNames)}`,
          });
        } else {
          appState.pushMessage(`작가 ${ids.length}명을 삭제했습니다.`);
        }
      },
    });
  };

  const newArtist = async () => {
    // 같은 이름(대소문자·공백 무시)이 있으면 그 카드를 연다(기존 동작) — 중복을 거부하지 않는다
    const name = await promptName({ title: '작가 이름을 입력하세요 (예: suko mugi)', kind: 'artist' });
    if (!name) return;
    const existing = artistLibraryService.findArtistByName(name);
    const a = artistLibraryService.createArtist(name);
    if (a) {
      if (existing) {
        appState.pushMessage('동일한 작가가 있어 기존 카드를 열었습니다.');
      }
      setOpenId(a.id);
    }
  };

  const mergeDuplicates = () => {
    const groups = artistLibraryService.getDuplicateArtistGroups();
    if (groups.length === 0) {
      appState.pushMessage('동일한 이름의 중복 작가가 없습니다.');
      return;
    }
    const cards = groups.reduce((sum, group) => sum + group.length, 0);
    const images = groups.reduce(
      (sum, group) => sum + group.reduce((n, artist) => n + artist.images.length, 0),
      0,
    );
    appState.pushDialog({
      type: 'confirm',
      danger: true,
      text:
        `동일한 이름의 작가 ${groups.length}그룹을 일괄 병합할까요?\n` +
        `대상 카드 ${cards}개 · 샘플 이미지 ${images}장\n\n` +
        '실행 전 작가 라이브러리 백업을 권장합니다.\n' +
        '각 그룹에서 가장 먼저 만든 카드를 기준으로 이미지와 태그를 합칩니다.',
      callback: async () => {
        setMergingDuplicates(true);
        appState.setProgressDialog({
          text: '중복 작가 병합 중...',
          done: 0,
          total: groups.length,
        });
        try {
          const result = await artistLibraryService.mergeDuplicateArtists(
            (done, total) =>
              appState.setProgressDialog({
                text: '중복 작가 병합 중...',
                done,
                total,
              }),
          );
          appState.pushDialog({
            type: 'yes-only',
            text:
              `중복 작가 ${result.groups}그룹을 병합했습니다.\n` +
              `정리한 카드 ${result.mergedArtists}개 · 이동한 이미지 ${result.copiedImages}장`,
          });
        } catch (e: any) {
          appState.pushMessage('중복 작가 병합 실패: ' + (e?.message || e));
        } finally {
          appState.setProgressDialog(undefined);
          setMergingDuplicates(false);
        }
      },
    });
  };

  let list = artistLibraryService.search(query);
  if (favOnly) list = list.filter((a) => a.favorite);
  list = [...list].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    if (sortBy === 'favorite') return (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.updatedAt - a.updatedAt);
    return b.updatedAt - a.updatedAt;
  });

  const total = artistLibraryService.artists.length;
  const selection = useLibraryGridSelection({
    desktop: !isMobile, active: isActive, scope: query + '/' + sortBy + '/' + favOnly + '/' + familyView,
    ids: list.map(artist => artist.id), viewport, suppressClick,
    cardSelector: '[data-artist-id]', idOf: card => card.dataset.artistId,
  });
  const { selectedIds, setSelectedIds } = selection;
  const multiSelectMode = isMobile ? mobileSelectMode : selectedIds.size > 0;

  return (
    <div className="w-full h-full flex flex-col bg-[var(--c-surface)] overflow-hidden">
      <div className="flex-none">
        <GridSearchBar label="작가 이름 · 태그 검색" query={query} onChange={setQuery} />
        <LibraryToolbar view={<div data-library-toolbar-end="artists" className="flex items-end gap-4">
          {multiSelectMode && <div className="scene-toolbar-row" data-library-selection-actions="">
            <GridToolbarGroup caption={`${selectedIds.size}개 선택`}>
              <LibraryAction label={list.every(artist => selectedIds.has(artist.id)) ? '전체 해제' : '전체 선택'} icon={<FaCheckSquare />}
                onClick={() => setSelectedIds(list.every(artist => selectedIds.has(artist.id)) ? new Set() : new Set(list.map(artist => artist.id)))} />
              <LibraryAction label="선택 삭제" tone="red" icon={<FaTrash />} disabled={!selectedIds.size} onClick={doBulkDelete} />
              <LibraryAction label="선택 해제" icon={<FaTimes />} onClick={exitMultiSelect} />
            </GridToolbarGroup>
          </div>}
          <div className="flex items-center gap-2 h-8">
          {(query.trim() || favOnly) && <span role="status" className="text-xs text-muted tabular-nums">결과 {list.length}개</span>}
          <select aria-label="작가 정렬" className="gray-input text-sm py-1 px-2" value={sortBy}
            onChange={e => setSortBy(e.target.value as SortKey)}>
            <option value="recent">최근순</option>
            <option value="name">이름순</option>
            <option value="favorite">즐겨찾기 우선</option>
          </select>
          </div>
        </div>}>
          <GridToolbarGroup caption="작가">
            <LibraryAction label="새 작가" tone="sky" icon={<FaPlus />} onClick={newArtist} />
            <LibraryAction label="중복 병합" hint="같은 이름의 작가 카드 병합" icon={<FaCompressArrowsAlt />}
              disabled={mergingDuplicates} onClick={mergeDuplicates} />
          </GridToolbarGroup>
          <GridToolbarGroup caption="백업" separate>
            <LibraryAction label="백업" hint="작가 라이브러리 전체 백업" icon={<FaFileArchive />} onClick={() => appState.artistLibraryBackupExport()} />
            <LibraryAction label="백업 불러오기" icon={<FaFileImport />} onClick={() => appState.artistLibraryBackupImport()} />
          </GridToolbarGroup>
          <GridToolbarGroup caption="탐색" separate>
            <LibraryAction label="즐겨찾기" pressed={favOnly} tone={favOnly ? 'orange' : 'gray'}
              icon={<FaHeart />} onClick={() => setFavOnly(v => !v)} />
            {isMobile && <LibraryAction label={multiSelectMode ? '멀티선택 취소' : '멀티선택'} pressed={multiSelectMode}
              tone={multiSelectMode ? 'orange' : 'gray'} icon={<FaCheckSquare />}
              onClick={() => multiSelectMode ? exitMultiSelect() : setMultiSelectMode(true)} />}
          </GridToolbarGroup>
          <GridToolbarGroup caption="모델 계열" separate>
            <div className="flex h-8 rounded-lg border line-color overflow-hidden text-sm" role="group" aria-label="모델 계열 보기" data-artist-family-view={familyView}>
              {(['all', 'v4_5', 'v5'] as FamilyView[]).map(v => (
                <button key={v} className={'px-3 ' + (familyView === v ? 'back-sky' : 'back-gray')}
                  onClick={() => setFamilyView(v)} aria-pressed={familyView === v}>
                  {v === 'all' ? '전체' : FAMILY_LABEL[v]}
                </button>
              ))}
            </div>
          </GridToolbarGroup>
        </LibraryToolbar>
      </div>

      {/* 본문 */}
      <div ref={viewport} tabIndex={0} aria-label="작가 라이브러리 목록" data-library-grid="" onKeyDownCapture={selection.onKeyDownCapture} className="relative select-none outline-none flex-1 overflow-auto px-1 pt-1 pb-4"
        onMouseDownCapture={e => { if (!isMobile) focusGridSurface(e); selection.onMouseDownCapture(e); }}
        onClickCapture={selection.onClickCapture}>
        {selection.overlay}
        {total > 0 && list.length === 0 ? (
          <EmptyState size="lg" className="py-10">검색 결과가 없습니다.</EmptyState>
        ) : (
          <div className="flex flex-wrap gap-4 items-start">
            <AddArtistCard onClick={newArtist} />
            {list.map((a) => (
              <ArtistCard
                key={a.id}
                artist={a}
                multiSelectMode={multiSelectMode}
                selected={selectedIds.has(a.id)}
                onToggleSelect={() => toggleSelect(a.id)}
                onOpen={() => setOpenId(a.id)}
                familyView={familyView}
                onContextMenu={event => {
                  event.preventDefault(); event.stopPropagation();
                  if (!selectedIds.has(a.id)) setSelectedIds(new Set([a.id]));
                  setContextId(a.id); showContextMenu({ event });
                }}
              />
            ))}
          </div>
        )}
      </div>

      <Menu id="artist-library-menu" onVisibilityChange={contextMenuBackLayer('artist-library-menu')}>
        <Item disabled={selectedIds.size !== 1} onClick={() => { if (contextId) setOpenId(contextId); }}>상세·수정</Item>
        <Item onClick={() => {
          const tags = Array.from(selectedIds).map(id => artistLibraryService.getArtist(id)).filter(Boolean).map(artist => 'artist:' + artist!.name);
          void copyText(tags.join(', '), `작가 태그 ${tags.length}개를 복사했습니다`);
        }}>작가 태그 복사</Item>
        {(isMobile || appState.webSearchEnabled) && <Item disabled={selectedIds.size !== 1} onClick={() => {
          const artist = contextId && artistLibraryService.getArtist(contextId);
          if (artist) window.dispatchEvent(new CustomEvent('danbooru-search-request', { detail: { text: artist.name } }));
        }}>Danbooru에서 검색</Item>}
        <Separator />
        <Item onClick={() => setArtistsFavoriteRecorded(selectedIds, true)}>즐겨찾기 지정</Item>
        <Item onClick={() => setArtistsFavoriteRecorded(selectedIds, false)}>즐겨찾기 해제</Item>
        <Separator />
        <Item onClick={doBulkDelete}>삭제</Item>
      </Menu>
      {openId && <ArtistDetailModal artistId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
});

export default ArtistLibraryTab;
