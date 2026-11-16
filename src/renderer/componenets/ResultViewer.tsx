import { ImageVariantChoices, QuickVariantFlow } from './ImageVariantChoices';
import InPaintEditor from './InPaintEditor';
import { openSourceVariant } from '../models/sourceVariant';
import { confirmInpaintSceneDelete } from '../models/deleteInpaintWork';
import { ReorderDragPreview, useGridReorder } from './GridReorder';
import { moveCombinedGalleryImage } from '../models/galleryReorder';
import { focusGridSurface, gridKeyboardMove, gridNavigationAction, gridCardUsesSelection, gridClickSelection, gridSelectionCanReceiveEscape, type GridModifiers } from '../models/gridSelection';
import { keyboardShortcutService, KeyboardShortcutService } from '../models/KeyboardShortcutService';
import { canStartSelectionBox, imagePathsInSelectionBox } from '../models/dragSelection';
import { groupImagePaths, linkedImageVariants, type SceneImageFilter } from '../models/sceneImageVariants';
import { parseRankCutoff, RANK_CUTOFF_INVALID_MESSAGE } from '../models/rankCutoff';
import { isTextEntryFocused, shouldIgnoreViewerRawKey } from '../models/keyTargetGuard';
import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useContext,
  useRef,
  useMemo,
  memo,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  FixedSizeGrid as Grid,
  GridChildComponentProps,
  areEqual,
} from 'react-window';
import ResizeObserver from 'resize-observer-polyfill';
import { userInfo } from 'os';
import { CustomScrollbars } from './UtilComponents';
import Tournament from './Tournament';
import ShortcutCheatsheet from './ShortcutCheatsheet';
import {
  FaArrowLeft,
  FaArrowRight,
  FaCheck,
  FaDice,
  FaDownload,
  FaFolder,
  FaStar,
  FaTrash,
  FaShareSquare,
  FaChevronUp,
  FaExchangeAlt,
  FaSearchPlus,
  FaTrophy,
} from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import { isV2, V2_SHEET_PEEK_PX } from '../models/mobileV2';
import { V2MainRow, V2TierRows, type V2SlotDef, type V2TierItem } from './MobileV2Bars';
import { UndoBarSlot, UNDO_ANCHOR_ATTR } from './UndoBarSlot';
import { PromptHighlighter } from './SceneEditor';
import QueueControl from './SceneQueueControl';
import { FloatView, FloatViewActiveContext } from './FloatView';
import type { GenerationHistoryEntry } from '../models/ImageHistoryService';
import memoizeOne from 'memoize-one';
import {
  FaPaste,
  FaChevronLeft,
  FaChevronRight,
} from 'react-icons/fa6';
import { useContextMenu } from 'react-contexify';
import { useDrag, useDrop } from 'react-dnd';
import { getEmptyImage } from 'react-dnd-html5-backend';
import { reaction, set } from 'mobx';
import Tooltip from './Tooltip';
import {
  CharacterPrompt,
  ContextMenuType,
  GenericScene,
  InpaintScene,
  Scene,
  SelectedWorkflow,
} from '../models/types';
import {
  imageService,
  sessionService,
  isMobile,
  gameService,
  backend,
  taskQueueService,
  workFlowService,
  imageDownloadService,
  trashService,
} from '../models';
import { queueWorkflow } from '../models/TaskQueueService';
import { queueScene } from '../models/sceneQueueActions';
import { queueNaiUpscale } from '../models/workflows/NaiUpscaleFlow';
import { estimateNaiUpscaleCost } from '../backends/genVendors/naiUpscale';
import { getImageDimensions } from './BrushTool';
import { dataUriToBase64 } from '../models/ImageService';
import {
  beginImageDelete,
  copyImagesRecorded,
  deleteImageFilesRecorded,
  restoreTrashImagesRecorded,
} from '../models/deleteUndo';
import {
  recordImageOrder,
  setImageFavorites,
  toggleGalleryFavorites,
  toggleImageBookmarkRecorded,
  toggleImageFavorite,
} from '../models/imageStateUndo';
import { IMAGE_RETENTION_DAYS } from '../models/TrashService';
import {
  deleteConfirmText,
  imageCopyResultText,
  imageDeleteScopeLine,
  imageRestoreResultText,
  NO_IMAGES_TO_DELETE_MESSAGE,
  NO_SELECTED_IMAGES_MESSAGE,
  planGridImageDelete,
  shouldSkipImageDeleteConfirm,
  showImageDeleteSkipOption,
} from '../models/deleteFlowRules';
import { EMPTY_TRASH_EXTRA, trashNoticeText } from './TrashViews';
import { getResultDirectory } from '../models/SessionService';
import { extractPromptDataFromBase64 } from '../models/util';
import { appState } from '../models/AppService';
import { backStackService, useBackLayer } from '../models/BackStackService';
import { observer } from 'mobx-react-lite';
import { DownloadDialog } from './DownloadDialog';
import { Session, GenericScene as GenericSceneType } from '../models/types';
import { BOOST_TEXT } from '../models/boostMode';

// ===== TrashImageView 컴포넌트 =====

interface TrashImageViewProps {
  session: Session;
  scene: GenericSceneType;
  imageSize: number;
}

