import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Buffer } from 'buffer';
import {
  FaTrash,
  FaCheckSquare,
  FaSquare,
  FaFileArchive,
  FaFileImport,
} from 'react-icons/fa';
import { ReorderDragPreview, useGridReorder } from './GridReorder';
import { GridSearchBar, GridToolbarGroup, LibraryAction, LibraryToolbar } from './GridToolbar';
import { ActionIcon } from './ActionIcon';
import {
  backend,
  globalPresetService,
  imageService,
  isMobile,
} from '../models';
import {
  GlobalPresetType,
  IGlobalPresetEntry,
  SUPPORTED_GLOBAL_PRESET_TYPES,
} from '../models/GlobalPresetService';
import { appState } from '../models/AppService';
import { dataUriToBase64 } from '../models/ImageService';
import { nameErrorMessage, promptName } from '../models/nameInput';
import {
  batchResultLine,
  deleteConfirmText,
  failedNamesLine,
} from '../models/deleteFlowRules';
import Tooltip from './Tooltip';
import { PresetEditModal } from './PresetEditModal';
import { filterSortGlobalPresets, reorderGlobalPresetIds, GlobalPresetSortBy } from '../models/globalPresetListView';
import { GlobalPresetPicker } from './GlobalPresetPicker';
import { beginPresetListRecord } from '../models/presetUndo';
import { UNDO_TEXT } from '../models/undoService';
import {
  renameGlobalPresetRecorded,
  setGlobalPresetDefaultRecorded,
  setGlobalPresetsDefaultRecorded,
} from '../models/globalLibraryUndo';

