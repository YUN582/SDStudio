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
  FaTimes,
} from 'react-icons/fa';
import { ReorderDragPreview, useGridReorder } from './GridReorder';
import { useLibraryGridSelection } from './LibraryGridSelection';
import { focusGridSurface, gridCardUsesSelection } from '../models/gridSelection';
import { GridSearchBar, GridToolbarGroup, LibraryAction, LibraryToolbar } from './GridToolbar';
import { ActionIcon } from './ActionIcon';
import { Menu, Item, Separator, useContextMenu } from 'react-contexify';
import { contextMenuBackLayer } from './contextMenuBack';
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
  onEdit: () => void;
  onExport: () => void;
  onDelete: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
}

const EasyCard = observer(({
  entry, reorderClass, selected, multiSelectMode, onToggleSelect,
  onImportToSession, onToggleDefault, onEdit, onExport, onDelete, onContextMenu,
}: EasyCardProps) => (
  <div data-global-preset-id={entry.id} data-library-selected={selected ? 'true' : 'false'} onContextMenu={onContextMenu}
    className={(reorderClass || '') + 'relative flex-none w-[calc(50%-8px)] md:w-64 group rounded-lg overflow-hidden flex flex-col border-2 bg-[var(--c-surface-2)] ' +
      (selected ? 'border-sky-500 ring-2 ring-inset ring-sky-500' : 'line-color')}>
    <div className="relative cursor-pointer" title={entry.name + ' · 프로젝트에 추가'}
      onClick={event => {
        if (!isMobile && gridCardUsesSelection(event)) return;
        if (isMobile && multiSelectMode) onToggleSelect(); else onImportToSession();
      }}>
      <GlobalVibeImage profile={entry.profile} className="w-full aspect-[3/4] md:aspect-auto md:h-96 object-cover" />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2 pointer-events-none">
        <div className="text-sm text-white font-medium drop-shadow truncate">{entry.name}</div>
      </div>
      {entry.isDefault && <div className="absolute top-2 left-2 bg-orange-500 text-white rounded-full p-2 shadow-lg pointer-events-none" title="기본으로 지정됨">
        <ActionIcon id="pin-default" size={16} />
      </div>}
      {multiSelectMode && <button type="button" aria-label={selected ? '선택 해제' : '선택'}
        className="absolute top-2 right-2 z-30 w-6 h-6 rounded bg-[var(--c-surface-2)] flex items-center justify-center"
        onClick={event => { event.stopPropagation(); onToggleSelect(); }}>
        {selected ? <FaCheckSquare className="text-sky-500" size={22} /> : <FaSquare className="text-faint" size={22} />}
      </button>}
      <div className="absolute inset-0 bg-black/0 md:group-hover:bg-black/40 transition-colors duration-200 pointer-events-none" />
      <div data-library-card-actions="" className={'absolute top-0 left-0 right-0 flex flex-wrap justify-center items-center gap-1 z-20 py-1.5 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity duration-200' + (isMobile && multiSelectMode ? ' hidden' : '')}>
        {[
          { label: '수정', tone: 'indigo', icon: <ActionIcon id="edit" size={14} />, run: onEdit },
          { label: entry.isDefault ? '기본 해제' : '기본으로 지정', tone: 'orange', icon: <ActionIcon id="pin-default" size={14} />, run: onToggleDefault },
          { label: 'PNG로 내보내기', tone: 'sky', icon: <ActionIcon id="export" size={14} />, run: onExport },
          { label: '삭제', tone: 'red', icon: <FaTrash size={14} />, run: onDelete },
        ].map(action => <Tooltip key={action.label} content={action.label}>
          <button type="button" aria-label={action.label} title={action.label}
            className={'w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-colors btn-solid-' + action.tone}
            onClick={event => { event.stopPropagation(); action.run(); }}>
            {action.icon}
          </button>
        </Tooltip>)}
      </div>
    </div>
  </div>
));

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