const TrashImageView = ({ session, scene, imageSize }: TrashImageViewProps) => {
  const [trashImages, setTrashImages] = useState<
    { filename: string; deletedAt: number }[]
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const thumbnailLoadGenerationRef = useRef(0);
  const thumbnailLoadPromiseRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await trashService.getTrashImages(session, scene);
      setTrashImages(items);
      // 기존 선택 중 유효하지 않은 것 제거
      setSelected((prev) => {
        const validNames = new Set(items.map((i) => i.filename));
        const next = new Set<string>();
        prev.forEach((f) => {
          if (validNames.has(f)) next.add(f);
        });
        return next;
      });
    } catch (e) {
      setTrashImages([]);
    }
    setLoading(false);
  }, [session, scene]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 썸네일 로드
  useEffect(() => {
    const generation = ++thumbnailLoadGenerationRef.current;
    const loadThumbnails = async () => {
      const newThumbs: Record<string, string> = {};
      for (const item of trashImages) {
        if (generation !== thumbnailLoadGenerationRef.current) break;
        const path = trashService.getTrashImagePath(
          session,
          scene,
          item.filename,
        );
        try {
          const thumb = await imageService.fetchImageSmall(
            path,
            isMobile ? 200 : Math.min(imageSize, 400),
          );
          if (generation !== thumbnailLoadGenerationRef.current) break;
          if (thumb) newThumbs[item.filename] = thumb;
        } catch (e) {}
      }
      if (generation === thumbnailLoadGenerationRef.current) {
        setThumbnails(newThumbs);
      }
    };
    if (trashImages.length > 0) {
      const promise = loadThumbnails();
      thumbnailLoadPromiseRef.current = promise;
      void promise.finally(() => {
        if (thumbnailLoadPromiseRef.current === promise) {
          thumbnailLoadPromiseRef.current = null;
        }
      });
    } else {
      setThumbnails({});
    }
    return () => {
      if (thumbnailLoadGenerationRef.current === generation) {
        thumbnailLoadGenerationRef.current++;
      }
    };
  }, [trashImages, session, scene, imageSize]);

  // 삭제/복원 전에 진행 중인 썸네일 한 장만 마치고 다음 리사이즈를 중단한다.
  // Android에서 삭제 루프와 썸네일 루프가 같은 mutex를 번갈아 잡는 현상을 방지한다.
  const stopThumbnailLoading = useCallback(async () => {
    thumbnailLoadGenerationRef.current++;
    const current = thumbnailLoadPromiseRef.current;
    if (current) {
      try {
        await current;
      } catch (e) {}
    }
  }, []);

  const toggleSelect = (filename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(trashImages.map((i) => i.filename)));
  };

  const handleRestore = async () => {
    if (selected.size === 0) return;
    await stopThumbnailLoading();
    // 복원된 것이 있으면 되돌리기 기록(U4 — 되돌림 = 다시 휴지통으로)
    const { restored, failed } = await restoreTrashImagesRecorded(
      session,
      scene,
      Array.from(selected),
    );
    await imageService.refresh(session, scene);
    appState.pushMessage(imageRestoreResultText(restored.length, failed.length));
    // 복원하지 못한 것만 선택으로 남긴다(무엇이 남았는지 보이도록).
    setSelected(new Set(failed));
    await refresh();
  };

  const handlePermanentDelete = async () => {
    if (selected.size === 0) return;
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({ kind: 'image', count: selected.size, outcome: 'permanent' }),
      callback: async () => {
        await stopThumbnailLoading();
        // 일괄 작업 잠금(2026-07-18): 저사양(특히 모바일) 보호 — finally 해제 보장
        const lockText = '이미지 영구 삭제 중...';
        appState.setProgressDialog({
          text: lockText,
          done: 0,
          total: selected.size,
        });
        let failed = 0;
        try {
          failed = await trashService.permanentlyDeleteImages(
            session,
            scene,
            Array.from(selected),
            (done, total) =>
              appState.setProgressDialog({ text: lockText, done, total }),
          );
        } finally {
          appState.setProgressDialog(undefined);
        }
        if (failed > 0) {
          appState.pushMessage(
            failed + '장의 이미지를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.',
          );
        }
        setSelected(new Set());
        await refresh();
      },
    });
  };

  const handleEmptyTrash = async () => {
    if (trashImages.length === 0) return;
    appState.pushDialog({
      type: 'confirm',
      ...deleteConfirmText({
        kind: 'image',
        count: trashImages.length,
        outcome: 'permanent',
        extra: EMPTY_TRASH_EXTRA,
      }),
      callback: async () => {
        await stopThumbnailLoading();
        // 일괄 작업 잠금(2026-07-18): 저사양(특히 모바일) 보호 — finally 해제 보장
        const lockText = '휴지통 비우는 중...';
        appState.setProgressDialog({
          text: lockText,
          done: 0,
          total: trashImages.length,
        });
        let failed = 0;
        try {
          failed = await trashService.emptyImageTrash(session, scene, (done, total) =>
            appState.setProgressDialog({ text: lockText, done, total }),
          );
        } finally {
          appState.setProgressDialog(undefined);
        }
        if (failed > 0) {
          appState.pushMessage(
            failed + '장의 이미지를 삭제하지 못했습니다. 잠시 후 다시 시도해주세요.',
          );
        }
        setSelected(new Set());
        await refresh();
      },
    });
  };

  const formatDate = (ts: number) => {
    if (!ts) return '알 수 없음';
    const d = new Date(ts);
    return (
      d.toLocaleDateString() +
      ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    );
  };

  const cellSize = isMobile ? imageSize / 2.5 : Math.min(imageSize, 400);

  // 보존 기간 안내(2026-10-03 E1-5) — 씬·프로젝트 휴지통(TrashViews notice)과 같은 형식, 일수는 TrashService 상수
  const retentionNotice = trashNoticeText('image');

  if (trashImages.length === 0 && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-4">
        <div className="text-faint text-lg">휴지통이 비어있습니다</div>
        <div className="mt-2 text-xs text-faint break-keep">{retentionNotice}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none px-2 pt-2 text-xs text-faint break-keep">{retentionNotice}</div>
      <div className="flex-none p-2 flex gap-2 flex-wrap border-b line-color">
        <button
          className={`round-button back-green`}
          onClick={handleRestore}
          disabled={selected.size === 0}
        >
          <ActionIcon id="restore" className="mr-1" />
          선택 복원 ({selected.size})
        </button>
        <button className={`round-button back-gray`} onClick={selectAll}>
          전체 선택
        </button>
        <button
          className={`round-button back-red`}
          onClick={handlePermanentDelete}
          disabled={selected.size === 0}
        >
          선택 영구 삭제
        </button>
        <button
          className={`round-button back-red ml-auto`}
          onClick={handleEmptyTrash}
        >
          <FaTrash className="mr-1" />
          휴지통 비우기
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="flex flex-wrap gap-1 p-2">
          {trashImages.map((item) => {
            const isSelected = selected.has(item.filename);
            return (
              <div
                key={item.filename}
                className={
                  'relative cursor-pointer hover:brightness-95 active:brightness-90 ' +
                  (isSelected ? 'ring-2 ring-sky-500' : '')
                }
                style={{ width: cellSize, height: cellSize }}
                onClick={() => toggleSelect(item.filename)}
              >
                {thumbnails[item.filename] ? (
                  <img
                    src={thumbnails[item.filename]}
                    className="w-full h-full object-contain bg-checkboard"
                    draggable={false}
                  />
                ) : (
                  <div className="w-full h-full bg-[var(--c-surface)] flex items-center justify-center text-faint">
                    ...
                  </div>
                )}
                {isSelected && (
                  <div className="absolute left-0 top-0 z-10 bg-sky-500 opacity-40 w-full h-full" />
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-60 text-white text-xs px-1 py-0.5 truncate">
                  {formatDate(item.deletedAt)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface ImageGalleryProps {
  scene: GenericScene;
  filePaths: string[];
  imageSize: number;
  onSelected?: (path: string, event?: GridModifiers) => void;
  isMainImage?: (path: string) => boolean;
  imageOwners: ReadonlyMap<string, GenericScene>;
  variantCounts: ReadonlyMap<string, number>;
  onOpenVariants: (path: string) => void;
  onReorderImages?: (from: string, to: string, visible: string[], group: string[]) => Promise<void>;
  onFilenameChange?: (src: string, dst: string) => void;
  pageSize?: number;
  isHidden?: boolean;
  selectMode?: boolean;
  selectedImages: Set<string>;
  bookmarkedImagePath?: string;
  focusedIndex?: number | null;
  onSelectedImagesChange?: (paths: string[], deselect: boolean, additive?: boolean) => void;
  onClearSelection?: () => void;
  emptyText?: string;
  emptyHint?: string;
}

interface ImageGalleryRef {
  refresh: () => void;
  refeshImage(path: string): void;
  scrollToIndex(index: number, align?: 'auto' | 'center'): void;
  getColumnCount(): number;
  getItemCount(): number;
}

export const CellPreview = ({
  path,
  cellSize,
  imageSize,
  style,
}: {
  path: string;
  cellSize: number;
  imageSize: number;
  style: React.CSSProperties;
}) => {
  const [image, setImage] = useState<string | undefined>(undefined);
  useEffect(() => {
    const fetchImage = async () => {
      try {
        const base64Image = await imageService.fetchImageSmall(
          path,
          imageSize,
        )!;
        setImage(base64Image!);
      } catch (e: any) {
        setImage(undefined);
      }
    };
    fetchImage();
  }, [path, imageSize]);

  return (
    <div className="relative" style={style}>
      {image && (
        <img
          draggable={false}
          src={image}
          style={{
            maxWidth: cellSize,
            maxHeight: cellSize,
          }}
          className="image-anime relative bg-checkboard w-auto h-auto"
        />
      )}
    </div>
  );
};

const Cell = memo(
  ({ columnIndex, rowIndex, style, data }: GridChildComponentProps) => {
    const {
      scene,
      filePaths,
      onSelected,
      columnCount,
      refreshImageFuncs,
      isMainImage,
      onFilenameChange,
      imageSize,
      selectedImages,
      bookmarkedImagePath,
      focusedIndex,
      onCellEnter,
      onCellLeave,
      selectMode,
      imageOwners,
      variantCounts,
      onOpenVariants,
      reorderDrag,
    } = data as any;

    const { curSession } = appState;
    const index = rowIndex * columnCount + columnIndex;
    const path = filePaths[index];
    const owner = imageOwners.get(path) ?? scene;
    const variantCount = variantCounts.get(path) ?? 0;
    const isFocused = focusedIndex === index;

    const [image, setImage] = useState<string | undefined>(undefined);
    const [_, forceUpdate] = useState<{}>({});
    useEffect(() => {
      if (!path) {
        setImage(undefined);
        return;
      }
      // 늦게 도착한 이전 요청이 새 셀 내용 위에 덮어써 잔상이 남지 않도록
      // 언마운트/의존성 변경 시 진행 중 요청 결과를 버린다.
      let cancelled = false;
      const refreshImage = async () => {
        try {
          const base64Image = await imageService.fetchImageSmall(
            path,
            imageSize,
          )!;
          if (cancelled) return;
          setImage(base64Image!);
        } catch (e: any) {
          if (cancelled) return;
          setImage(undefined);
        }
        forceUpdate({});
      };
      const dispose = reaction(
        () => owner.mains.join(''),
        () => {
          forceUpdate({});
        },
      );
      const refreshMainImage = () => {
        forceUpdate({});
      };
      refreshImageFuncs.current.set(path, refreshImage);

      sessionService.addEventListener('main-image-updated', refreshMainImage);
      refreshImage();
      return () => {
        cancelled = true;
        refreshImageFuncs.current.delete(path);
        sessionService.removeEventListener(
          'main-image-updated',
          refreshMainImage,
        );
        dispose();
      };
    }, [data, imageSize, owner, path]);

    const isMain = !!(isMainImage && path && isMainImage(path));
    const isBookmarked = !!(path && bookmarkedImagePath === path);
    let cellSize = isMobile ? imageSize / 2.5 : imageSize;
    if (isMobile && imageSize === 500) {
      cellSize = style.width;
    }

    const { show, hideAll } = useContextMenu({
      id: ContextMenuType.GallaryImage,
    });

    const [{ isDragging }, drag, preview] = useDrag(
      () => ({
        type: 'image',
        item: { scene: owner, path, cellSize, imageSize, index },
        canDrag: () => isMobile && !selectMode && index < filePaths.length,
        collect: (monitor) => {
          const diff = monitor.getDifferenceFromInitialOffset();
          if (diff) {
            const dist = Math.sqrt(diff.x ** 2 + diff.y ** 2);
            if (dist > 20) {
              hideAll();
            }
          }
          return {
            isDragging: monitor.isDragging(),
          };
        },
      }),
      [owner, path, imageSize, index, selectMode],
    );

    const [{ isOver }, drop] = useDrop(
      () => ({
        accept: 'image',
        canDrop: (item: { scene: GenericScene }) =>
          item.scene === owner && index < filePaths.length,
        collect: (monitor) => {
          if (monitor.isOver()) {
            return {
              isOver: true,
            };
          }
          return { isOver: false };
        },
        drop: async (item: any, monitor) => {
          const mscene = owner;
          let { path: draggedPath, index: draggedIndex } = item;
          draggedPath = draggedPath.split('/').pop()!;
          const dropPath = path.split('/').pop()!;

          if (draggedPath !== dropPath) {
            // 되돌리기 기록(U3a): 순서 사본·순위 깊은 사본 — 되돌림은 병합 복원(그사이 생성된 이미지 유지)
            await recordImageOrder(curSession!, mscene, async () => {
              const getPlayer = (path: string) => {
                if (mscene.game) {
                  for (const player of mscene.game) {
                    if (player.path === path) {
                      return player;
                    }
                  }
                }
                return undefined;
              };
              const draggedPlayer = getPlayer(draggedPath);
              const dropPlayer = getPlayer(dropPath);
              if (draggedPlayer) {
                mscene.game!.splice(mscene.game!.indexOf(draggedPlayer), 1);
              }
              if (dropPlayer) {
                mscene.game!.push({
                  path: draggedPath,
                  rank: dropPlayer.rank,
                });
              }
              if (draggedPlayer || dropPlayer) {
                gameService.cleanGame(mscene.game!);
                mscene.round = undefined;
              }
              const draggedImageIndex = mscene.imageMap.indexOf(draggedPath);
              mscene.imageMap.splice(draggedImageIndex, 1);
              const dropImageIndex = mscene.imageMap.indexOf(dropPath);
              if (draggedIndex < index) {
                mscene.imageMap.splice(dropImageIndex, 0, draggedPath);
              } else {
                mscene.imageMap.splice(dropImageIndex + 1, 0, draggedPath);
              }
              await imageService.refresh(curSession!, mscene);
            });
          }
        },
      }),
      [owner, path, imageSize, index, filePaths.length],
    );

    useEffect(() => {
      preview(getEmptyImage(), { captureDraggingState: true });
    }, [preview]);

    return (
      <div
        key={index.toString() + path + imageSize.toString()}
        data-image-index={index}
        data-image-card={path ? "" : undefined}
        style={style}
        className={
          'image-cell relative hover:brightness-95 active:brightness-90 bg-[var(--c-surface)] cursor-pointer ' +
          ((isDragging || reorderDrag?.items.includes(path)) ? 'opacity-30 no-touch' : '') +
          ((path && (isOver || reorderDrag?.target === path)) ? ' border-2 border-sky-500' : '')
        }
        draggable={isMobile && !selectMode}
        onClick={(event) => {
          if (path) {
            if (onSelected) {
              onSelected(path, event);
            }
          }
        }}
        onMouseEnter={() => onCellEnter?.(index)}
        onMouseLeave={() => onCellLeave?.(index)}
        ref={(node) => drag(drop(isMobile && !selectMode ? node : null))}
      >
        {path && image && (
          <>
            <div data-image-content className="relative w-fit">
              <img
                src={image}
                style={{
                  maxWidth: cellSize,
                  maxHeight: cellSize,
                }}
                draggable={false}
                onContextMenu={(e) => {
                  show({
                    event: e,
                    props: {
                      ctx: {
                        type: 'gallary_image',
                        path: [path],
                        scene: owner,
                        starable: true,
                        exportImages: new Map([[owner, [path]]]),
                      },
                    },
                  });
                }}
                className={
                  'image-anime relative bg-checkboard w-auto h-auto ' +
                  (isMain ? 'border-2 border-yellow-400' : '')
                }
              />
              {isMain && (
                <div className="absolute left-0 top-0 z-10 text-yellow-400 m-2 text-md ">
                  <FaStar />
                </div>
              )}
              {isBookmarked && (
                <div className="absolute right-0 top-0 z-10 text-orange-500 m-2 text-md">
                  <ActionIcon id="bookmark" />
                </div>
              )}
              {owner !== scene && (
                <span className="absolute bottom-1 left-1 bg-[var(--c-surface)] text-sub rounded px-2 py-0.5 text-xs pointer-events-none" title={owner.name}>
                  변형
                </span>
              )}
              {variantCount>0&&<span className="absolute bottom-1 right-1 z-10 round-button back-sky text-xs pointer-events-none" title={'연결된 인페인트·I2I 작업 '+variantCount+'개'}>변형 {variantCount}개</span>}
              {selectedImages.has(path) && (
                <div
                  className="absolute left-0 top-0 z-10 bg-sky-500 opacity-50 text-md w-full h-full"
                  onContextMenu={(e) => {
                    const visiblePaths = new Set<string>(filePaths);
                    const selectedPaths = Array.from(selectedImages as Set<string>)
                      .filter((image) => visiblePaths.has(image));
                    const exportImages = groupImagePaths(selectedPaths, imageOwners);
                    show({
                      event: e,
                      props: {
                        ctx: {
                          type: 'gallary_image',
                          path: exportImages.get(owner) ?? [path],
                          scene: owner,
                          starable: true,
                          exportImages,
                        },
                      },
                    });
                  }}
                ></div>
              )}
            </div>
          </>
        )}
        {path && isFocused && (
          <div className="absolute inset-0 border-4 border-sky-400 z-20 pointer-events-none rounded-sm" />
        )}
      </div>
    );
  },
  areEqual,
);

const CustomScrollbarsVirtualGrid = memo(
  forwardRef((props, ref) => (
    <CustomScrollbars {...props} forwardedRef={ref} />
  )),
);

const createItemData = memoizeOne(
  (
    scene,
    filePaths,
    onSelected,
    columnCount,
    refreshImageFuncs,
    draggedIndex,
    isMainImage,
    onFilenameChange,
    imageSize,
    selectedImages,
    bookmarkedImagePath,
    focusedIndex,
    onCellEnter,
    onCellLeave,
    selectMode,
    imageOwners,
    variantCounts,
    onOpenVariants,
    reorderDrag,
  ) => {
    return {
      scene,
      filePaths,
      onSelected,
      columnCount,
      refreshImageFuncs,
      draggedIndex,
      isMainImage,
      onFilenameChange,
      imageSize,
      selectedImages,
      bookmarkedImagePath,
      focusedIndex,
      onCellEnter,
      onCellLeave,
      selectMode,
      imageOwners,
      variantCounts,
      onOpenVariants,
    reorderDrag,
    };
  },
);

const ImageGallery = forwardRef<ImageGalleryRef, ImageGalleryProps>(
  (
    {
      scene,
      isHidden,
      imageSize,
      filePaths,
      isMainImage,
      onSelected,
      selectMode,
      selectedImages,
      onFilenameChange,
      bookmarkedImagePath,
      focusedIndex,
      onSelectedImagesChange,
      onClearSelection,
      emptyText,
      emptyHint,
      imageOwners,
      variantCounts,
      onOpenVariants,
      onReorderImages,
    },
    ref,
  ) => {
    const activeView = useContext(FloatViewActiveContext);
    const { curSession } = appState;
    const [containerWidth, setContainerWidth] = useState(0);
    const [containerHeight, setContainerHeight] = useState(0);
    const refreshImageFuncs = useRef(new Map<string, () => void>());
    const draggedIndex = useRef<number | null>(null);
    const hoveredIndexRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<any>(null);
    const imageScrollRef = useRef<HTMLDivElement>(null);

    type DragBox = {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      deselect: boolean;
      additive?: boolean;
    };
    const [dragBox, setDragBox] = useState<DragBox | null>(null);
    // 드래그 중 window 리스너가 최신 좌표를 읽을 수 있도록 ref 로도 동기화한다.
    const dragBoxRef = useRef<DragBox | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const isDraggingRef = useRef(false);
    const wasDraggingRef = useRef(false);

    useImperativeHandle(ref, () => ({
      refresh: () => {
        refreshImageFuncs.current.forEach((refresh) => refresh());
      },
      refeshImage: (path: string) => {
        const refresh = refreshImageFuncs.current.get(path);
        if (refresh) {
          refresh();
        }
      },
      scrollToIndex: (index: number, align = 'center') => {
        if (gridRef.current && columnCount > 0) {
          const rowIndex = Math.floor(index / columnCount);
          gridRef.current.scrollToItem({ rowIndex, align });
        }
      },
      getColumnCount: () => columnCount,
      getItemCount: () => filePaths.length,
    }));

    useEffect(() => {
      const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          setContainerWidth(entry.contentRect.width);
          setContainerHeight(entry.contentRect.height);
        }
      });
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
      return () => resizeObserver.disconnect();
    }, []);

    let columnWidth = isMobile ? imageSize / 2.5 : imageSize;
    let rowHeight = isMobile ? imageSize / 2.5 : imageSize;
    if (isMobile && imageSize === 500) {
      columnWidth = containerWidth - 10;
      rowHeight = containerWidth - 10;
    }
    const columnCount = Math.max(1, Math.floor(containerWidth / columnWidth));
    // preload 4 pages
    const overcountCounts = isMobile ? [4, 2, 1] : [32, 16, 8];

    const onCellEnter = useCallback((index: number) => {
      hoveredIndexRef.current = index;
    }, []);
    const onCellLeave = useCallback((index: number) => {
      if (hoveredIndexRef.current === index) {
        hoveredIndexRef.current = null;
      }
    }, []);

    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (e.key !== 'f' && e.key !== 'F') return;
        if (isHidden || !activeView) return;
        if (appState.dialogs.length > 0) return; // 확인 창 위에서 즐겨찾기가 바뀌지 않게(U0-b E8)
        const idx = hoveredIndexRef.current;
        if (idx == null || idx >= filePaths.length) return;
        const tag = (e.target as HTMLElement)?.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          (e.target as HTMLElement)?.isContentEditable
        )
          return;
        e.preventDefault();
        const path = filePaths[idx];
        if (!path) return;
        const filename = path.split('/').pop()!;
        // 창 간 동기화 헬퍼(읽기 전용 미러): 소유 창 위임 + 로컬 반영 + 되돌리기 기록(U3a)
        const owner = imageOwners.get(path);
        if (owner) toggleImageFavorite(curSession!, owner, filename);
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }, [filePaths, imageOwners, curSession, isHidden, activeView]);

    // clientX/Y 를 컨테이너 기준 좌표로 변환 + 컨테이너 범위로 클램프.
    // (그리드 밖으로 끌어도 드래그가 유지되며, 박스는 가장자리에 머문다)
    const toContainerXY = (clientX: number, clientY: number) => {
      const el = containerRef.current!;
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(clientX - r.left, r.width)),
        y: Math.max(0, Math.min(clientY - r.top, r.height)),
      };
    };

    const reorder = useGridReorder<string>({
      enabled: !isMobile && !isHidden && activeView,
      scope: scene, viewport: imageScrollRef, cardSelector: '[data-image-card]',
      resolve: card => filePaths[Number(card.dataset.imageIndex)],
      selected: path => selectedImages.has(path) ? filePaths.filter(item => selectedImages.has(item)) : [path],
      suppressClick: wasDraggingRef,
      commit: (from, to, group) => {
        if (!filePaths.includes(from) || !filePaths.includes(to) || !onReorderImages) return;
        void onReorderImages(from, to, filePaths, group).catch(error => {
          console.error(error); appState.pushMessage('이미지 순서를 바꾸지 못했습니다.', 'error');
        });
      },
    });

    const handleGridMouseDown = (e: React.MouseEvent) => {
      if (e.button !== 0 || dragBoxRef.current || isHidden) return;
      if (!canStartSelectionBox(e.target, isMobile ? !!selectMode : false, '[data-image-content]')) return;
      if (!containerRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = toContainerXY(e.clientX, e.clientY);
      const start: DragBox = {
        x1: x,
        y1: y,
        x2: x,
        y2: y,
        deselect: e.shiftKey || e.ctrlKey,
        additive: !!(e.shiftKey || e.ctrlKey || e.metaKey),
      };
      dragBoxRef.current = start;
      setDragBox(start);
      isDraggingRef.current = false;
      wasDraggingRef.current = false;
      // 드래그 추적을 window 로 넘긴다(아래 useEffect). 그리드를 벗어나도
      // 드래그가 끊기지 않고, 실제 mouseup 에서만 종료된다.
      setIsSelecting(true);
    };

    // 박스 선택 진행: window 레벨에서 추적해 프롬프트/스크롤 영역에 닿아도
    // 드래그가 중도 취소되지 않게 한다.
    useEffect(() => {
      if (!isSelecting) return;

      const onMove = (e: MouseEvent) => {
        const start = dragBoxRef.current;
        const el = containerRef.current;
        if (!start || !el) return;
        const r = el.getBoundingClientRect();
        const dx = Math.abs(e.clientX - (start.x1 + r.left));
        const dy = Math.abs(e.clientY - (start.y1 + r.top));
        if (dx > 3 || dy > 3) isDraggingRef.current = true;
        if (!isDraggingRef.current) return;
        const { x, y } = toContainerXY(e.clientX, e.clientY);
        const next: DragBox = { ...start, x2: x, y2: y };
        dragBoxRef.current = next;
        setDragBox(next);
      };

      const onUp = () => {
        wasDraggingRef.current = isDraggingRef.current;
        const box = dragBoxRef.current;
        if (isDraggingRef.current && box) {
          const selected = containerRef.current
            ? imagePathsInSelectionBox(containerRef.current, filePaths, box)
            : [];
          if ((!isMobile || selected.length > 0) && onSelectedImagesChange) {
            onSelectedImagesChange(selected, box.deselect, box.additive);
          }
        }
        dragBoxRef.current = null;
        setDragBox(null);
        isDraggingRef.current = false;
        setIsSelecting(false);
      };

      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      return () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
    }, [isSelecting, filePaths, onSelectedImagesChange]);

    const handleGridClick = (e: React.MouseEvent) => {
      if (wasDraggingRef.current) {
        wasDraggingRef.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (
        e.target === containerRef.current ||
        (e.target as HTMLElement).classList.contains('CustomScrollbars') ||
        ((e.target as HTMLElement).tagName === 'DIV' &&
          !(e.target as HTMLElement).closest('.image-cell'))
      ) {
        if (onClearSelection) {
          onClearSelection();
        }
      }
    };

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        aria-label="이미지 그리드"
        style={{ width: '100%', height: '100%' }}
        className={
          'flex justify-center relative select-none outline-none ' +
          (isHidden ? 'hidden' : '')
        }
        onMouseDownCapture={event => { focusGridSurface(event); reorder.start(event); handleGridMouseDown(event); }}
        onClickCapture={handleGridClick}
      >
        <Grid
          ref={gridRef}
          outerRef={imageScrollRef}
          columnCount={columnCount}
          columnWidth={columnWidth}
          height={containerHeight}
          className={'bg-[var(--c-zone)] ' + (isHidden ? 'hidden' : '')}
          rowCount={Math.ceil(filePaths.length / columnCount)}
          rowHeight={rowHeight}
          width={columnCount * columnWidth}
          itemData={createItemData(
            scene,
            filePaths,
            onSelected,
            columnCount,
            refreshImageFuncs,
            draggedIndex,
            isMainImage,
            onFilenameChange,
            imageSize,
            selectedImages,
            bookmarkedImagePath,
            focusedIndex ?? null,
            onCellEnter,
            onCellLeave,
            selectMode,
            imageOwners,
            variantCounts,
            onOpenVariants,
            reorder.drag,
          )}
          // 셀 키를 위치가 아닌 이미지 경로 기준으로 — 목록이 바뀌면 셀이
          // 언마운트되어 이전 이미지 state(잔상)가 재사용되지 않는다.
          itemKey={({ columnIndex, rowIndex, data }: any) => {
            const idx = rowIndex * data.columnCount + columnIndex;
            return data.filePaths[idx] ?? `empty-${rowIndex}:${columnIndex}`;
          }}
          outerElementType={CustomScrollbarsVirtualGrid}
          overscanRowCount={overcountCounts[Math.ceil(imageSize / 200) - 1]}
        >
          {Cell}
        </Grid>
        {reorder.drag && <ReorderDragPreview type="image" drag={reorder.drag} />}
        {filePaths.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-faint text-sm select-none pointer-events-none">
            <span>{emptyText ?? '이미지가 없습니다'}</span>
            {emptyHint && <span>{emptyHint}</span>}
          </div>
        )}
        {dragBox && isDraggingRef.current && (
          <div
            className="absolute bg-sky-500/30 border-2 border-sky-500 rounded pointer-events-none z-50"
            style={{
              left: Math.min(dragBox.x1, dragBox.x2),
              top: Math.min(dragBox.y1, dragBox.y2),
              width: Math.abs(dragBox.x2 - dragBox.x1),
              height: Math.abs(dragBox.y2 - dragBox.y1),
            }}
          />
        )}
      </div>
    );
  },
);