// 템플릿 관리(글로벌 프리셋 카드 선택)와 공유 — export
export const GlobalVibeImage = observer(
  ({
    profile,
    className,
  }: {
    profile?: string;
    className: string;
  }) => {
    const [image, setImage] = useState<string | null>(null);
    useEffect(() => {
      let cancelled = false;
      if (!profile) {
        setImage(null);
        return;
      }
      (async () => {
        try {
          const data = await globalPresetService.fetchProfileImage(profile);
          if (!cancelled) setImage(data);
        } catch (e) {
          if (!cancelled) setImage(null);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [profile]);
    if (image) {
      return (
        <img
          className={className}
          src={image}
          draggable={false}
        />
      );
    }
    return (
      <div
        className={
          className +
          ' flex items-center justify-center bg-[var(--c-surface)] border line-color'
        }
      >
        <span className="text-xs text-muted text-center px-1 select-none">
          NO IMAGE
        </span>
      </div>
    );
  },
);

interface EasyCardProps {
  entry: IGlobalPresetEntry;
  reorderClass?: string;
  selected: boolean;
  multiSelectMode: boolean;
  onToggleSelect: () => void;
  onImportToSession: () => void;
  onToggleDefault: () => void;
  onRename: () => void;
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
}

const EasyCard = observer(
  ({
    entry,
    reorderClass,
    selected,
    multiSelectMode,
    onToggleSelect,
    onImportToSession,
    onToggleDefault,
    onRename,
    onEdit,
    onExport,
    onDelete,
  }: EasyCardProps) => {
    // 모바일에선 호버가 없으므로:
    //  - 이미지 탭 시 자동 불러오기 금지 (대신 아래 "불러오기" 버튼)
    //  - 액션 버튼은 항상 표시
    // 데스크탑에선 기존대로 이미지 탭 = 불러오기, 호버 시 버튼 노출
    return (
      <div
        data-global-preset-id={entry.id}
        className={
          (reorderClass || '') +
          // 테두리 폭은 항상 border-2 로 고정(선택 시 크기 변화 방지).
          // 선택 강조는 레이아웃에 영향 없는 안쪽 ring(ring-inset)으로 표현.
          // 모바일은 한 줄에 2개(50%-half gap), 데스크톱은 고정폭.
          'relative flex-none w-[calc(50%-8px)] md:w-64 group rounded-lg overflow-hidden flex flex-col border-2 ' +
          (selected
            ? 'border-sky-500 ring-2 ring-inset ring-sky-500'
            : 'line-color')
        }
      >
        <div
          className={
            'relative ' +
            (multiSelectMode
              ? 'cursor-pointer hover:brightness-95 active:brightness-90'
              : '')
          }
          onClick={() => {
            // 실수 클릭 임포트 방지 — 임포트는 호버 시 나타나는 중앙 버튼으로만.
            if (multiSelectMode) onToggleSelect();
          }}
        >
          <GlobalVibeImage
            profile={entry.profile}
            className="w-full aspect-[3/4] md:aspect-auto md:h-96 object-cover"
          />
          {/* 이름 배지 */}
          <div
            className="absolute bottom-0 right-0 bg-gray-700/80 text-base text-white px-2 py-1 rounded-xl m-2 truncate select-none"
            style={{ maxWidth: '90%' }}
          >
            {entry.name}
          </div>
          {/* 기본 표시 */}
          {entry.isDefault && (
            <div
              className="absolute top-2 left-2 bg-orange-500 text-white rounded-full p-2 shadow-lg"
              title="기본으로 지정됨"
            >
              <ActionIcon id="pin-default" size={16} />
            </div>
          )}
          {/* 멀티선택 체크박스 */}
          {multiSelectMode && (
            <div className="absolute top-2 right-2 bg-[var(--c-surface-2)] rounded p-2 shadow-lg">
              {selected ? (
                <FaCheckSquare className="text-sky-500" size={22} />
              ) : (
                <FaSquare className="text-faint" size={22} />
              )}
            </div>
          )}
          {/* PC: 호버 시 어두워지는 레이어 (버튼 클릭을 막지 않도록 pointer-events-none) */}
          {!multiSelectMode && !isMobile && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/45 transition-colors duration-200 z-10 pointer-events-none" />
          )}
          {/* PC: 중앙 큰 불러오기 버튼 (솔리드 — 어둠 레이어와 무관하게 선명) */}
          {!multiSelectMode && !isMobile && (
            <button
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center gap-2 whitespace-nowrap px-5 py-2.5 rounded-lg btn-solid-sky text-base font-semibold shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200"
              onClick={(e) => {
                e.stopPropagation();
                onImportToSession();
              }}
            >
              <ActionIcon id="copy-to-project" size={16} />
              프로젝트로 복사
            </button>
          )}
          {/* PC: 하단 액션 바 (솔리드 색·확대·균등 배치 — 씬 카드 스타일) */}
          {!multiSelectMode && !isMobile && (
            <div className="absolute bottom-0 left-0 right-0 z-20 flex justify-center items-center gap-2 py-2.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <Tooltip content={entry.isDefault ? '기본 해제' : '기본으로 지정'}>
                <button
                  className="icon-button btn-solid-orange p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDefault();
                  }}
                >
                  <ActionIcon id="pin-default" size={18} className={entry.isDefault ? undefined : 'opacity-50'} />
                </button>
              </Tooltip>
              <Tooltip content="이름 변경">
                <button
                  className="icon-button btn-solid-green p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename();
                  }}
                >
                  <ActionIcon id="rename" size={18} />
                </button>
              </Tooltip>
              <Tooltip content="편집 (프롬프트·설정·대표 이미지)">
                <button
                  className="icon-button btn-solid-indigo p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit();
                  }}
                >
                  <ActionIcon id="edit" size={18} />
                </button>
              </Tooltip>
              <Tooltip content="PNG로 내보내기">
                <button
                  className="icon-button btn-solid-sky p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onExport();
                  }}
                >
                  <ActionIcon id="export" size={18} />
                </button>
              </Tooltip>
              <Tooltip content="삭제">
                <button
                  className="icon-button btn-solid-red p-3 !rounded-lg shadow-lg"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <FaTrash size={18} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>

        {/* 모바일 전용 액션 바 (항상 노출, 좁은 카드라 다단 배치 + 큰 터치 타깃) */}
        {!multiSelectMode && isMobile && (
          <div className="flex flex-col gap-1.5 p-2 bg-[var(--c-surface)] border-t line-color">
            <button
              className="w-full round-button back-sky text-sm py-2.5 font-medium"
              onClick={onImportToSession}
            >
              프로젝트로 복사
            </button>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                className="icon-button btn-solid-orange py-2.5 flex items-center justify-center"
                onClick={onToggleDefault}
                title={entry.isDefault ? '기본 해제' : '기본으로 지정'}
              >
                <ActionIcon id="pin-default" size={18} className={entry.isDefault ? undefined : 'opacity-50'} />
              </button>
              <button
                className="icon-button btn-solid-green py-2.5 flex items-center justify-center"
                onClick={onRename}
                title="이름 변경"
              >
                <ActionIcon id="rename" size={18} />
              </button>
              <button
                className="icon-button btn-solid-indigo py-2.5 flex items-center justify-center"
                onClick={onEdit}
                title="편집"
              >
                <ActionIcon id="edit" size={18} />
              </button>
              <button
                className="icon-button btn-solid-sky py-2.5 flex items-center justify-center"
                onClick={onExport}
                title="내보내기"
              >
                <ActionIcon id="export" size={18} />
              </button>
              <button
                className="icon-button btn-solid-red py-2.5 flex items-center justify-center"
                onClick={onDelete}
                title="삭제"
              >
                <FaTrash size={18} />
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);

interface GenRowProps {
  entry: IGlobalPresetEntry;
  selected: boolean;
  multiSelectMode: boolean;
  onToggleSelect: () => void;
  onImportToSession: () => void;
  onToggleDefault: () => void;
  onRename: () => void;
  onExport: () => void;
  onDelete: () => void;
}

const GenRow = observer(
  ({
    entry,
    selected,
    multiSelectMode,
    onToggleSelect,
    onImportToSession,
    onToggleDefault,
    onRename,
    onExport,
    onDelete,
  }: GenRowProps) => {
    return (
      <div
        className={
          'flex flex-col gap-2 p-3 border-2 rounded-lg mb-2 bg-[var(--c-surface-2)] ' +
          (selected
            ? 'border-sky-500 bg-sky-50 dark:bg-sky-900'
            : 'line-color')
        }
      >
        {/* 1행: 기본 토글 + 이름 (전체 너비) */}
        <div className="flex items-center gap-3 min-w-0">
          {multiSelectMode && (
            <button
              className="icon-button flex-none"
              aria-label={selected ? '선택 해제' : '선택'}
              onClick={onToggleSelect}
            >
              {selected ? (
                <FaCheckSquare className="text-sky-500" size={22} />
              ) : (
                <FaSquare className="text-faint" size={22} />
              )}
            </button>
          )}
          <button
            className="icon-button p-1 flex-none"
            onClick={onToggleDefault}
            title={entry.isDefault ? '기본 해제' : '기본으로 지정'}
          >
            <ActionIcon
              id="pin-default"
              className={entry.isDefault ? 'text-orange-500' : 'text-faint'}
              size={22}
            />
          </button>
          <span className="flex-1 truncate text-default text-base font-medium">
            {entry.name}
          </span>
        </div>
        {/* 2행: 액션 버튼들 */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="round-button back-sky text-base px-4 py-2 flex-1 md:flex-none"
            onClick={onImportToSession}
            disabled={multiSelectMode}
          >
            프로젝트로 복사
          </button>
          <div className="flex gap-2 md:ml-auto">
            <Tooltip content="이름 변경">
              <button
                className="icon-button btn-solid-green p-3"
                onClick={onRename}
              >
                <ActionIcon id="rename" size={16} />
              </button>
            </Tooltip>
            <Tooltip content="PNG로 내보내기">
              <button
                className="icon-button btn-solid-sky p-3"
                onClick={onExport}
              >
                <ActionIcon id="export" size={16} />
              </button>
            </Tooltip>
            <Tooltip content="삭제">
              <button
                className="icon-button btn-solid-red p-3"
                onClick={onDelete}
              >
                <FaTrash size={16} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    );
  },
);


export const GlobalPresetTab = observer(() => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // 통합: 이지/일반 구분 없이 하나의 라이브러리 + 검색/정렬
  const [query, setQuery] = useState('');
  const [sortBy, setSort] = useState<GlobalPresetSortBy>(() => {
    const saved = localStorage.getItem('global-preset-sort');
    return saved === 'manual' || saved === 'name' || saved === 'default' ? saved : 'recent';
  });
  const setSortBy = (sort: GlobalPresetSortBy) => {
    setSort(sort);
    localStorage.setItem('global-preset-sort', sort);
  };
  const viewport = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const [editing, setEditing] = useState<IGlobalPresetEntry | null>(null);

  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [draftProfile, setDraftProfile] = useState<string | null>(null);
  const newPreset = async () => {
    const session = appState.curSession;
    const selected = session?.selectedWorkflow;
    const preset = selected?.presetName && session?.getPreset(selected.workflowType, selected.presetName);
    if (!preset || !SUPPORTED_GLOBAL_PRESET_TYPES.includes(preset.type)) {
      appState.pushMessage('저장할 이미지 생성 프리셋을 먼저 선택해주세요.', 'error');
      return;
    }
    // Capture the selected settings before opening the editor; edits stay detached.
    const snapshot = JSON.parse(JSON.stringify(preset.toJSON()));
    try {
      const profile = snapshot.profile
        ? await imageService.fetchVibeImage(session!, snapshot.profile)
        : null;
      setDraftProfile(profile);
      setDraft(snapshot);
    } catch (error: any) {
      appState.pushMessage(error.message || '현재 프리셋을 읽지 못했습니다.', 'error');
    }
  };
  const allPresets = globalPresetService.list();

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitMultiSelect = () => {
    setMultiSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleFiles = async (files: FileList) => {
    if (!files || files.length === 0) return;
    appState.setProgressDialog({
      text: '글로벌 프리셋 불러오는 중...',
      done: 0,
      total: files.length,
    });
    let ok = 0;
    let fail = 0;
    const failNames: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const buf = await file.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        const entry = await globalPresetService.importFromImage(base64);
        if (entry) ok++;
        else {
          fail++;
          failNames.push(file.name);
        }
      } catch (e: any) {
        fail++;
        failNames.push(file.name);
        console.error('Failed to import global preset:', file.name, e);
      }
      appState.setProgressDialog({
        text: '글로벌 프리셋 불러오는 중...',
        done: i + 1,
        total: files.length,
      });
    }
    appState.setProgressDialog(undefined);
    if (fail === 0) {
      appState.pushDialog({
        type: 'yes-only',
        text: `${ok}개의 글로벌 프리셋을 불러왔습니다.`,
      });
    } else {
      appState.pushDialog({
        type: 'yes-only',
        text: `성공 ${ok}개 / 실패 ${fail}개${
          failNames.length > 0
            ? '\n실패 파일: ' + failNames.slice(0, 5).join(', ')
            : ''
        }${failNames.length > 5 ? '\n...' : ''}`,
      });
    }
  };

  const handleRename = async (entry: IGlobalPresetEntry) => {
    // 현재 이름을 채워 연다 — 같은 종류(워크플로우)의 다른 프리셋과 겹치면 창 안에서 거부(D2)
    const newName = await promptName({
      title: `새 이름을 입력하세요 (현재: ${entry.name})`,
      kind: 'globalPreset',
      current: entry.name,
      existing: (n) => {
        const other = globalPresetService.getByName(entry.workflowType, n);
        return !!other && other.id !== entry.id;
      },
    });
    if (!newName) return;
    try {
      await renameGlobalPresetRecorded(entry.id, newName);
    } catch (e: any) {
      appState.pushMessage(
        nameErrorMessage(e, 'globalPreset', newName, '이름 변경 실패'),
        'error',
      );
    }
  };

  const handleDelete = (entry: IGlobalPresetEntry) => {
    appState.pushDialog({
      type: 'confirm',
      // 휴지통이 없다 — 영구 삭제(Enter 무시, 2026-10-03 E1)
      ...deleteConfirmText({ kind: 'globalPreset', name: entry.name, outcome: 'permanent' }),
      callback: async () => {
        try {
          await globalPresetService.delete(entry.id);
        } catch (e: any) {
          appState.pushMessage(e.message || '삭제 실패');
        }
      },
    });
  };

  const handleToggleDefault = async (entry: IGlobalPresetEntry) => {
    try {
      await setGlobalPresetDefaultRecorded(entry.id, !entry.isDefault);
    } catch (e: any) {
      appState.pushMessage(e.message || '기본 설정 실패');
    }
  };

  // 적용 시 변환 대상 모드: 현재 활성 워크플로우가 일반(SDImageGen)이면 일반,
  // 그 외(이지/미선택/기타)는 이지. (출처 타입이 아니라 "현재 활성 모드"를 따른다)
  // 레거시 작업모드 OFF(W3)면 항상 일반 — 이지모드 진입점이 숨겨져 있기 때문.
  const targetMode = (): GlobalPresetType =>
    !appState.legacyWorkflowMode ||
    appState.curSession?.selectedWorkflow?.workflowType === 'SDImageGen'
      ? 'SDImageGen'
      : 'SDImageGenEasy';

  const handleImportToSession = async (entry: IGlobalPresetEntry) => {
    if (!appState.curSession) {
      appState.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }
    await appState.importGlobalPresetIntoSession(
      appState.curSession,
      entry.id,
      targetMode(),
    );
  };

  const handleExport = async (entry: IGlobalPresetEntry) => {
    await appState.exportGlobalPresetToPng(entry);
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({
        kind: 'globalPreset',
        count: selectedIds.size,
        outcome: 'permanent',
      }),
      callback: async () => {
        // 실패를 삼키지 않는다 — 건수와 이름을 알린다(X13)
        const ids = Array.from(selectedIds);
        const failedNames: string[] = [];
        for (const id of ids) {
          try {
            await globalPresetService.delete(id);
          } catch (e) {
            console.error('글로벌 프리셋 삭제 실패:', id, e);
            failedNames.push(globalPresetService.get(id)?.name ?? id);
          }
        }
        exitMultiSelect();
        if (failedNames.length > 0) {
          appState.pushDialog({
            type: 'yes-only',
            text:
              `글로벌 프리셋 ${batchResultLine(ids.length - failedNames.length, failedNames.length)}\n` +
              `삭제하지 못한 프리셋: ${failedNamesLine(failedNames)}`,
          });
        } else {
          appState.pushMessage(`글로벌 프리셋 ${ids.length}개를 삭제했습니다.`);
        }
      },
    });
  };

  const handleBulkImportToSession = async () => {
    if (selectedIds.size === 0) return;
    if (!appState.curSession) {
      appState.pushMessage('세션을 먼저 선택해주세요.');
      return;
    }
    const session = appState.curSession;
    appState.setProgressDialog({
      text: '프로젝트로 복사하는 중...',
      done: 0,
      total: selectedIds.size,
    });
    let done = 0;
    let fail = 0;
    const target = targetMode();
    // 되돌리기(U3b): 프로젝트에 추가된 그림체 전부 = 1항목(글로벌 쪽은 바뀌지 않음)
    const undoRec = beginPresetListRecord(session, UNDO_TEXT.presetFromGlobal(selectedIds.size));
    for (const id of Array.from(selectedIds)) {
      try {
        await globalPresetService.instantiateIntoSession(session, id, target);
      } catch (e) {
        fail++;
      }
      done++;
      appState.setProgressDialog({
        text: '프로젝트로 복사하는 중...',
        done,
        total: selectedIds.size,
      });
    }
    appState.setProgressDialog(undefined);
    undoRec.commit(UNDO_TEXT.presetFromGlobal(done - fail));
    appState.pushMessage(
      `${done - fail}개 프로젝트로 복사 완료${fail > 0 ? ` (${fail}개 실패)` : ''}`,
    );
    exitMultiSelect();
  };

  const handleBulkSetDefault = async (value: boolean) => {
    if (selectedIds.size === 0) return;
    // 한 동작 = 되돌리기 한 항목(2차 묶음 4 P5) — 개별 오류는 종전처럼 삼킨다
    await setGlobalPresetsDefaultRecorded(Array.from(selectedIds), value);
    exitMultiSelect();
  };

  const total = allPresets.length;
  const q = query.trim().toLowerCase();
  // 검색·정렬 규칙 단일 출처 — 공용 고르기 창(GlobalPresetPicker)과 같다
  const visible = filterSortGlobalPresets(allPresets, query, sortBy);
  const reorder = useGridReorder<string>({
    enabled: !isMobile, scope: query + '/' + sortBy, viewport, suppressClick,
    cardSelector: '[data-global-preset-id]',
    resolve: card => card.dataset.globalPresetId,
    selected: id => selectedIds.has(id) ? visible.filter(p => selectedIds.has(p.id)).map(p => p.id) : [id],
    commit: (dragged, target, group) => {
      const order = filterSortGlobalPresets(globalPresetService.list(), '', sortBy).map(p => p.id);
      const next = reorderGlobalPresetIds(order, visible.map(p => p.id), group, dragged, target);
      if (!next) return;
      globalPresetService.reorder(next);
      setSortBy('manual');
    },
  });

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--c-surface)]">
      <div className="flex-none" data-gp-mobile-toolbar={isMobile ? '' : undefined}>
        <GridSearchBar label="프리셋 이름 검색" query={query} onChange={setQuery} />
        <LibraryToolbar view={<>
          {q && <span role="status" className="text-xs text-muted tabular-nums">검색 결과 {visible.length}개</span>}
          <select aria-label="프리셋 정렬" value={sortBy} onChange={e => setSortBy(e.target.value as GlobalPresetSortBy)}
            className="gray-input text-sm py-1 px-2">
            <option value="manual">사용자 지정순</option>
            <option value="recent">최근 수정순</option>
            <option value="name">이름순</option>
            <option value="default">기본 우선</option>
          </select>
        </>}>
          <GridToolbarGroup caption="추가">
            <LibraryAction label="새 프리셋" tone="sky" icon={<ActionIcon id="add-scene" size={18} />} onClick={newPreset} />
            <LibraryAction label="PNG 불러오기" icon={<ActionIcon id="import" size={18} />} onClick={() => fileInputRef.current?.click()} />
          </GridToolbarGroup>
          <GridToolbarGroup caption="백업" separate>
            <LibraryAction label="백업" hint="글로벌 프리셋 전체 백업" icon={<FaFileArchive />} onClick={() => appState.globalPresetBackupExport()} />
            <LibraryAction label="백업 불러오기" icon={<FaFileImport />} onClick={() => appState.globalPresetBackupImport()} />
          </GridToolbarGroup>
          <GridToolbarGroup caption="선택" separate>
            <LibraryAction label={multiSelectMode ? '멀티선택 취소' : '멀티선택'} pressed={multiSelectMode}
              tone={multiSelectMode ? 'orange' : 'gray'} icon={<FaCheckSquare />}
              onClick={() => multiSelectMode ? exitMultiSelect() : setMultiSelectMode(true)} />
          </GridToolbarGroup>
        </LibraryToolbar>
        {multiSelectMode && (
          <div className="flex items-center gap-1.5">
            <button type="button" className="round-button back-sky h-8 flex-1 min-w-0 px-1 text-xs" disabled={selectedIds.size === 0} onClick={handleBulkImportToSession}>프로젝트로 복사</button>
            <button type="button" className="round-button back-orange h-8 flex-1 min-w-0 px-1 text-xs" disabled={selectedIds.size === 0} onClick={() => handleBulkSetDefault(true)}>기본 지정</button>
            <button type="button" className="round-button back-gray h-8 flex-1 min-w-0 px-1 text-xs" disabled={selectedIds.size === 0} onClick={() => handleBulkSetDefault(false)}>기본 해제</button>
            <button type="button" className="round-button back-red h-8 flex-1 min-w-0 px-1 text-xs" disabled={selectedIds.size === 0} onClick={handleBulkDelete}>삭제</button>
          </div>
        )}
        <input
          type="file"
          accept="image/png"
          multiple
          ref={fileInputRef}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {/* 본문 */}
      <div ref={viewport} className={isMobile ? 'flex-1 overflow-auto px-3 pt-1 pb-3' : 'flex-1 overflow-auto px-1 pt-1 pb-6'}
        onMouseDownCapture={e => { suppressClick.current = false; reorder.start(e); }}
        onClickCapture={e => {
          if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
        }}>
        {reorder.drag && <ReorderDragPreview type="global-preset" drag={reorder.drag} />}
        {/* 통합 카드 그리드 (이지/일반 구분 없음) */}
        {total > 0 && visible.length === 0 && (
          <div className="text-center text-muted py-10">
            "{query}" 검색 결과가 없습니다.
          </div>
        )}
        {(visible.length > 0 || (!multiSelectMode && !q)) && (
          <div className="flex flex-wrap gap-4">
            {visible.map((entry) => (
              <EasyCard
                key={entry.id}
                entry={entry}
                reorderClass={reorder.drag?.items.includes(entry.id) ? 'opacity-30 no-touch ' :
                  reorder.drag?.target === entry.id ? 'ring-2 ring-sky-500 ' : undefined}
                selected={selectedIds.has(entry.id)}
                multiSelectMode={multiSelectMode}
                onToggleSelect={() => toggleSelect(entry.id)}
                onImportToSession={() => handleImportToSession(entry)}
                onToggleDefault={() => handleToggleDefault(entry)}
                onRename={() => handleRename(entry)}
                onEdit={() => setEditing(entry)}
                onExport={() => handleExport(entry)}
                onDelete={() => handleDelete(entry)}
              />
            ))}
            {!multiSelectMode && !q && (
              <button type="button" onClick={newPreset}
                className="flex-none w-[calc(50%-8px)] md:w-64 aspect-[3/4] md:aspect-auto md:min-h-96 rounded-lg border-2 border-dashed line-color bg-transparent text-sub hover:border-sky-500 clickable select-none flex flex-col items-center justify-center gap-1.5">
                <ActionIcon id="add-scene" size={22} />
                <span className="text-sm">새 글로벌 프리셋</span>
              </button>
            )}
          </div>
        )}
      </div>
      {draft && (
        <PresetEditModal title="새 글로벌 프리셋" initialName="" preset={draft}
          adapter={{
            fetchProfile: async () => draftProfile,
            save: async (name, patch, profile) => {
              if (globalPresetService.list().some(p => p.name === name))
                throw new Error('이미 존재하는 이름입니다');
              await globalPresetService.addFromPresetAndImage(
                { ...draft, ...patch, name },
                profile || (draftProfile ? dataUriToBase64(draftProfile) : null),
                name,
              );
              setQuery('');
              exitMultiSelect();
            },
          }}
          onClose={() => setDraft(null)}
        />
      )}
      {editing && (
        <PresetEditModal
          title="글로벌 프리셋 편집"
          initialName={editing.name}
          preset={editing.preset}
          adapter={{
            fetchProfile: () =>
              editing.profile
                ? globalPresetService.fetchProfileImage(editing.profile)
                : Promise.resolve(null),
            save: async (nm, patch, newRep) => {
              if (nm !== editing.name)
                await globalPresetService.rename(editing.id, nm);
              await globalPresetService.updatePreset(editing.id, patch);
              if (newRep)
                await globalPresetService.replaceProfileImage(
                  editing.id,
                  newRep,
                );
            },
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
});

/**
 * 현재 세션으로 가져오기 위한 글로벌 프리셋 선택 다이얼로그.
 * appState.globalPresetPicker가 설정되면 App.tsx에서 렌더링.
 * 창 본체는 공용 GlobalPresetPicker(size xl·검색·정렬 — 2026-11-14 M3). Esc·뒤로 가기·바깥 클릭·모달 카운터는
 * ModalOverlay 가 맡는다.
 */
export const GlobalPresetPickerOverlay = observer(() => {
  const picker = appState.globalPresetPicker;
  if (!picker) return null;
  // 통합: 전체 글로벌 프리셋을 보여주고, 선택 시 현재 모드로 자동 변환해 적용한다.
  const displayName =
    picker.workflowType === 'SDImageGenEasy' ? '그림체 (이지모드)' : '그림체';

  return (
    <GlobalPresetPicker
      isOpen
      onClose={() => appState.closeGlobalPresetPicker()}
      onPick={(id) => picker.onSelect(id)}
      title={
        <>
          글로벌 프리셋을 프로젝트로 복사{' '}
          <span className="text-sm font-normal text-muted">
            (→ {displayName}로 적용)
          </span>
        </>
      }
    />
  );
});