export const GlobalPresetTab = observer(({ isActive = true }: { isActive?: boolean }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mobileSelectMode, setMultiSelectMode] = useState(false);
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
  const [contextId, setContextId] = useState<string>();
  const { show: showContextMenu } = useContextMenu({ id: 'global-preset-menu' });

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
    selection.clear();
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
      text: '프로젝트에 추가하는 중...',
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
        text: '프로젝트에 추가하는 중...',
        done,
        total: selectedIds.size,
      });
    }
    appState.setProgressDialog(undefined);
    undoRec.commit(UNDO_TEXT.presetFromGlobal(done - fail));
    appState.pushMessage(
      `${done - fail}개 프로젝트에 추가 완료${fail > 0 ? ` (${fail}개 실패)` : ''}`,
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
  const selection = useLibraryGridSelection({
    desktop: !isMobile, active: isActive, scope: query + '/' + sortBy,
    ids: visible.map(entry => entry.id), viewport, suppressClick,
    cardSelector: '[data-global-preset-id]', idOf: card => card.dataset.globalPresetId,
  });
  const { selectedIds, setSelectedIds } = selection;
  const multiSelectMode = isMobile ? mobileSelectMode : selectedIds.size > 0;
  const reorder = useGridReorder<string>({
    enabled: !isMobile && isActive, scope: query + '/' + sortBy, viewport, suppressClick,
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
        <LibraryToolbar view={<div data-library-toolbar-end="global" className="flex items-end gap-4">
          {multiSelectMode && <div className="scene-toolbar-row" data-library-selection-actions="">
            <GridToolbarGroup caption={`${selectedIds.size}개 선택`}>
              <LibraryAction label={visible.every(entry => selectedIds.has(entry.id)) ? '전체 해제' : '전체 선택'} icon={<FaCheckSquare />}
                onClick={() => setSelectedIds(visible.every(entry => selectedIds.has(entry.id)) ? new Set() : new Set(visible.map(entry => entry.id)))} />
              <Tooltip content="선택한 프리셋을 프로젝트에 추가">
                <button type="button" className="round-button back-sky h-8 px-3 text-sm" disabled={!selectedIds.size} onClick={handleBulkImportToSession}>선택 추가</button>
              </Tooltip>
              <button type="button" className="round-button back-orange h-8 px-3 text-sm" disabled={!selectedIds.size} onClick={() => handleBulkSetDefault(true)}>기본 지정</button>
              <button type="button" className="round-button back-gray h-8 px-3 text-sm" disabled={!selectedIds.size} onClick={() => handleBulkSetDefault(false)}>기본 해제</button>
              <LibraryAction label="선택 삭제" tone="red" icon={<FaTrash />} disabled={!selectedIds.size} onClick={handleBulkDelete} />
              <LibraryAction label="선택 해제" icon={<FaTimes />} onClick={exitMultiSelect} />
            </GridToolbarGroup>
          </div>}
          <div className="flex items-center gap-2 h-8">
          {q && <span role="status" className="text-xs text-muted tabular-nums">검색 결과 {visible.length}개</span>}
          <select aria-label="프리셋 정렬" value={sortBy} onChange={e => setSortBy(e.target.value as GlobalPresetSortBy)}
            className="gray-input text-sm py-1 px-2">
            <option value="manual">사용자 지정순</option>
            <option value="recent">최근 수정순</option>
            <option value="name">이름순</option>
            <option value="default">기본 우선</option>
          </select>
          </div>
        </div>}>
          <GridToolbarGroup caption="추가">
            <LibraryAction label="새 프리셋" tone="sky" icon={<ActionIcon id="add-scene" size={18} />} onClick={newPreset} />
            <LibraryAction label="PNG 불러오기" icon={<ActionIcon id="import" size={18} />} onClick={() => fileInputRef.current?.click()} />
          </GridToolbarGroup>
          <GridToolbarGroup caption="백업" separate>
            <LibraryAction label="백업" hint="글로벌 프리셋 전체 백업" icon={<FaFileArchive />} onClick={() => appState.globalPresetBackupExport()} />
            <LibraryAction label="백업 불러오기" icon={<FaFileImport />} onClick={() => appState.globalPresetBackupImport()} />
          </GridToolbarGroup>
          {isMobile && <GridToolbarGroup caption="선택" separate>
            <LibraryAction label={isMobile ? (multiSelectMode ? '멀티선택 취소' : '멀티선택') : `선택 해제 (${selectedIds.size})`} pressed={multiSelectMode}
              tone={multiSelectMode ? 'orange' : 'gray'} icon={<FaCheckSquare />}
              onClick={() => multiSelectMode ? exitMultiSelect() : setMultiSelectMode(true)} />
          </GridToolbarGroup>}
        </LibraryToolbar>
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
      <div ref={viewport} tabIndex={0} aria-label="글로벌 프리셋 목록"
        className={'relative select-none outline-none ' + (isMobile ? 'flex-1 overflow-auto px-3 pt-1 pb-3' : 'flex-1 overflow-auto px-1 pt-1 pb-6')}
        onMouseDownCapture={e => { if (!isMobile) focusGridSurface(e); if (!selection.onMouseDownCapture(e)) reorder.start(e); }}
        onClickCapture={selection.onClickCapture}>
        {selection.overlay}
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
                onEdit={() => setEditing(entry)}
                onExport={() => handleExport(entry)}
                onDelete={() => handleDelete(entry)}
                onContextMenu={event => {
                  event.preventDefault(); event.stopPropagation();
                  if (!selectedIds.has(entry.id)) setSelectedIds(new Set([entry.id]));
                  setContextId(entry.id); showContextMenu({ event });
                }}
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
      <Menu id="global-preset-menu" onVisibilityChange={contextMenuBackLayer('global-preset-menu')}>
        <Item onClick={() => {
          const entry = contextId && globalPresetService.get(contextId);
          if (selectedIds.size === 1 && entry) void handleImportToSession(entry);
          else void handleBulkImportToSession();
        }}>프로젝트에 추가{selectedIds.size > 1 ? ` (${selectedIds.size}개)` : ''}</Item>
        <Item onClick={() => { void handleBulkSetDefault(true); }}>기본으로 지정</Item>
        <Item onClick={() => { void handleBulkSetDefault(false); }}>기본 해제</Item>
        <Separator />
        <Item disabled={selectedIds.size !== 1} onClick={() => {
          const entry = contextId && globalPresetService.get(contextId); if (entry) setEditing(entry);
        }}>수정</Item>
        <Item disabled={selectedIds.size !== 1} onClick={() => {
          const entry = contextId && globalPresetService.get(contextId); if (entry) void handleExport(entry);
        }}>PNG로 내보내기</Item>
        <Separator />
        <Item onClick={handleBulkDelete}>삭제{selectedIds.size > 1 ? ` (${selectedIds.size}개)` : ''}</Item>
      </Menu>
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