interface ResultDetailViewButton {
  text: string | ((path: string) => string);
  className: string;
  onClick: (scene: GenericScene, path: string, close: () => void) => void;
}

interface SceneNavigation { hasPrev: boolean; hasNext: boolean; go: (delta: number, keepDetail?: boolean) => void }

interface ResultDetailViewProps {
  sceneNav?: SceneNavigation;
  session?: Session;
  scene: GenericScene;
  getPaths: () => string[];
  initialSelectedIndex: number;
  buttons: ResultDetailViewButton[];
  onClose: () => void;
  onViewedImageChange?: (path: string | undefined) => void;
  historyEntry?: GenerationHistoryEntry;
  imageOwners?: ReadonlyMap<string, GenericScene>;
  variantCounts?: ReadonlyMap<string, number>;
  onOpenVariants?: (path: string) => void;
}
// 모바일 V2 이미지 그리드 하단 줄 높이(V2MainRow 46px 칸 + 위 3px·아래 2px 여백 + 위 테두리 1px) — S/M/L 을 이 위로 올린다
const V2_GALLERY_BAR_PX = 52;
const SCENE_IMAGE_FILTERS: { value: SceneImageFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'original', label: '원본' },
  { value: 'variant', label: '변형' },
];

function resultSceneLabel(scene: GenericScene) {
  if (scene.type === 'scene') return '일반 씬';
  const title = workFlowService.getDef(scene.workflowType)?.title;
  return title ? title + ' 씬' : '변형 씬';
}

export const ResultDetailView = observer(
  ({
    scene: sourceScene,
    buttons,
    getPaths,
    initialSelectedIndex,
    onClose,
    onViewedImageChange,
    historyEntry,
    sceneNav,
    imageOwners,
    variantCounts,
    onOpenVariants,
    session = appState.curSession!,
  }: ResultDetailViewProps) => {
    const activeView = useContext(FloatViewActiveContext);
    const appliedCharacterPreset = session === appState.curSession
      ? appState.getAppliedCharacterPreset()
      : undefined;

    // 단축키 시스템에 ResultViewer 열림 상태 전달
    useEffect(() => {
      if (!activeView) return;
      appState.resultViewerOpen = true;
      return () => {
        appState.resultViewerOpen = false;
      };
    }, [activeView]);
    const [selectedIndex, setSelectedIndex] =
      useState<number>(initialSelectedIndex);
    const [paths, setPaths] = useState<string[]>(getPaths());
    const viewedImagePath = paths[selectedIndex];
    const scene = imageOwners?.get(viewedImagePath) ?? sourceScene;
    const variantCount = variantCounts?.get(viewedImagePath) ?? 0;
    const [variantChoices,setVariantChoices]=useState(false);
    const [variantBusy,setVariantBusy]=useState(false);
    const [editingWork,setEditingWork]=useState<InpaintScene|null>(null);
    const workRequest=useRef(false);
    useEffect(()=>{setVariantChoices(false);},[viewedImagePath]);
    const editVariant=async(type:string)=>{
      if(session!==appState.curSession){appState.pushMessage('이 이미지의 프로젝트를 연 뒤 편집 작업을 열어 주세요.');return;}
      if(workRequest.current||!viewedImagePath)return;
      workRequest.current=true;setVariantBusy(true);
      try{await openSourceVariant(session,scene,type,viewedImagePath,setEditingWork);setVariantChoices(false);}
      catch(error){appState.pushMessage((error as Error).message,'error');}
      finally{workRequest.current=false;setVariantBusy(false);}
    };
    const quickVariant=async(flow:QuickVariantFlow)=>{
      if(workRequest.current||!viewedImagePath)return;
      workRequest.current=true;setVariantBusy(true);
      try{
        const data=await imageService.fetchImage(viewedImagePath);if(!data)throw new Error('변형할 이미지를 찾을 수 없습니다.');
        const base64=dataUriToBase64(data),metadata=await extractPromptDataFromBase64(base64);
        const input=flow.getInput?await flow.getInput(session):undefined;
        if(flow.getInput&&input==null)return;
        await flow.handler(session,scene,base64,undefined,metadata,input);setVariantChoices(false);
      }catch(error){appState.pushMessage((error as Error).message,'error');}
      finally{workRequest.current=false;setVariantBusy(false);}
    };
    useLayoutEffect(() => {
      onViewedImageChange?.(viewedImagePath);
    }, [onViewedImageChange, viewedImagePath]);
    const [filename, setFilename] = useState<string>(
      viewedImagePath?.split('/').pop() ?? '',
    );
    const [image, setImage] = useState<string | undefined>(undefined);
    const [imageLoadFailed, setImageLoadFailed] = useState(false);
    const [upscalePreparing, setUpscalePreparing] = useState(false);
    const [restoringMetadata, setRestoringMetadata] = useState(false);
    const [upscaleInfo, setUpscaleInfo] = useState<{ path: string; cost?: number; error?: string }>();
    const [imageRetryRevision, setImageRetryRevision] = useState(0);
    const watchedImages = useRef(new Set<string>());
    // 모바일 좌우 스와이프로 이미지 전환. 시작 좌표를 저장해 끝점과 비교한다.
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const [middlePrompt, setMiddlePrompt] = useState<string>('');
    const [characterPrompts, setCharacterPrompts] = useState<CharacterPrompt[]>(
      [],
    );
    const [seed, setSeed] = useState<string>('');
    const [scale, setScale] = useState<string>('');
    const [sampler, setSampler] = useState<string>('');
    const [steps, setSteps] = useState<string>('');
    const [uc, setUc] = useState<string>('');
    const [_, forceUpdate] = useState<{}>({});
    useEffect(() => {
      if (!viewedImagePath) return;
      let request = 0;
      const fetchImage = async () => {
        const currentRequest = ++request;
        setImage(undefined);
        setImageLoadFailed(false);
        setUpscaleInfo(undefined);
        try {
          const fullImage = await imageService.fetchImage(viewedImagePath);
          if (currentRequest !== request) return;
          if (!fullImage) {
            throw new Error('이미지 파일을 찾을 수 없습니다.');
          }
          setImage(fullImage);
          const base64Image = dataUriToBase64(fullImage);
          void getImageDimensions(base64Image).then(({ width, height }) => {
            const cost = estimateNaiUpscaleCost(width, height);
            if (currentRequest === request) setUpscaleInfo({ path: viewedImagePath, cost });
          }).catch((e) => {
            if (currentRequest === request) setUpscaleInfo({ path: viewedImagePath, error: e?.message ?? '이미지 확인 실패' });
          });
          try {
            const job = await extractPromptDataFromBase64(base64Image);
            if (currentRequest !== request) return;
            if (job) {
              const { prompt, seed, promptGuidance, sampling, steps, uc } = job;
              setMiddlePrompt(prompt);
              setCharacterPrompts(job.characterPrompts);
              setSeed(seed?.toString() ?? '');
              setScale(promptGuidance.toString());
              setSampler(sampling);
              setSteps(steps.toString());
              setUc(uc);
            } else {
              setMiddlePrompt('');
              setCharacterPrompts([]);
              setSeed('');
              setScale('');
              setSampler('');
              setSteps('');
              setUc('');
            }
          } catch (e: any) {
            if (currentRequest !== request) return;
            setMiddlePrompt('');
            setCharacterPrompts([]);
            setSeed('');
            setScale('');
            setSampler('');
            setSteps('');
            setUc('');
          }
          setFilename(viewedImagePath.split('/').pop()!);
        } catch (e: any) {
          if (currentRequest !== request) return;
          console.log(e);
          setImage(undefined);
          setImageLoadFailed(true);
          setMiddlePrompt('');
          setCharacterPrompts([]);
          setSeed('');
          setScale('');
          setSampler('');
          setSteps('');
          setUc('');
          setFilename('');
        }
      };
      const onImageInvalidated = (event: Event) => {
        const detail = (event as CustomEvent<{ path: string; paths?: string[] }>).detail;
        if (detail?.path === viewedImagePath || detail?.paths?.includes(viewedImagePath)) {
          void fetchImage();
        }
      };
      void fetchImage();
      imageService.addEventListener('image-cache-invalidated', onImageInvalidated);
      return () => {
        request++;
        imageService.removeEventListener('image-cache-invalidated', onImageInvalidated);
      };
    }, [viewedImagePath, imageRetryRevision]);

    useEffect(() => {
      const rerender = () => {
        forceUpdate({});
      };
      const handleKeyDown = async (e: KeyboardEvent) => {
        if (!activeView) return;
        if (['ArrowLeft','ArrowRight'].includes(e.key) && (e.ctrlKey||e.metaKey||e.altKey)) return;
        // 입력 칸 포커스 중엔 전부, 확인 창이 열려 있으면 Delete/Backspace 무시(2026-11-01 U0-b E7)
        if (
          shouldIgnoreViewerRawKey(e.key, {
            inputFocused: isTextEntryFocused(),
            dialogOpen: appState.dialogs.length > 0,
          })
        )
          return;
        if (e.key === 'ArrowLeft') {
          setSelectedIndex((selectedIndex - 1 + paths.length) % paths.length);
        } else if (e.key === 'ArrowRight') {
          setSelectedIndex((selectedIndex + 1) % paths.length);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          const doDel = async () => {
            await deleteImageFilesRecorded(session, [paths[selectedIndex]], scene);
          };
          if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)) {
            await doDel();
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            ...deleteConfirmText({ kind: 'image', outcome: { trashDays: IMAGE_RETENTION_DAYS } }),
            showSkipConfirm: showImageDeleteSkipOption(1),
            callback: doDel,
          });
        }
      };
      const handleShortcut = async (e: Event) => {
        if (!activeView) return;
        const action = (e as CustomEvent).detail?.action;
        if (action === 'image-prev-scene' || action === 'image-next-scene') {
          if (!isTextEntryFocused() && !appState.dialogs.length) sceneNav?.go(action === 'image-prev-scene' ? -1 : 1, true);
          return;
        }
        if (action === 'prev-image') {
          setSelectedIndex((selectedIndex - 1 + paths.length) % paths.length);
        } else if (action === 'next-image') {
          setSelectedIndex((selectedIndex + 1) % paths.length);
        } else if (action === 'delete-image') {
          const doDel = async () => {
            await deleteImageFilesRecorded(session, [paths[selectedIndex]], scene);
          };
          if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)) {
            await doDel();
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            ...deleteConfirmText({ kind: 'image', outcome: { trashDays: IMAGE_RETENTION_DAYS } }),
            showSkipConfirm: showImageDeleteSkipOption(1),
            callback: doDel,
          });
        } else if (action === 'toggle-favorite') {
          const path = paths[selectedIndex].split('/').pop()!;
          toggleImageFavorite(session, scene, path);
        } else if (action === 'toggle-bookmark') {
          const filename = paths[selectedIndex]?.split('/').pop();
          if (filename) {
            void toggleImageBookmarkRecorded(session, scene, filename);
          }
        } else if (action === 'save-image') {
          imageDownloadService.downloadSingleImage(
            session,
            scene,
            paths[selectedIndex],
            appliedCharacterPreset,
          );
        }
      };
      const refreshPaths = () => {
        const newPaths = getPaths();
        if (newPaths.length === 0) onClose();
        else {
          const newIndex = newPaths.indexOf(viewedImagePath);
          if (newIndex !== -1) {
            setSelectedIndex(newIndex);
          } else {
            setSelectedIndex((prev) => Math.min(prev, newPaths.length - 1));
          }
          setPaths(newPaths);
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('shortcut-action', handleShortcut);
      sessionService.addEventListener('main-image-updated', rerender);
      gameService.addEventListener('updated', refreshPaths);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('shortcut-action', handleShortcut);
        sessionService.removeEventListener('main-image-updated', rerender);
        gameService.removeEventListener('updated', refreshPaths);
      };
    }, [selectedIndex, paths, activeView, session, scene, appliedCharacterPreset, getPaths, sceneNav]);

    useEffect(() => {
      return () => {
        watchedImages.current.forEach((path) => {
          // invoke('unwatch-image', path);
        });
      };
    });

    const [showPrompt, setShowPrompt] = useState<boolean>(false);
    // 모바일 V2(2026-09-26): 넓은 버튼 묶음 대신 이미지 아래 [자세한 정보 손잡이][하단 6칸 줄]. 클래식·PC 마크업은 불변.
    const v2 = isV2('grid');
    const [v2More, setV2More] = useState(false);
    const { show, hideAll } = useContextMenu({
      id: historyEntry ? ContextMenuType.HistoryImage : ContextMenuType.Image,
    });

    const [bmRev2, setBmRev2] = useState(0);
    useEffect(() => {
      const onBmUpdate = () => setBmRev2((r) => r + 1);
      sessionService.addEventListener('bookmark-updated', onBmUpdate);
      return () =>
        sessionService.removeEventListener('bookmark-updated', onBmUpdate);
    }, []);
    const currentFilename = paths[selectedIndex]?.split('/').pop();
    const isImageBm = !!(
      currentFilename &&
      sessionService.isImageBookmarked(
        session.name,
        scene.name,
        currentFilename,
      )
    );

    if (!paths[selectedIndex]) return null;

    // 버튼 동작(클래식 넓은 버튼과 V2 하단 줄이 공유)
    const actDownloadFile = async () => {
      if (isMobile) {
        await backend.copyToDownloads(paths[selectedIndex]);
      } else {
        await backend.showFile(paths[selectedIndex]);
      }
    };
    const actDeleteFile = () => {
      const doDel = async () => {
        await deleteImageFilesRecorded(session, [paths[selectedIndex]], scene);
      };
      if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)) {
        doDel();
        return;
      }
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({ kind: 'image', outcome: { trashDays: IMAGE_RETENTION_DAYS } }),
        showSkipConfirm: showImageDeleteSkipOption(1),
        callback: doDel,
      });
    };
    const actToggleBookmark = () => {
      if (currentFilename) {
        void toggleImageBookmarkRecorded(session, scene, currentFilename);
      }
    };
    const actCopyImage = () => {
      appState.copyImagesToClipboard([paths[selectedIndex]]);
    };
    const actLoadSettings = () => {
      if (!image) return;
      appState.openExternalImage(
        dataUriToBase64(image),
        session === appState.curSession ? scene : undefined,
      );
    };
    const currentUpscaleInfo = upscaleInfo?.path === viewedImagePath ? upscaleInfo : undefined;
    const upscaleTitle = currentUpscaleInfo?.error ?? '가로·세로 2배 · 원본 유지 · Anlas 사용';
    const upscaleDisabled = upscalePreparing || !currentUpscaleInfo?.cost;
    const upscaleLabel = upscalePreparing
      ? '예약 중…'
      : `업스케일 ×2 · ${currentUpscaleInfo?.cost ? `${currentUpscaleInfo.cost} Anlas` : currentUpscaleInfo?.error ? '미지원' : '…'}`;
    const actUpscale = async () => {
      const path = paths[selectedIndex];
      if (!path || !session || upscalePreparing) return;
      setUpscalePreparing(true);
      try {
        const source = await imageService.fetchImage(path);
        if (!source) throw new Error('원본 이미지를 읽지 못했습니다.');
        await queueNaiUpscale(session, scene, dataUriToBase64(source));
      } catch (e: any) {
        appState.pushMessage(e?.message ?? 'NAI 업스케일을 예약하지 못했습니다.');
      } finally {
        setUpscalePreparing(false);
      }
    };
    const inheritedButtons = scene === sourceScene ? buttons : [{
      className: 'back-orange',
      text: (path: string) => scene.mains.includes(path.split('/').pop()!)
        ? '즐겨찾기 해제'
        : '즐겨찾기 지정',
      onClick: (_scene: GenericScene, path: string) =>
        toggleImageFavorite(session, scene, path.split('/').pop()!),
    }];
    const viewButtons = (inheritedButtons||[]).filter((button:any)=>!(/인페인트|인페인팅|이미지 변형/.test(typeof button.text==='function'?button.text(viewedImagePath):button.text)));
    if(!viewButtons.some((button:any)=>/즐겨찾기/.test(typeof button.text==='function'?button.text(viewedImagePath):button.text)))viewButtons.push({
      className:'back-orange',text:(path:string)=>scene.mains.includes(path.split('/').pop()!)?'즐겨찾기 해제':'즐겨찾기 지정',
      onClick:(_scene:GenericScene,path:string)=>toggleImageFavorite(session,scene,path.split('/').pop()!),
    });
    viewButtons.push({className:'back-green',text:'인페인트 · I2I',onClick:()=>void editVariant('SDInpaint')},
      {className:'back-gray',text:'이미지 변형',onClick:()=>setVariantChoices(value=>!value)});
    const pluginLabel = (b: any) =>
      String(typeof b.text === 'function' ? b.text(paths[selectedIndex]) : b.text);
    const runPlugin = (b: any) => b.onClick(scene, paths[selectedIndex], onClose);

    const restoreEditedMetadata = async () => {
      setRestoringMetadata(true);
      try {
        if (await backend.restoreEditedImageMetadata(paths[selectedIndex])) {
          appState.pushMessage('생성 정보를 복원한 PNG를 저장했습니다.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        appState.pushMessage(message.replace(/^Error invoking remote method '[^']+': Error: /, ''), 'error');
      } finally {
        setRestoringMetadata(false);
      }
    };

    const infoFields = (
      <>
            {editingWork&&<FloatView priority={3} onEscape={()=>setEditingWork(null)}>
              <InPaintEditor editingScene={editingWork} onConfirm={()=>setEditingWork(null)} onDelete={()=>setEditingWork(null)}/>
            </FloatView>}
            {variantChoices && (
              <ImageVariantChoices path={viewedImagePath} busy={variantBusy}
                onWork={editVariant} onQuick={quickVariant}
                onClose={() => setVariantChoices(false)} />
            )}
            <div className="max-w-full mb-2 text-sub">
              <span className="gray-label">파일이름: </span>
              <span className="break-all">{filename}</span>
            </div>
            {/* 부스트 다중 계정 실행으로 만든 이미지만 — 만든 계정(프로필 이름, D8 앱 내부 표식). 메타·내보내기에는 없음. */}
            {scene.imageAccounts?.[filename] && (
              <div className="max-w-full mb-2 text-sub" data-image-account>
                <span className="gray-label">{BOOST_TEXT.accountLabel}: </span>
                <span>{scene.imageAccounts[filename]}</span>
              </div>
            )}
            <div className="w-full mb-2">
              <div className="gray-label">프롬프트 </div>
              <PromptHighlighter
                text={middlePrompt}
                className="w-full h-24 overflow-auto"
              />
            </div>
            <div className="w-full mb-2">
              <div className="gray-label">네거티브 프롬프트 </div>
              <PromptHighlighter
                text={uc}
                className="w-full h-24 overflow-auto"
              />
            </div>
            {characterPrompts.map((prompt, index) => (
              <div
                key={index}
                className="w-full mb-4 border line-color rounded-md r-card p-3"
              >
                <div className="gray-label">캐릭터 프롬프트 </div>
                <PromptHighlighter
                  text={prompt.prompt}
                  className="w-full h-24 overflow-auto"
                />
                <div className="gray-label">네거티브 프롬프트 </div>
                <PromptHighlighter
                  text={prompt.uc}
                  className="w-full h-24 overflow-auto"
                />
              </div>
            ))}
            <div className="w-full mb-2 text-sub">
              <span className="gray-label">시드: </span>
              {seed}
            </div>
            <div className="w-full mb-2 text-sub">
              <span className="gray-label">프롬프트 가이던스: </span>
              {scale}
            </div>
            <div className="w-full mb-2 text-sub">
              <span className="gray-label">샘플러: </span>
              {sampler}
            </div>
            <div className="w-full mb-2 text-sub">
              <span className="gray-label">스텝: </span>
              {steps}
            </div>
            <LinkedImageWorks session={session} scene={scene} path={viewedImagePath}/>
      </>
    );

    // 모바일 V2 하단 6칸 줄(2026-09-26 사용자 결정): 다운로드·삭제·설정 불러오기·즐겨찾기·인페인트+더보기.
    // 즐겨찾기·인페인트는 SceneQueueControl 이 넘기는 plugin 버튼(text 로 식별), 나머지 plugin 은 더보기로.
    const favBtn = v2 ? viewButtons.find((b: any) => /즐겨찾기/.test(pluginLabel(b))) : undefined;
    const inpaintBtn = v2 ? viewButtons.find((b: any) => /인페인/.test(pluginLabel(b))) : undefined;
    const otherBtns = v2 ? viewButtons.filter((b: any) => b !== favBtn && b !== inpaintBtn) : [];
    const detailSlots: V2SlotDef[] = v2
      ? [
          { key: 'download', name: '다운로드', icon: <ActionIcon id="download" />, onTap: () => void actDownloadFile() },
          { key: 'delete', name: '삭제', icon: <ActionIcon id="delete" />, tone: 'danger', onTap: actDeleteFile },
          { key: 'settings', name: '설정 추출', icon: <ActionIcon id="gen-settings" />, onTap: actLoadSettings, disabled: !image },
          {
            key: 'fav',
            name: '즐겨찾기',
            icon: <ActionIcon id="favorite" />,
            tone: favBtn && /해제/.test(pluginLabel(favBtn)) ? 'accent' : 'default',
            onTap: () => favBtn && runPlugin(favBtn),
            disabled: !favBtn,
          },
          {
            key: 'inpaint',
            name: '인페인트',
            icon: <ActionIcon id="inpaint" />,
            onTap: () => inpaintBtn && runPlugin(inpaintBtn),
            disabled: !inpaintBtn,
          },
          { key: 'more', name: '더보기', icon: <ActionIcon id="more" />, onTap: () => setV2More((v) => !v), expanded: v2More },
        ]
      : [];
    const detailTier: V2TierItem[] = v2
      ? [
          {
            id: 'bookmark',
            label: isImageBm ? '북마크 해제' : '북마크',
            node: (
              <button className={`round-button ${isImageBm ? 'back-orange' : 'back-gray'}`} onClick={actToggleBookmark} aria-label={isImageBm ? '북마크 해제' : '북마크'}>
                <ActionIcon id="bookmark" />
              </button>
            ),
          },
          {
            id: 'copy',
            label: '복사',
            node: (
              <button className="round-button back-sky" onClick={actCopyImage} aria-label="복사">
                <ActionIcon id="copy" />
              </button>
            ),
          },
          {
            id: 'upscale',
            label: '업스케일',
            node: (
              <button className="round-button back-sky" title={upscaleTitle} disabled={upscaleDisabled} onClick={actUpscale}>
                <FaSearchPlus />
              </button>
            ),
          },
          ...otherBtns.map((b: any, i: number) => ({
            id: `plugin-${i}`,
            label: pluginLabel(b),
            node: (
              <button className={`round-button ${b.className}`} onClick={() => runPlugin(b)} aria-label={pluginLabel(b)}>
                <FaExchangeAlt />
              </button>
            ),
          })),
        ]
      : [];

    return (
      <div className="sds-image-detail z-10 bg-[var(--c-surface)] w-full h-full flex min-h-0 flex-col">
        <div className="sds-detail-heading flex items-center gap-2 flex-none border-b line-color px-3 py-2 md:px-4">
          <h2 className="m-0 text-base font-semibold text-default sds-detail-title" title={scene.name} data-result-detail-scene>
            {resultSceneLabel(scene)} {scene.name}
          </h2>

        </div>
        <div className="relative min-h-0 flex flex-1 flex-col overflow-auto md:flex-row">
        {!v2 && (
        <div className="sds-detail-info flex-none md:w-1/3 p-2 md:p-4 overflow-y-auto">
          <div className="sds-detail-actions flex gap-2 md:gap-3 mb-2 md:mb-6 flex-wrap w-full">
            {!isMobile && (
              <button
                className={`round-button back-green`}
                onClick={async () => {
                  // 다운로드 다이얼로그 열기
                  await imageDownloadService.downloadSingleImage(
                    session,
                    scene,
                    paths[selectedIndex],
                    appliedCharacterPreset,
                  );
                }}
              >
                <FaDownload className="mr-1" />
                다운로드
              </button>
            )}
            <button
              className={`round-button back-sky`}
              onClick={actDownloadFile}
            >
              {!isMobile ? '파일 위치 열기' : '파일 다운로드'}
            </button>
            {!isMobile && (
              <button
                className={`round-button back-sky`}
                onClick={async () => {
                  const imagePath = paths[selectedIndex];
                  try {
                    await backend.openImageEditor(imagePath);
                    watchedImages.current.add(imagePath);
                    await backend.watchImage(imagePath);
                  } catch {
                    appState.pushMessage('이미지 편집기를 열지 못했습니다. 설정에서 실행 파일을 확인해주세요.', 'error');
                  }
                }}
              >
                이미지 편집
              </button>
            )}
            {!isMobile && (
              <button
                className="round-button back-gray"
                disabled={restoringMetadata || !paths[selectedIndex]}
                onClick={restoreEditedMetadata}
              >
                {restoringMetadata ? '생성 정보 복원 중…' : '편집본에 생성 정보 복원'}
              </button>
            )}
            <button
              className={`round-button back-red`}
              onClick={actDeleteFile}
            >
              파일 삭제
            </button>
            <button
              className={`round-button ${isImageBm ? 'back-orange' : 'back-gray'}`}
              onClick={actToggleBookmark}
            >
              <ActionIcon id="bookmark" className="mr-1" />
              {isImageBm ? '북마크 해제' : '북마크'}
            </button>
            <button
              className={`round-button back-sky`}
              onClick={actCopyImage}
            >
              <ActionIcon id="copy" className="mr-1" />
              이미지 복사
            </button>
            <button
              className="round-button back-sky"
              onClick={actLoadSettings}
            >
              생성 설정 적용
            </button>
            <button
              className="round-button back-sky"
              title={upscaleTitle}
              disabled={upscaleDisabled}
              onClick={actUpscale}
            >
              {upscaleLabel}
            </button>
            {viewButtons.map((button, index) => (
              <button
                key={index}
                className={`round-button ${button.className}`}
                onClick={() => {
                  button.onClick(scene, paths[selectedIndex], onClose);
                }}
              >
                {button.text instanceof Function
                  ? button.text(paths[selectedIndex])
                  : button.text}
              </button>
            ))}
          </div>
          <button
            className={`round-button back-gray md:hidden`}
            onClick={() => setShowPrompt(!showPrompt)}
          >
            {!showPrompt ? '자세한 정보 보기' : '자세한 정보 숨기기'}
          </button>
          <div
            className={
              'mt-2 md:mt-0 md:block ' + (showPrompt ? 'block' : 'hidden')
            }
          >
            {infoFields}
          </div>
        </div>
        )}
        <div
          className={v2 ? 'sds-detail-image flex-1 overflow-auto relative min-h-0' : 'sds-detail-image flex-1 overflow-auto'}
          // 좌우 스와이프로 이미지를 넘기는 영역 — 가장자리 드로어 스와이프에 양보받는다(edgeSwipe.ts).
          data-edge-swipe-ignore=""
          onTouchStart={(e) => {
            if (e.touches.length !== 1) {
              touchStart.current = null;
              return;
            }
            touchStart.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
            };
          }}
          onTouchEnd={(e) => {
            const start = touchStart.current;
            touchStart.current = null;
            if (!start || paths.length < 2) return;
            const t = e.changedTouches[0];
            const dx = t.clientX - start.x;
            const dy = t.clientY - start.y;
            // 명확한 가로 스와이프만 처리(세로 스크롤/핀치와 충돌 방지):
            // 이동 50px 이상 + 가로가 세로보다 우세할 때.
            if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
            if (dx < 0) {
              setSelectedIndex((selectedIndex + 1) % paths.length);
            } else {
              setSelectedIndex(
                (selectedIndex - 1 + paths.length) % paths.length,
              );
            }
          }}
        >
          {image ? (
            <img
              src={image}
              draggable={false}
              onContextMenu={(e) => {
                show({
                  event: e,
                  props: {
                    ctx: historyEntry ? {
                      type: 'history_image',
                      entry: {
                        ...historyEntry,
                        id: paths[selectedIndex],
                        filename: currentFilename!,
                        path: paths[selectedIndex],
                      },
                    } : {
                      type: 'image',
                      path: paths[selectedIndex],
                      scene: scene,
                      starable: true,
                    },
                  },
                });
              }}
              className="w-full h-full object-contain bg-checkboard"
            />
          ) : imageLoadFailed ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted">
              <span>이미지를 불러오지 못했습니다.</span>
              <button
                className="round-button back-sky"
                onClick={async () => {
                  const path = paths[selectedIndex];
                  if (path) {
                    await imageService.invalidateCache(path).catch(() => {});
                  }
                  await imageService.refresh(session, scene).catch(() => {});
                  setImageRetryRevision((v) => v + 1);
                }}
              >
                다시 시도
              </button>
            </div>
          ) : (
            // 이미지 전환/로딩 중 빈 화면 깜빡임 대신 로딩 표시(부팅 스피너와 동일 스타일).
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-8 h-8 rounded-full border-2 border-[color:var(--c-line)] border-t-sky-500 animate-spin" />
            </div>
          )}
          <div className={'absolute bottom-0 md:bottom-auto right-0 md:top-10 flex gap-3 p-4 w-full md:w-auto' + (v2 ? ' opacity-60' : '')}>
            <button
              className={`round-button icon-only  ml-0 md:ml-auto h-10 md:h-8 w-20 md:w-auto bg-[var(--c-input-bg)] text-body mr-auto md:mr-0 text-xl md:text-base`}
              onClick={() => {
                setSelectedIndex(
                  (selectedIndex - 1 + paths.length) % paths.length,
                );
              }}
              aria-label="이전 이미지"
            >
              <FaArrowLeft />
            </button>
            <button
              className={`round-button icon-only h-10 md:h-8 w-20 md:w-auto bg-[var(--c-input-bg)] text-xl text-body md:text-base`}
              onClick={() => {
                setSelectedIndex((selectedIndex + 1) % paths.length);
              }}
              aria-label="다음 이미지"
            >
              <FaArrowRight />
            </button>
          </div>
        </div>
        {v2 && (
          <>
            {/* 자세한 정보 = 이미지 아래 손잡이(프롬프트 시트와 같은 언어). 탭하면 아래로 정보가 펼쳐지고 이미지가 줄어든다. */}
            <div
              role="button"
              aria-label={showPrompt ? '자세한 정보 접기' : '자세한 정보 펼치기'}
              aria-expanded={showPrompt}
              data-v2-detail-info-handle=""
              // 되돌리기 버튼 바(UndoRedoBar) 호스트(설계 E, 2026-11-04): 펼친 동안만 — 바가 아래 메인 줄 대신 이 손잡이 위
              // 모서리 바깥에 붙어 펼친 정보를 덮지 않는다. 접히면 표식·자리가 빠져 메인 줄로 돌아간다.
              {...(showPrompt ? { [UNDO_ANCHOR_ATTR]: '' } : null)}
              className="relative flex-none select-none cursor-pointer px-3 pt-1.5 border-t line-color bg-[var(--c-zone)]"
              style={{ height: V2_SHEET_PEEK_PX }}
              onClick={() => setShowPrompt(!showPrompt)}
            >
              {showPrompt && <UndoBarSlot tone="sheet" />}
              <div className="mx-auto mb-1.5 h-1 w-9 rounded-full bg-[var(--c-line)]" />
              <div className="flex items-center justify-center gap-1.5 text-[12px] text-sub">
                <span>자세한 정보</span>
                <FaChevronUp
                  size={10}
                  className="flex-none text-faint transition-transform duration-200"
                  style={{ transform: showPrompt ? 'rotate(180deg)' : undefined }}
                />
              </div>
            </div>
            {showPrompt && (
              <div data-v2-detail-info="" className="flex-none overflow-auto px-3 py-2 bg-[var(--c-zone)] text-sm" style={{ maxHeight: '45%' }}>
                {infoFields}
              </div>
            )}
            <div className="relative flex-none" data-v2-detail-bar="">
              <V2TierRows open={v2More} onClose={() => setV2More(false)} items={detailTier} perRow={6} />
              <V2MainRow slots={detailSlots} />
            </div>
          </>
        )}
        </div>
      </div>
    );
  },
);

interface ResultVieweRef {
  setImageTab: () => void;
  setInpaintTab: () => void;
}

interface ResultViewerProps {
  scene: GenericScene;
  buttons: any[];
  onFilenameChange: (src: string, dst: string) => void;
  onEdit: (scene: GenericScene) => void;
  onEditVariant: (scene: InpaintScene) => void;
  isMainImage?: (path: string) => boolean;
  starScene?: Scene;
  onSampleExtract?: (seeds: number[]) => void;
  // 히스토리 사이드바에서 특정 이미지로 점프할 때 포커스할 파일명
  focusFilename?: string;
  // 씬 탭 이동(W1): 뷰어를 연 채 그리드 표시 순서대로 이전/다음 씬으로 전환
  sceneNav?: SceneNavigation;
  initialDetailOpen?: boolean;
}

const ResultViewer = observer(forwardRef<ResultVieweRef, ResultViewerProps>(
  (
    {
      scene,
      onFilenameChange,
      onEdit,
      onEditVariant,
      starScene,
      isMainImage,
      buttons,
      onSampleExtract,
      focusFilename,
      sceneNav,
      initialDetailOpen = false,
    }: ResultViewerProps,
    ref,
  ) => {
    const { curSession, samples } = appState;
    const activeView = useContext(FloatViewActiveContext);
    const [_, forceUpdate] = useState<{}>({});
    const [mobileImageSelection, setSelectMode] = useState<boolean>(false);
    // 모바일 V2(2026-09-26): 머리의 액션 버튼 줄 대신 하단 5칸 줄(+더보기 둘째 줄). 클래식·PC 마크업은 불변.
    const v2 = isV2('detail');
    const [v2More, setV2More] = useState(false);
    const [showImageCheatsheet, setShowImageCheatsheet] =
      useState<boolean>(false);
    const [tournament, setTournament] = useState<boolean>(false);
    const selectedImages = useRef(new Set<string>());
    const imageSelectionAnchor = useRef<string>();
    const selectMode = isMobile ? mobileImageSelection : selectedImages.current.size > 0;
    const [selectedImageIndex, setSelectedImageIndex] = useState<
      number | undefined
    >(() => initialDetailOpen && imageService.getSceneGalleryEntries(curSession!, scene).length ? 0 : undefined);
    const [focusedImagePath, setFocusedImagePath] = useState<string>();
    const [imageFilter, setImageFilter] = useState<SceneImageFilter>('all');
    const [variantSourcePath, setVariantSourcePath] = useState<string>();
    const [variantResult, setVariantResult] = useState<{ scene: InpaintScene; path: string }>();
    const gallaryRef = useRef<ImageGalleryRef>(null);
    const gallaryRef2 = useRef<ImageGalleryRef>(null);
    const imagesSizes = [
      { name: 'S', size: 200 },
      { name: 'M', size: 400 },
      { name: 'L', size: 500 },
    ];
    const [imageSize, setImageSize] = useState<number>(1);
    const [selectedTab, setSelectedTab] = useState<number>(0);
    const [showDownloadDialog, setShowDownloadDialog] =
      useState<boolean>(false);
    const tabNames =
      scene.type === 'scene'
        ? ['이미지', '즐겨찾기', '휴지통', '인페인트 씬']
        : ['이미지', '즐겨찾기', '휴지통'];
    useEffect(() => {
      imageService.refresh(curSession!, scene);
    }, []);

    const [bmRev3, setBmRev3] = useState(0);
    useEffect(() => {
      const onBmUpdate = () => setBmRev3((r) => r + 1);
      sessionService.addEventListener('bookmark-updated', onBmUpdate);
      return () =>
        sessionService.removeEventListener('bookmark-updated', onBmUpdate);
    }, []);
    const bookmarkedImageFilename = sessionService.getImageBookmark(
      curSession!.name,
      scene.name,
    );
    const bookmarkedImagePath = bookmarkedImageFilename
      ? imageService.getOutputDir(curSession!, scene) +
        '/' +
        bookmarkedImageFilename
      : undefined;

    useImperativeHandle(ref, () => ({
      setImageTab: () => {
        setSelectedTab(0);
      },
      setInpaintTab: () => {
        setSelectedTab(3);
      },
    }));

    useEffect(() => {
      const handleGameChanged = () => {
        if (!tournament) forceUpdate({});
      };
      gameService.addEventListener('updated', handleGameChanged);
      return () => {
        gameService.removeEventListener('updated', handleGameChanged);
      };
    }, [tournament]);

    const getScenePaths = useCallback((owner: GenericScene) => {
      const directory = imageService.getOutputDir(curSession!, owner);
      return gameService.getOutputs(curSession!, owner).map((name) => directory + '/' + name);
    }, [curSession]);
    const paths = getScenePaths(scene);
    const variants = linkedImageVariants(scene, curSession!.inpaints.values());
    const openVariants = variantSourcePath
      ? linkedImageVariants(scene, variants, variantSourcePath.split('/').pop()!)
      : [];
    const imageOwners = new Map<string, GenericScene>(paths.map((path) => [path, scene]));
    const variantCounts = new Map<string, number>();
    const variantPaths: string[] = [];
    const sourceDir = imageService.getOutputDir(curSession!, scene);
    for (const variant of variants) {
      for (const path of getScenePaths(variant)) {
        imageOwners.set(path, variant);
        variantPaths.push(path);
      }
    }
    for (const variant of curSession!.inpaints.values()) {
      const sourceOwner = variant.sourceInpaint
        ? curSession!.inpaints.get(variant.sourceInpaint)
        : variant.sceneRef ? curSession!.scenes.get(variant.sceneRef) : undefined;
      if (variant.sourceImage && sourceOwner) {
        const source = imageService.getOutputDir(curSession!, sourceOwner) + '/' + variant.sourceImage;
        variantCounts.set(source, (variantCounts.get(source) ?? 0) + 1);
      }
    }
    const isFavorite = (path: string) => {
      return !!imageOwners.get(path)?.mains.includes(path.split('/').pop()!);
    };
    const imagePaths = imageService.getSceneGalleryEntries(curSession!, scene)
      .filter(entry => imageFilter === 'all' || (imageFilter === 'original' ? entry.owner === scene : entry.owner !== scene))
      .map(entry => entry.path);
    const favoritePaths = imagePaths.filter(isFavorite);
    const activePaths = selectedTab === 0 ? imagePaths : selectedTab === 1 ? favoritePaths : [];
    const onReorderImages = (from: string, to: string, visible: string[], group: string[]) => {
      const entries = imageService.getSceneGalleryEntries(curSession!, scene);
      return moveCombinedGalleryImage(curSession!, scene, entries.map(entry => entry.path),
        new Map(entries.map(entry => [entry.path, entry.owner])), from, to, visible, group);
    };
    const closeVariants = () => {
      setVariantResult(undefined);
      setVariantSourcePath(undefined);
    };
    // 히스토리 → 특정 이미지 포커스: 그리드를 해당 이미지 위치로 스크롤
    useEffect(() => {
      if (!focusFilename) return;
      const idx = imagePaths.findIndex((p) => p === sourceDir + '/' + focusFilename);
      if (idx >= 0) {
        setFocusedImagePath(imagePaths[idx]);
        const t = setTimeout(() => gallaryRef.current?.scrollToIndex(idx), 100);
        return () => clearTimeout(t);
      }
    }, [focusFilename]);

    const onClearSelection = useCallback(() => {
      imageSelectionAnchor.current = undefined;
      selectedImages.current = new Set();
      setSelectMode(false);
      gallaryRef.current?.refresh();
      gallaryRef2.current?.refresh();
      forceUpdate({});
    }, []);
    const onSelected = useCallback((path: string, event: GridModifiers = {}) => {
      const index = activePaths.indexOf(path);
      if (index < 0) return;
      if (isMobile) {
        if (!selectMode) { setSelectedImageIndex(index); return; }
        if (selectedImages.current.has(path)) selectedImages.current.delete(path);
        else selectedImages.current.add(path);
      } else {
        setFocusedImagePath(path);
        if (!gridCardUsesSelection(event)) { onClearSelection(); setSelectedImageIndex(index); return; }
        const selection = gridClickSelection(activePaths, selectedImages.current, imageSelectionAnchor.current, path, event);
        imageSelectionAnchor.current = selection.anchor;
        selectedImages.current = selection.keys;
      }
      gallaryRef.current?.refresh();
      gallaryRef2.current?.refresh();
      forceUpdate({});
    }, [selectMode, activePaths, onClearSelection]);
    const onSelectedImagesChange = useCallback((paths: string[], deselect: boolean, additive?: boolean) => {
      if (!isMobile) {
        if (!additive) selectedImages.current = new Set();
        for (const path of paths) selectedImages.current.add(path);
        if (paths.length) { imageSelectionAnchor.current = paths[0]; setFocusedImagePath(paths[0]); }
        else if (!additive) imageSelectionAnchor.current = undefined;
      } else {
        setSelectMode(true);
        for (const path of paths) {
          if (deselect) selectedImages.current.delete(path); else selectedImages.current.add(path);
        }
      }
      gallaryRef.current?.refresh();
      gallaryRef2.current?.refresh();
      forceUpdate({});
    }, []);
    useEffect(() => { if (!isMobile) onClearSelection(); }, [selectedTab, imageFilter, onClearSelection]);
    useEffect(() => {
      if (!isMobile || !selectMode || !activeView || selectedImageIndex != null) return;
      const handle = backStackService.push(onClearSelection);
      return () => handle.remove();
    }, [selectMode, onClearSelection, activeView, selectedImageIndex]);
    useBackLayer(!isMobile && selectMode && activeView && selectedImageIndex == null, () => {
      onClearSelection(); setFocusedImagePath(undefined);
    }, {
      preempt: true, back: 'skip',
      get escape() {
        return selectedImages.current.size && activeView && selectedImageIndex == null &&
          (selectedTab === 0 || selectedTab === 1) && !tournament && !showDownloadDialog &&
          !v2More && !variantSourcePath && !variantResult && gridSelectionCanReceiveEscape() ? 'close' : 'skip';
      },
    });
    useEffect(() => {
      if (selectedTab !== 1 || !selectedImages.current.size) return;
      const visible = new Set(favoritePaths);
      const remaining = new Set([...selectedImages.current].filter(path => visible.has(path)));
      if (remaining.size === selectedImages.current.size) return;
      selectedImages.current = remaining;
      if (imageSelectionAnchor.current && !remaining.has(imageSelectionAnchor.current)) imageSelectionAnchor.current = undefined;
      forceUpdate({});
    }, [selectedTab, favoritePaths]);

    const onToggleFavoriteSelected = useCallback(() => {
      if (selectedImages.current.size === 0) return;
      toggleGalleryFavorites(curSession!, groupImagePaths(selectedImages.current, imageOwners));
      if (gallaryRef.current) gallaryRef.current.refresh();
      if (gallaryRef2.current) gallaryRef2.current.refresh();
      sessionService.markDirty(curSession!.name);
      forceUpdate({});
    }, [imageOwners, curSession]);

    const onDuplicateSelected = useCallback(async () => {
      if (selectedImages.current.size === 0) return;
      // 원본 확장자 보존(.png 고정이던 결함)·같은 ms 이름 충돌 없음(E9), 만든 파일만 되돌리기 기록(U4)
      let created = 0;
      let failed = 0;
      for (const [owner, files] of groupImagePaths(selectedImages.current, imageOwners)) {
        const result = await copyImagesRecorded(curSession!, owner, files, 'duplicate');
        created += result.created.length;
        failed += result.failed.length;
      }
      appState.pushDialog({
        type: 'yes-only',
        text: imageCopyResultText('복제', created, failed),
      });
    }, [imageOwners, curSession]);

    const onCopyToSceneSelected = useCallback(() => {
      if (selectedImages.current.size === 0) return;
      appState.pushDialog({
        type: 'dropdown',
        text: '이미지를 어디에 복사할까요?',
        items: Array.from(curSession!.scenes.keys()).map((key) => ({
          text: key,
          value: key,
        })),
        callback: async (value) => {
          if (!value) return;
          const targetScene = curSession!.scenes.get(value);
          if (!targetScene) return;

          // 원본 확장자 보존·이름 충돌 없음(E9), 만든 파일만 되돌리기 기록(U4 — 대상 씬 기준)
          const r = await copyImagesRecorded(
            curSession!,
            targetScene,
            [...selectedImages.current],
            'copy',
          );
          appState.pushDialog({
            type: 'yes-only',
            text: imageCopyResultText('복사', r.created.length, r.failed.length),
          });
        },
      });
    }, [curSession]);

    const deleteGalleryPaths = async (targets: string[]) => {
        const deletion = beginImageDelete(curSession!);
        try {
          for (const [owner, files] of groupImagePaths(targets, imageOwners)) {
            const result = await deletion.delete(owner, files);
            for (const path of result.moved) selectedImages.current.delete(path);
          }
        } finally {
          deletion.commit();
        }
        gallaryRef.current?.refresh();
        gallaryRef2.current?.refresh();
        forceUpdate({});
      };

    const onDeleteImages = async (scene: GenericScene) => {
      // 삭제 대상은 실행 시점에 재계산한다 — 렌더 시점 스냅샷(paths)을 쓰면
      // 다이얼로그가 떠 있는 동안 새로 생성된 이미지(표시 순서상 맨 윗줄)가
      // 삭제 목록에서 빠져 화면에 남는 간헐 버그가 있었다.
      const currentPaths = () => getPaths();
      // 이동 실패(파일 잠금 등)는 공용 deleteImageFiles 가 한 번 알린다(호출부에서 다시 알리지 않음, X13).
      // 「다시 묻지 않음」은 장수와 무관하게 이미지 삭제 전부에 적용(v5.4.0 범위) — 고르는 메뉴(select)와
      // n등 이하의 입력 창은 늘 띄우고, 그 뒤 개수 확인 창만 설정에 따라 생략한다(deleteFlowRules).
      appState.pushDialog({
        type: 'select',
        text: '이미지를 삭제합니다. 원하시는 작업을 선택해주세요.',
        items: [
          {
            text: '모든 이미지 삭제',
            value: 'all',
          },
          {
            text: '즐겨찾기 제외 n등 이하 이미지 삭제',
            value: 'n',
          },
          {
            text: '즐겨찾기 제외 모든 이미지 삭제',
            value: 'fav',
          },
        ],
        callback: async (value) => {
          const notFav = (path: string) => !imageOwners.get(path)?.mains.includes(path.split('/').pop()!);
          // 확인 창은 대상 개수를 보인다(삭제 확인 문구 단일 출처, 2026-10-03 E1). 대상은 실행 시점에 다시 계산한다.
          const confirmDelete = (
            count: number,
            scope: Parameters<typeof imageDeleteScopeLine>[0],
            targets: () => string[],
          ) => {
            if (count === 0) {
              appState.pushMessage(NO_IMAGES_TO_DELETE_MESSAGE);
              return;
            }
            const doDel = async () => {
              await deleteGalleryPaths(targets());
            };
            if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, count)) {
              void doDel();
              return;
            }
            appState.pushDialog({
              type: 'confirm',
              ...deleteConfirmText({
                kind: 'image',
                count,
                outcome: { trashDays: IMAGE_RETENTION_DAYS },
                extra: imageDeleteScopeLine(scope),
              }),
              showSkipConfirm: showImageDeleteSkipOption(count),
              callback: doDel,
            });
          };
          if (value === 'all') {
            confirmDelete(currentPaths().length, {}, () => currentPaths());
          } else if (value === 'n') {
            appState.pushDialog({
              type: 'input-confirm',
              text: '몇등 이하 이미지를 삭제할지 입력해주세요.',
              callback: async (value) => {
                if (value) {
                  // 숫자가 아닌 입력은 slice(NaN)=slice(0) 이 되어 즐겨찾기 외 전부를 지운다 → 공용 해석기로 거른다
                  const n = parseRankCutoff(value);
                  if (n == null) {
                    appState.pushMessage(RANK_CUTOFF_INVALID_MESSAGE);
                    return;
                  }
                  // 예전엔 입력만 받고 확인 없이 지웠다 — 개수를 보이고 한 번 확인한다(E1-3)
                  const targets = () => currentPaths().slice(n).filter(notFav);
                  confirmDelete(targets().length, { rankBelow: n }, targets);
                }
              },
            });
          } else if (value === 'fav') {
            // 값이 없을 때(취소·선택 없음) 이 분기로 떨어지지 않게 명시 비교한다.
            const targets = () => currentPaths().filter(notFav);
            confirmDelete(targets().length, { excludeFav: true }, targets);
          }
        },
      });
    };

    // 이미지 그리드 「삭제」 버튼(V2 하단 줄·PC 클래식 툴바 공용, X3):
    // 선택 모드면 선택한 이미지만 지우고(확인 1회 — 「다시 묻지 않음」 체크박스·설정 존중), 아니면 기존 씬 전체 삭제 메뉴.
    const onDeleteButton = () => {
      const plan = planGridImageDelete(
        selectMode,
        selectedImages.current,
        Array.from(imageOwners.keys()),
      );
      if (plan.kind === 'scene-menu') {
        onDeleteImages(scene);
        return;
      }
      if (plan.kind === 'empty-selection') {
        appState.pushMessage(NO_SELECTED_IMAGES_MESSAGE);
        return;
      }
      const targets = plan.paths;
      if (targets.length === 0) return;
      const doDel = () => deleteGalleryPaths(targets);
      if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, targets.length)) {
        void doDel();
        return;
      }
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({
          kind: 'image',
          count: targets.length,
          outcome: { trashDays: IMAGE_RETENTION_DAYS },
          
        }),
        showSkipConfirm: showImageDeleteSkipOption(targets.length),
        callback: doDel,
      });
    };

    const getPaths = useCallback(() => {
      return imageService.getSceneGalleryEntries(curSession!, scene)
        .filter(entry => imageFilter === 'all' || (imageFilter === 'original' ? entry.owner === scene : entry.owner !== scene))
        .filter(entry => selectedTab !== 1 || entry.owner.mains.includes(entry.filename))
        .map(entry => entry.path);
    }, [scene, curSession, imageFilter, selectedTab]);

    // ===== 이미지 그리드 키보드 네비게이션 =====
    const focusedImageIndex = focusedImagePath
      ? activePaths.indexOf(focusedImagePath)
      : -1;
    const activeGalleryRef = selectedTab === 0 ? gallaryRef : gallaryRef2;

    // image-grid 카테고리 활성화 조건 동기화
    // 탭 전환 단축키(Ctrl+1/2/3/4)는 모든 탭에서 동작해야 하므로 selectedTab을 조건에서 제외.
    // 그리드 조작(방향키/즐겨찾기/북마크/삭제/상세 보기)은 핸들러 내부에서 selectedTab 가드 적용.
    useEffect(() => {
      const active = !isMobile && activeView && selectedImageIndex == null;
      appState.imageGridFocusable = active;
      return () => {
        appState.imageGridFocusable = false;
      };
    }, [activeView, selectedImageIndex]);

    // 포커스 이미지를 화면 안으로 스크롤
    useEffect(() => {
      if (!isMobile && selectedImageIndex == null && focusedImageIndex >= 0) {
        activeGalleryRef.current?.scrollToIndex(focusedImageIndex, 'auto');
      }
    }, [activeGalleryRef, focusedImageIndex, selectedImageIndex]);

    // 단축키 핸들러
    useEffect(() => {
      const onShortcut = (e: Event) => {
        const action = (e as CustomEvent).detail?.action as string | undefined;
        if (!activeView || !action?.startsWith('image-')) return;

        // 탭 전환 — 모든 탭에서 작동 (count/selectedTab 가드 전에 처리)
        if (
          action === 'image-tab-1' ||
          action === 'image-tab-2' ||
          action === 'image-tab-3' ||
          action === 'image-tab-4'
        ) {
          const tabIdx =
            action === 'image-tab-1'
              ? 0
              : action === 'image-tab-2'
                ? 1
                : action === 'image-tab-3'
                  ? 2
                  : 3;
          // 인페인트 씬 탭(3)은 scene 타입 전용
          if (tabIdx === 3 && scene.type !== 'scene') return;
          setSelectedTab(tabIdx);
          return;
        }

        // 씬 탭 이동(W1) — 어느 탭에서든 동작 (전환 시 새 씬으로 리마운트되어 탭 초기화)
        if (action === 'image-prev-scene' || action === 'image-next-scene') {
          sceneNav?.go(action === 'image-prev-scene' ? -1 : 1);
          return;
        }

        // 이하 그리드 조작은 이미지/즐겨찾기 탭에서만 의미 있음
        if (selectedTab !== 0 && selectedTab !== 1) return;
        if (selectedImageIndex != null) return;

        if (action === 'image-toggle-favorite' && selectedImages.current.size) {
          if (canHandleGridDelete() && !(e as CustomEvent).detail?.repeat) onToggleFavoriteSelected();
          return;
        }
        if (action === 'image-delete' && !canHandleGridDelete()) return;
        if (action === 'image-delete' && selectMode) {
          if (!(e as CustomEvent).detail?.repeat) onDeleteButton();
          return;
        }

        const count = activePaths.length;
        const cols = activeGalleryRef.current?.getColumnCount() ?? 1;
        if (count === 0) return;

        if (action === 'image-clear-select') { onClearSelection(); return; }
        if (action === 'image-toggle-select' || action === 'image-toggle-select-space') {
          onSelected(activePaths[Math.max(0, focusedImageIndex)], { ctrlKey: true });
          return;
        }

        const navigation = gridNavigationAction(action, 'image');
        if (navigation) {
          const next = gridKeyboardMove(activePaths, focusedImagePath,
            imageSelectionAnchor.current, navigation.direction, cols, navigation.extend);
          if (!next) return;
          setFocusedImagePath(next.key);
          imageSelectionAnchor.current = next.anchor;
          if (next.keys) {
            selectedImages.current = next.keys;
            gallaryRef.current?.refresh();
            gallaryRef2.current?.refresh();
            forceUpdate({});
          }
          return;
        }

        if (focusedImageIndex < 0) return;
        const i = focusedImageIndex;

        if (action === 'image-open-detail') {
          onClearSelection();
          setSelectedImageIndex(i);
        } else if (action === 'image-toggle-favorite') {
          const path = activePaths[i];
          const owner = imageOwners.get(path);
          if (owner) toggleImageFavorite(curSession!, owner, path.split('/').pop()!);
        } else if (action === 'image-toggle-bookmark') {
          const path = activePaths[i];
          const owner = imageOwners.get(path);
          if (owner) void toggleImageBookmarkRecorded(curSession!, owner, path.split('/').pop()!);
        } else if (action === 'image-delete') {
          // 그리드 Del 단일 삭제 — 상세 보기와 같은 규칙(「다시 묻지 않음」 체크박스·설정 존중, deleteFlowRules)
          const doDel = async () => {
            const path = activePaths[i];
            const owner = imageOwners.get(path);
            if (owner) await deleteImageFilesRecorded(curSession!, [path], owner);
          };
          if (shouldSkipImageDeleteConfirm(appState.skipImageDeleteConfirm, 1)) {
            void doDel();
            return;
          }
          appState.pushDialog({
            type: 'confirm',
            ...deleteConfirmText({ kind: 'image', outcome: { trashDays: IMAGE_RETENTION_DAYS } }),
            showSkipConfirm: showImageDeleteSkipOption(1),
            callback: doDel,
          });
        }
      };
      const canHandleGridDelete = () => activeView && !isMobile && selectedImageIndex == null &&
        (selectedTab === 0 || selectedTab === 1) && !tournament && !showDownloadDialog && !variantSourcePath && !variantResult;
      const handleSelectionDelete = (event: KeyboardEvent) => {
        if (event.key !== 'Delete' || event.defaultPrevented || event.repeat || event.isComposing) return;
        if (!canHandleGridDelete() || !selectedImages.current.size) return;
        if (isTextEntryFocused() || appState.dialogs.length || appState.sceneMergeRequest) return;
        if (keyboardShortcutService.getBinding('image-delete') !== KeyboardShortcutService.normalizeKey(event)) return;
        event.preventDefault(); event.stopPropagation(); onDeleteButton();
      };
      window.addEventListener('shortcut-action', onShortcut);
      if (!isMobile && activeView) window.addEventListener('keydown', handleSelectionDelete, true);
      return () => {
        window.removeEventListener('shortcut-action', onShortcut);
        window.removeEventListener('keydown', handleSelectionDelete, true);
      };
    }, [
      focusedImageIndex,
      activePaths,
      imageOwners,
      scene,
      selectedTab,
      curSession,
      selectMode,
      sceneNav,
      activeView,
      selectedImageIndex, tournament, showDownloadDialog, variantSourcePath, variantResult, onSelected, onClearSelection, onToggleFavoriteSelected,
    ]);

    // 선택 모드(Ctrl+S로 진입)에서 수정자 없는 S로 포커스 이미지 선택 토글.
    // 모드 밖에서는 실수 선택을 막기 위해 무시한다(씬 그리드와 동일 UX).
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== 's' && e.key !== 'S') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isMobile) return;
        if (!activeView || selectedImageIndex != null) return;
        if (selectedTab !== 0 && selectedTab !== 1) return;
        if (focusedImageIndex < 0 || appState.dialogs.length) return;
        const el = document.activeElement;
        if (el) {
          const tag = el.tagName.toLowerCase();
          if (
            tag === 'input' ||
            tag === 'textarea' ||
            (el as HTMLElement).isContentEditable
          )
            return;
        }
        if (focusedImageIndex >= activePaths.length) return;
        e.preventDefault();
        onSelected(activePaths[focusedImageIndex], { ctrlKey: true });
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, [activeView, focusedImageIndex, activePaths, selectedTab, selectedImageIndex, onSelected]);

    // H로 이미지 그리드 전용 단축키 도움말 토글.
    // 토너먼트/상세 보기 중에는 각자의 도움말이 우선하므로 무시한다.
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key !== 'h' && e.key !== 'H') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isMobile) return;
        if (!activeView || tournament || selectedImageIndex != null) return;
        const el = document.activeElement;
        if (el) {
          const tag = el.tagName.toLowerCase();
          if (
            tag === 'input' ||
            tag === 'textarea' ||
            (el as HTMLElement).isContentEditable
          )
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setShowImageCheatsheet((v) => !v);
      };
      window.addEventListener('keydown', handler, true);
      return () => window.removeEventListener('keydown', handler, true);
    }, [activeView, tournament, selectedImageIndex]);

    let emoji = '';
    let title = '';
    if (scene.type === 'inpaint') {
      emoji = workFlowService.getDef(scene.workflowType)?.emoji ?? '';
      title = workFlowService.getDef(scene.workflowType)?.title ?? '';
    }

    // 액션 동작(클래식 머리 버튼과 V2 하단 줄이 공유)
    const actQueueAdd = async () => {
      if (scene.type === 'scene') {
        await queueWorkflow(curSession!, curSession!.selectedWorkflow!, scene, appState.samples);
      } else {
        // 변형 씬은 씬 툴바 예약과 같은 관문(미러 합성 캔버스·미러/I2I 조합 전개 — 2026-10-04 B4 C6, 예전엔 조합 무시)
        try {
          await queueScene(curSession!, scene, appState.samples);
        } catch (e: any) {
          appState.pushMessage(e?.message ? String(e.message) : '예약하지 못했습니다.', 'error');
        }
      }
    };
    const actQueueRemove = () => {
      taskQueueService.removeTasksFromScene(scene);
    };
    const actToggleSelect = () => {
      if (selectMode) {
        selectedImages.current.clear();
      }
      setSelectMode(!selectMode);
    };
    const actSelectFavorites = () => {
      const favPaths = favoritePaths;
      if (favPaths.length === 0) {
        appState.pushMessage('즐겨찾기 이미지가 없습니다.');
        return;
      }
      if (!selectMode) {
        setSelectMode(true);
      }
      selectedImages.current.clear();
      for (const p of favPaths) {
        selectedImages.current.add(p);
      }
      gallaryRef.current?.refresh();
      gallaryRef2.current?.refresh();
      appState.pushMessage(favPaths.length + '장의 즐겨찾기 이미지가 선택되었습니다.');
    };
    const actSelectAll = () => {
      selectedImages.current.clear();
      for (const p of activePaths) selectedImages.current.add(p);
      gallaryRef.current?.refresh();
      gallaryRef2.current?.refresh();
      forceUpdate({});
    };
    const actDownload = () => {
      setShowDownloadDialog(true);
    };
    const actCopyImages = () => {
      if (selectMode && selectedImages.current.size > 0) {
        const selected = [...selectedImages.current];
        appState.copyImagesToClipboard(selected);
      } else {
        appState.copyImagesToClipboard(selectedTab < 2 ? activePaths : paths);
      }
    };
    const actPaste = () => {
      appState.pushDialog({
        type: 'confirm',
        text: appState.imageClipboard.length + '장의 이미지를 이 씬에 붙여넣으시겠습니까?',
        callback: async () => {
          await appState.pasteImagesFromClipboard(curSession!, scene);
        },
      });
    };
    const actSampleExtract = async () => {
      if (!onSampleExtract) return;
      if (!selectMode || selectedImages.current.size === 0) {
        appState.pushMessage('이미지를 먼저 선택해주세요.');
        return;
      }
      const selectedPaths = Array.from(selectedImages.current);
      const seeds: number[] = [];
      for (const path of selectedPaths) {
        try {
          const image = await imageService.fetchImage(path);
          if (!image) continue;
          const base64 = dataUriToBase64(image);
          const job = await extractPromptDataFromBase64(base64);
          if (job?.seed) seeds.push(job.seed);
        } catch (e) {
          // 시드 추출 실패 시 스킵
        }
      }
      if (seeds.length === 0) {
        appState.pushMessage('선택한 이미지에서 시드를 추출할 수 없습니다.');
        return;
      }
      onSampleExtract(seeds);
    };
    const actGoBookmark = () => {
      if (!bookmarkedImageFilename) {
        appState.pushMessage('북마크된 이미지가 없습니다.');
        return;
      }
      const bmPath = imageService.getOutputDir(curSession!, scene) + '/' + bookmarkedImageFilename;
      if (paths.includes(bmPath)) {
        // 이미지 탭으로 전환 후 해당 위치로 스크롤
        setSelectedTab(0);
        if (imageFilter === 'variant') setImageFilter('all');
        setFocusedImagePath(bmPath);
      } else {
        appState.pushMessage('북마크된 이미지를 찾을 수 없습니다.');
      }
    };

    // 모바일 V2 하단 줄(2026-09-26 사용자 결정): 평소=선택·삭제·즐겨찾기(일괄 선택)·북마크(+더보기),
    // 선택 중=전체·즐겨찾기 토글·삭제·더보기·완료. 나머지 액션은 더보기 둘째 줄(V2TierRows, 5칸씩).
    const selectedCount = selectedImages.current.size;
    const moreSlot: V2SlotDef = {
      key: 'more',
      name: '더보기',
      icon: <ActionIcon id="more" />,
      onTap: () => setV2More((v) => !v),
      expanded: v2More,
    };
    const deleteSlot: V2SlotDef = {
      key: 'delete',
      name: '삭제',
      icon: <ActionIcon id="delete" />,
      tone: 'danger',
      // 선택 중 줄에서는 선택한 이미지만, 평소 줄에서는 씬 전체 삭제 메뉴(X3)
      onTap: onDeleteButton,
    };
    const gallerySlots: V2SlotDef[] = v2
      ? [
          { key: 'select', name: '선택', icon: <ActionIcon id="multi-select" />, onTap: actToggleSelect },
          deleteSlot,
          isMainImage
            ? {
                key: 'fav-select',
                name: '즐겨찾기',
                icon: (
                  <span className="relative inline-flex items-center justify-center">
                    <FaStar />
                    <FaCheck className="absolute -right-1.5 -bottom-1 text-[9px]" />
                  </span>
                ),
                onTap: actSelectFavorites,
              }
            : { key: 'download', name: '다운로드', icon: <ActionIcon id="download" />, onTap: actDownload },
          {
            key: 'bookmark',
            name: '북마크',
            icon: <ActionIcon id="bookmark" />,
            tone: bookmarkedImageFilename ? 'accent' : 'default',
            onTap: actGoBookmark,
          },
          moreSlot,
        ]
      : [];
    const gallerySelectSlots: V2SlotDef[] = v2
      ? [
          { key: 'all', name: '전체', icon: <ActionIcon id="select-all" />, onTap: actSelectAll },
          {
            key: 'fav-toggle',
            name: '즐겨찾기',
            icon: <ActionIcon id="favorite" />,
            onTap: () => {
              if (selectedCount === 0) {
                appState.pushMessage('이미지를 먼저 선택해주세요.');
                return;
              }
              onToggleFavoriteSelected();
            },
          },
          deleteSlot,
          moreSlot,
          { key: 'done', name: '완료', icon: <FaCheck />, tone: 'accent', onTap: onClearSelection },
        ]
      : [];
    const tierItem = (id: string, label: string, className: string, icon: React.ReactNode, onClick: () => void, disabled?: boolean): V2TierItem => ({
      id,
      label,
      node: (
        <button className={`round-button ${className}`} onClick={onClick} disabled={disabled} aria-label={label}>
          {icon}
        </button>
      ),
    });
    const galleryTier: V2TierItem[] = v2
      ? [
          tierItem('queue-add', '예약 추가', 'back-green', <ActionIcon id="queue-add" />, () => void actQueueAdd()),
          tierItem('queue-remove', '예약 제거', 'back-gray', <ActionIcon id="queue-remove" />, actQueueRemove),
          tierItem('edit', '씬 편집', 'back-orange', <ActionIcon id="edit" />, () => onEdit(scene)),
          tierItem('download', '다운로드', 'back-green', <ActionIcon id="download" />, actDownload),
          tierItem('copy', '복사', 'back-sky', <ActionIcon id="copy" />, actCopyImages),
          tierItem('paste', '붙여넣기', appState.imageClipboard.length > 0 ? 'back-sky' : 'back-gray', <FaPaste />, actPaste),
          ...(onSampleExtract ? [tierItem('sample', '샘플 뽑기', 'back-sky', <FaDice />, () => void actSampleExtract())] : []),
          tierItem('tournament', '월드컵', 'back-sky', <FaTrophy />, () => setTournament(true)),
        ]
      : [];
    const gallerySelectTier: V2TierItem[] = v2
      ? [
          tierItem('download', '다운로드', 'back-green', <ActionIcon id="download" />, actDownload),
          tierItem('copy', '복사', 'back-sky', <ActionIcon id="copy" />, actCopyImages),
          tierItem('duplicate', '복제', 'back-sky', <ActionIcon id="duplicate" />, () => void onDuplicateSelected(), selectedCount === 0),
          tierItem('copy-to', '다른 씬', 'back-sky', <FaShareSquare />, onCopyToSceneSelected, selectedCount === 0),
          ...(onSampleExtract ? [tierItem('sample', '샘플 뽑기', 'back-sky', <FaDice />, () => void actSampleExtract())] : []),
          ...(isMainImage ? [tierItem('fav-select', '즐겨찾기 선택', 'back-yellow', <FaStar />, actSelectFavorites)] : []),
        ]
      : [];

    return (
      <div className="w-full h-full flex flex-col">
        {!isMobile && showImageCheatsheet && !tournament && (
          <ShortcutCheatsheet
            scope="image-grid"
            onClose={() => setShowImageCheatsheet(false)}
          />
        )}
        {tournament && (
          <FloatView
            priority={2}
            onEscape={() => {
              setTournament(false);
            }}
          >
            <Tournament
              scene={scene}
              path={getResultDirectory(curSession!, scene)}
            />
          </FloatView>
        )}
        <div className="flex-none p-2 md:p-4 border-b line-color">
          <div className="mb-2 md:mb-4 flex items-center">
            <span className="font-bold text-lg md:text-2xl text-default">
              {selectMode ? (
                <span className="inline-flex items-center gap-1">
                  이미지 선택 모드 ON
                </span>
              ) : !isMobile ? (
                scene.type === 'inpaint' ? (
                  <span className="inline-flex items-center gap-1">
                    {emoji} {title} 씬 {scene.name}의 생성된 이미지
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    🖼️ 일반 씬 {scene.name}의 생성된 이미지
                  </span>
                )
              ) : scene.type === 'inpaint' ? (
                <span className="inline-flex items-center gap-1">
                  {emoji} {title} 씬 {scene.name}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1">
                  🖼️ 일반 씬 {scene.name}
                </span>
              )}
            </span>
            {sceneNav && (
              <span className="ml-auto flex-none inline-flex items-center gap-1 md:gap-2 pl-2">
                <Tooltip content="이전 씬 그리드 (Ctrl+←)">
                  <button
                    className={`round-button icon-only back-gray ${!sceneNav.hasPrev ? 'opacity-40' : ''}`}
                    disabled={!sceneNav.hasPrev}
                    onClick={() => sceneNav.go(-1)}
                  >
                    <FaChevronLeft />
                  </button>
                </Tooltip>
                <Tooltip content="다음 씬 그리드 (Ctrl+→)">
                  <button
                    className={`round-button icon-only back-gray ${!sceneNav.hasNext ? 'opacity-40' : ''}`}
                    disabled={!sceneNav.hasNext}
                    onClick={() => sceneNav.go(1)}
                  >
                    <FaChevronRight />
                  </button>
                </Tooltip>
              </span>
            )}
          </div>
          <div className="md:flex justify-between items-center mt-2 md:mt-4">
            {!v2 && (
            <div className="flex gap-2 md:gap-3 flex-wrap">
              <button
                className={`round-button back-sky`}
                onClick={() => setTournament(true)}
              >
                이상형 월드컵
              </button>
              <button
                className={`round-button${isMobile ? ' icon-only' : ''} back-green`}
                onClick={actQueueAdd}
                aria-label="예약 추가"
              >
                {!isMobile ? '예약 추가' : <ActionIcon id="queue-add" />}
              </button>
              <Tooltip content="예약 제거">
                <button
                  className={`round-button${isMobile ? ' icon-only' : ''} back-gray`}
                  onClick={() => {
                    taskQueueService.removeTasksFromScene(scene);
                  }}
                >
                  {!isMobile ? '예약 제거' : <ActionIcon id="queue-remove" />}
                </button>
              </Tooltip>
              <Tooltip content="씬 편집">
                <button
                  className={`round-button${isMobile ? ' icon-only' : ''} back-orange`}
                  onClick={() => {
                    onEdit(scene);
                  }}
                >
                  {!isMobile ? '씬 편집' : <ActionIcon id="edit" />}
                </button>
              </Tooltip>
              {!isMobile && (
                <Tooltip content="폴더 열기">
                  <button
                    className={`round-button icon-only back-sky`}
                    onClick={async () => {
                      await backend.showFile(
                        getResultDirectory(curSession!, scene),
                      );
                    }}
                  >
                    <FaFolder />
                  </button>
                </Tooltip>
              )}
              {isMobile && <Tooltip content="이미지 선택 모드">
                <button
                  className={
                    `round-button icon-only ` + (selectMode ? 'back-sky toggle-on' : 'back-gray')
                  }
                  aria-pressed={selectMode}
                  data-viewer-toggle="select-mode"
                  onClick={actToggleSelect}
                >
                  <ActionIcon id="multi-select" />
                </button>
              </Tooltip>}
              {isMainImage && (
                <Tooltip content="즐겨찾기 이미지 일괄 선택">
                  <button
                    className={`round-button icon-only back-yellow`}
                    onClick={actSelectFavorites}
                  >
                    {/* 즐겨찾기 '선택' 헬퍼: 별+체크 배지로 토글 버튼(순수 별)과 구분 */}
                    <span className="relative inline-flex items-center justify-center">
                      <FaStar />
                      <FaCheck className="absolute -right-1.5 -bottom-1 text-[9px]" />
                    </span>
                  </button>
                </Tooltip>
              )}
              <Tooltip content="이미지 다운로드">
                <button
                  className={`round-button icon-only back-green`}
                  onClick={actDownload}
                >
                  <FaDownload />
                </button>
              </Tooltip>
              <Tooltip content="이미지 복사">
                <button
                  className={`round-button icon-only back-sky`}
                  onClick={actCopyImages}
                >
                  <ActionIcon id="copy" />
                </button>
              </Tooltip>
              <Tooltip content="이미지 붙여넣기">
                <button
                  className={`round-button icon-only ${appState.imageClipboard.length > 0 ? 'back-sky toggle-on' : 'back-gray'}`}
                  data-viewer-toggle="paste"
                  onClick={actPaste}
                >
                  <FaPaste />
                </button>
              </Tooltip>
              {selectMode && selectedImages.current.size > 0 && (
                <>
                  <Tooltip content="선택 이미지 즐겨찾기 토글">
                    <button
                      className="round-button icon-only back-yellow"
                      onClick={onToggleFavoriteSelected}
                    >
                      <FaStar />
                    </button>
                  </Tooltip>
                  <Tooltip content="선택 이미지 복제">
                    <button
                      className="round-button icon-only back-sky"
                      onClick={onDuplicateSelected}
                    >
                      <ActionIcon id="duplicate" />
                    </button>
                  </Tooltip>
                  <Tooltip content="선택 이미지를 다른 씬으로 복사">
                    <button
                      className="round-button icon-only back-sky"
                      onClick={onCopyToSceneSelected}
                    >
                      <FaShareSquare />
                    </button>
                  </Tooltip>
                </>
              )}
              <Tooltip
                content={
                  selectMode ? '선택한 이미지 삭제' : '이미지 삭제'
                }
              >
                <button
                  className={`round-button icon-only back-red`}
                  aria-label={selectMode ? '선택한 이미지 삭제' : '이미지 삭제'}
                  onClick={onDeleteButton}
                >
                  <FaTrash />
                </button>
              </Tooltip>
              {onSampleExtract && (
                <Tooltip content="샘플 뽑기 (시드 추출)">
                  <button
                    className={`round-button icon-only back-sky`}
                    onClick={actSampleExtract}
                  >
                    <FaDice />
                  </button>
                </Tooltip>
              )}
              <Tooltip content="북마크된 이미지로 이동">
                <button
                  className={`round-button icon-only ${bookmarkedImageFilename ? 'back-orange toggle-on' : 'back-gray'}`}
                  data-viewer-toggle="bookmark-jump"
                  onClick={actGoBookmark}
                >
                  <ActionIcon id="bookmark" />
                </button>
              </Tooltip>
            </div>
            )}
            <span className="flex ml-auto gap-1 md:gap-2 mt-2 md:mt-0">
              {tabNames.map((tabName, index) => (
                <button
                  className={
                    `round-button ` +
                    (selectedTab === index ? 'back-sky' : 'back-llgray')
                  }
                  onClick={() => setSelectedTab(index)}
                >
                  {tabName}
                </button>
              ))}
            </span>
          </div>
        </div>
        {scene.type === 'scene' && selectedTab < 2 && (
          <div className="flex flex-none flex-wrap gap-1 px-2 pt-2 md:px-4" role="group" aria-label="이미지 범위">
            {SCENE_IMAGE_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`round-button ${value === imageFilter ? 'back-sky' : 'back-llgray'}`}
                aria-pressed={value === imageFilter}
                onClick={() => {
                  if (value === imageFilter) return;
                  onClearSelection();
                  setImageFilter(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 pt-2 relative min-h-0 overflow-hidden">
          <ImageGallery
            scene={scene}
            onFilenameChange={onFilenameChange}
            ref={gallaryRef}
            isMainImage={isFavorite}
            imageOwners={imageOwners}
            variantCounts={variantCounts}
            onOpenVariants={setVariantSourcePath}
            onReorderImages={onReorderImages}
            filePaths={imagePaths}
            imageSize={imagesSizes[imageSize].size}
            isHidden={selectedTab !== 0}
            selectedImages={selectedImages.current}
            onSelected={onSelected}
            selectMode={selectMode}
            bookmarkedImagePath={bookmarkedImagePath}
            focusedIndex={selectedTab === 0 ? focusedImageIndex : null}
            onSelectedImagesChange={onSelectedImagesChange}
            onClearSelection={onClearSelection}
            emptyText={imageFilter === 'variant' ? '아직 변형 결과가 없습니다' : '아직 생성된 이미지가 없습니다'}
            emptyHint={imageFilter === 'variant' ? '연결된 변형 작업에서 생성한 이미지가 여기에 표시됩니다' : '씬을 예약하면 생성된 이미지가 여기에 표시됩니다'}
          />
          {selectedTab === 2 && (
            <TrashImageView
              session={curSession!}
              scene={scene}
              imageSize={imagesSizes[imageSize].size}
            />
          )}
          <QueueControl
            type="inpaint"
            isActive={selectedTab === 3}
            className={selectedTab === 3 ? 'px-1 md:px-4 ' : 'hidden'}
            onClose={(x) => {
              setSelectedTab(x);
            }}
            filterFunc={(x: any) => {
              return !!(x.sceneRef && x.sceneRef === scene.name);
            }}
          ></QueueControl>
          {selectedImageIndex != null && (
            <FloatView
              priority={1}
              // 이미지 상세 — 전역 되돌리기 단축키 허용(D9, 바깥 이미지 그리드 창도 허용이라 함께 통과)
              allowUndo
              onEscape={() => setSelectedImageIndex(undefined)}
            >
              <ResultDetailView
                buttons={buttons}
                onClose={() => {
                  setSelectedImageIndex(undefined);
                }}
                scene={scene}
                getPaths={getPaths}
                initialSelectedIndex={selectedImageIndex}
                sceneNav={sceneNav}
                onViewedImageChange={setFocusedImagePath}
                imageOwners={imageOwners}
                variantCounts={variantCounts}
                onOpenVariants={setVariantSourcePath}
              />
            </FloatView>
          )}
          {variantSourcePath && (
            <FloatView priority={1} allowUndo onEscape={closeVariants}>
              <div className="h-full overflow-auto bg-[var(--c-zone)] p-3 md:p-4">
                <h2 className="m-0 font-semibold text-default">연결된 변형 작업</h2>
                <p className="mt-1 mb-4 text-sm text-sub break-all">{variantSourcePath.split('/').pop()}</p>
                {openVariants.length === 0 && (
                  <p className="text-sm text-faint">연결된 변형 작업이 없습니다.</p>
                )}
                {openVariants.map((variant) => {
                  const results = getScenePaths(variant);
                  return (
                    <section key={variant.name} className="mb-3 rounded-lg border line-color bg-[var(--c-surface)] p-3">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="m-0 text-sm font-semibold text-default break-all">{variant.name}</h3>
                        <span className="text-xs text-sub">{resultSceneLabel(variant)} · 결과 {results.length}장</span>
                        <button type="button" className="round-button back-gray ml-auto" onClick={() => onEditVariant(variant)}>
                          작업 열기
                        </button>
                      </div>
                      {results.length === 0 ? (
                        <p className="m-0 text-sm text-faint">생성된 결과가 없습니다.</p>
                      ) : (
                        <div className="flex gap-2 flex-wrap">
                          {results.map((path) => (
                            <button key={path} type="button" className="block rounded border line-color overflow-hidden"
                              aria-label={`${variant.name} 결과 ${path.split('/').pop()} 보기`}
                              onClick={() => setVariantResult({ scene: variant, path })}
                            >
                              <CellPreview path={path} cellSize={112} imageSize={200} style={{ width: 112, height: 112, display: 'grid', placeItems: 'center' }} />
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </FloatView>
          )}
          {variantResult && getScenePaths(variantResult.scene).includes(variantResult.path) && (
            <FloatView priority={1} allowUndo onEscape={() => setVariantResult(undefined)}>
              <ResultDetailView
                key={variantResult.path}
                buttons={[]}
                scene={scene}
                imageOwners={imageOwners}
                getPaths={() => getScenePaths(variantResult.scene)}
                initialSelectedIndex={getScenePaths(variantResult.scene).indexOf(variantResult.path)}
                onClose={() => setVariantResult(undefined)}
              />
            </FloatView>
          )}
          {showDownloadDialog && (
            <DownloadDialog
              session={curSession!}
              scene={scene}
              imagePaths={
                selectMode && selectedImages.current.size > 0
                  ? Array.from(selectedImages.current)
                  : selectedTab < 2 ? activePaths : paths
              }
              characterPreset={appState.getAppliedCharacterPreset()}
              onClose={() => setShowDownloadDialog(false)}
              onDownloadComplete={() => {
                if (selectMode) {
                  selectedImages.current.clear();
                  setSelectMode(false);
                }
              }}
            />
          )}
          <ImageGallery
            scene={scene}
            ref={gallaryRef2}
            selectMode={selectMode}
            onFilenameChange={onFilenameChange}
            isMainImage={isFavorite}
            imageOwners={imageOwners}
            variantCounts={variantCounts}
            onOpenVariants={setVariantSourcePath}
            onReorderImages={onReorderImages}
            filePaths={favoritePaths}
            imageSize={imagesSizes[imageSize].size}
            selectedImages={selectedImages.current}
            isHidden={selectedTab !== 1}
            onSelected={onSelected}
            bookmarkedImagePath={bookmarkedImagePath}
            focusedIndex={selectedTab === 1 ? focusedImageIndex : null}
            onSelectedImagesChange={onSelectedImagesChange}
            onClearSelection={onClearSelection}
            emptyText="즐겨찾기한 이미지가 없습니다"
            emptyHint="이미지에 ★(즐겨찾기)를 지정하면 여기에 모입니다"
          />
        </div>
        {v2 && (
          <div className="relative flex-none" data-v2-gallery-bar="">
            <V2TierRows
              open={v2More}
              onClose={() => setV2More(false)}
              items={selectMode ? gallerySelectTier : galleryTier}
              perRow={5}
            />
            <V2MainRow slots={selectMode ? gallerySelectSlots : gallerySlots} selecting={selectMode} />
          </div>
        )}
        <div
          className="absolute gap-1 m-2 bottom-0 bg-[var(--c-surface-2)] p-1 right-0 opacity-30 hover:opacity-100 transition-all flex"
          // V2: 하단 줄(52px) 위로 올린다(가려지지 않게)
          style={v2 ? { bottom: V2_GALLERY_BAR_PX } : undefined}
        >
          {selectedTab !== 2 &&
            selectedTab !== 3 &&
            imagesSizes.map((size, index) => (
              <button
                key={index}
                className={`text-white w-8 h-8 hover:brightness-95 active:brightness-90 cursor-pointer
          ${imageSize === index ? 'bg-gray-600' : 'bg-gray-400'}`}
                onClick={() => {
                  setImageSize(index);
                }}
              >
                {size.name}
              </button>
            ))}
        </div>
      </div>
    );
  },
));

export default ResultViewer;

const LinkedImageWorks=observer(function LinkedImageWorks({session,scene,path}:{session:Session;scene:GenericScene;path:string}){
  const [editing,setEditing]=useState<InpaintScene|null>(null);
  const [result,setResult]=useState<{work:InpaintScene;file:string}|null>(null);
  const [,refresh]=useState(0);
  useEffect(()=>{const changed=()=>refresh(n=>n+1);imageService.addEventListener('image-added',changed);return()=>imageService.removeEventListener('image-added',changed);},[]);
  const works=linkedImageVariants(scene,session.inpaints.values(),path?.split('/').pop());
  if(!works.length)return null;
  return <section className="sds-linked-works" aria-label="연결된 인페인트·I2I 작업">
    <h3 className="text-default">연결된 인페인트·I2I 작업 <span className="text-sub">{works.length}</span></h3>
    {works.map(work=>{const paths=gameService.getOutputs(session,work).map(name=>imageService.getOutputDir(session,work)+'/'+name);
      return <article key={work.name} className="sds-linked-work"><div className="sds-work-heading">
        <div className="sds-work-name"><strong className="text-default">{work.name}</strong><span className="text-sub">{workFlowService.getDef(work.workflowType)?.title||'변형'} · 결과 {paths.length}장</span></div>
        <button className="round-button back-sky" onClick={()=>{if(session!==appState.curSession){appState.pushMessage('이 이미지의 프로젝트를 연 뒤 편집 작업을 열어 주세요.');return;}setEditing(work);}}>작업 열기</button>
        <button className="round-button back-red" onClick={()=>confirmInpaintSceneDelete(session,work)} aria-label={work.name+' 작업 삭제'}>삭제</button>
      </div>{paths.length?<div className="sds-work-results">{paths.map(file=><button key={file} className="sds-work-result" aria-label={work.name+' 결과 '+file.split('/').pop()+' 보기'} onClick={()=>setResult({work,file})}>
        <CellPreview path={file} cellSize={96} imageSize={200} style={{width:96,height:96,display:'grid',placeItems:'center'}}/>
      </button>)}</div>:<p className="text-faint">아직 생성된 결과가 없습니다.</p>}</article>;
    })}
    {editing&&<FloatView priority={3} onEscape={()=>setEditing(null)}><InPaintEditor editingScene={editing} onConfirm={()=>setEditing(null)} onDelete={()=>setEditing(null)}/></FloatView>}
    {result&&<FloatView priority={2} allowUndo onEscape={()=>setResult(null)}><ResultDetailView scene={result.work} session={session} buttons={[]}
      getPaths={()=>gameService.getOutputs(session,result.work).map(name=>imageService.getOutputDir(session,result.work)+'/'+name)}
      initialSelectedIndex={gameService.getOutputs(session,result.work).indexOf(result.file.split('/').pop()!)} onClose={()=>setResult(null)}/></FloatView>}
  </section>;
});
