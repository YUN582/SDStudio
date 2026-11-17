import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Tooltip from './Tooltip';
import {
  base64ToDataUri,
  getImageDimensions,
} from './BrushTool';
import { DropdownSelect, TabComponent } from './UtilComponents';
import { Resolution, resolutionMap } from '../backends/imageGen';
import {
  FaImages,
  FaPuzzlePiece,
} from 'react-icons/fa';
import { ActionIcon } from './ActionIcon';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
  isMobile,
  imageService,
  workFlowService,
  taskQueueService,
  sessionService,
} from '../models';
import { dataUriToBase64 } from '../models/ImageService';
import { InpaintScene, PromptPiece, Scene } from '../models/types';
import { COMBO_EDITOR_TEXT, COMBO_EMPTY_TEXT, variantComboMode } from '../models/comboMode';
import { canChooseComboMode, turnOnComboMode } from '../models/comboSource';
import {
  combinationMiddlePrompt,
  enumerateCombinations,
} from '../models/PromptService';
import { appState } from '../models/AppService';
import {
  checkInpaintSceneRename,
  DELETE_RESULT_TEXT,
  deleteConfirmText,
  runTrashDelete,
} from '../models/deleteFlowRules';
import { SCENE_RETENTION_DAYS } from '../models/TrashService';
import { promptCustomResolution } from '../models/customResolutionPrompt';
import { renameInpaintScene } from '../models/SessionService';
import { recordSceneRename } from '../models/sceneStructureUndo';
import { beginSceneDelete } from '../models/deleteUndo';
import { editSceneFields } from '../models/sceneFieldUndo';
import { UNDO_TEXT } from '../models/undoService';
import { commitOnPointerRelease, setWorkflowField, workflowFieldLabel } from '../models/presetUndo';
import {
  beginVariantSlide,
  editVariantFields,
  setVariantPresetField,
  touchVariantEdit,
  VARIANT_FOCUS_RECT_KEYS,
  VARIANT_RESOLUTION_KEYS,
} from '../models/variantSceneUndo';
import { observer } from 'mobx-react-lite';
import { InnerPreSetEditor } from './PreSetEdtior';
import { ComboPromptEditor } from './ComboPromptEditor';
import { reaction, runInAction } from 'mobx';
import { FloatView, FloatViewActiveContext } from './FloatView';
import TaskQueueControl from './TaskQueueControl';
import WorkflowCanvas, { WorkflowCanvasRef, PaintHistory } from './WorkflowCanvas';
import { InpaintDrawingTools } from './InpaintDrawingTools';
import { canvasPointerPoint } from '../models/canvasPointer';
import { generationControlState } from '../models/generationControl';
import { isTextEntryFocused } from '../models/keyTargetGuard';
import { DETACHED_INPUT_META } from '../models/inpaintInput';
import { ensureSingleImagePrompt, isSingleImageEdit } from '../models/singleImageEdit';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import {
  lowerResolution,
  queueI2IWorkflow,
  queueMirrorWorkflow,
} from '../models/TaskQueueService';
import {
  applyImageResolution,
  IMAGE_RESOLUTION_TEXT,
  ImageResolution,
  imageResolutionMismatch,
  paidResolutionNotice,
  resolutionFromImage,
  workflowUsesImageResolution,
} from '../models/inpaintResolution';
import {
  prepareMirrorCanvas,
  SDI2IComboUI,
  SDInpaintComboUI,
} from '../models/workflows/SDWorkFlow';
import { SlotEditor } from './SceneEditor';
import { variantCharacterContext } from '../models/sceneCharacterPrompts';
import { v4 as uuidv4 } from 'uuid';
import FocusAreaOverlay from './FocusAreaOverlay';
import {
  FOCUS_CONTEXT_MAX,
  FOCUS_CONTEXT_MIN,
  FOCUS_GRID,
  normalizeFocusContext,
} from '../models/focusedInpaint';
import {
  FOCUS_EDITOR_TEXT,
  FocusDragResult,
  focusRectPresetPatch,
  focusRequestLabel,
  inpaintPointerTarget,
  presetFocusRect,
  presetSupportsFocus,
  reconcileFocusRect,
} from '../models/focusedInpaintEditor';

interface Props {
  editingScene: InpaintScene;
  onConfirm: () => void;
  onDelete: () => void;
}

let brushSizeSaved = 10;

const InPaintEditor = observer(
  ({ editingScene, onConfirm, onDelete }: Props) => {
    const [_, rerender] = useState({});
    const editingSceneRef = useRef(editingScene);
    editingSceneRef.current = editingScene;
    useEffect(() => {
      const handleProgress = () => {
        rerender({});
      };
      taskQueueService.addEventListener('start', handleProgress);
      taskQueueService.addEventListener('stop', handleProgress);
      taskQueueService.addEventListener('progress', handleProgress);
      return () => {
        taskQueueService.removeEventListener('start', handleProgress);
        taskQueueService.removeEventListener('stop', handleProgress);
        taskQueueService.removeEventListener('progress', handleProgress);
      };
    });
    const { curSession } = appState;
    // 해상도 3필드 = 한 번의 선택 1항목(U2b) — 세션에 등록된 변형 씬일 때만 기록(새 씬 초안은 기록 없음)
    const editResolution = (mutate: () => void) =>
      editSceneFields(
        appState.curSession,
        editingScene,
        ['resolution', 'resolutionWidth', 'resolutionHeight'],
        UNDO_TEXT.sceneResolution(editingScene.name),
        mutate,
      );
    const resolutionOptions = Object.entries(resolutionMap)
      .map(([key, value]) => {
        const resolVal =
          (editingScene.resolutionWidth ?? '') +
          'x' +
          (editingScene.resolutionHeight ?? '');
        if (key === 'custom')
          return { label: '커스텀 (' + resolVal + ')', value: key };
        return { label: `${value.width}x${value.height}`, value: key };
      })
      .filter((x) => !x.value.startsWith('small'));

    const [paintTool, setPaintTool] = useState<'mask'|'paint'>('mask');
    const [paintColor, setPaintColor] = useState('#ef4444');
    const [paintOpacity, setPaintOpacity] = useState(1);
    const [paintHistory, setPaintHistory] = useState<PaintHistory>({undo:false,redo:false,ready:false});
    const [queuing, setQueuing] = useState(false);
    const queuingRef = useRef(false);
    const [inputRevision, setInputRevision] = useState(0);
    const zoomRef = useRef<ReactZoomPanPinchRef>(null);
    const viewportRef = useRef<HTMLDivElement>(null);
    const activeEditor = useContext(FloatViewActiveContext);
    const activeEditorRef = useRef(activeEditor);
    activeEditorRef.current = activeEditor;
    const [spaceHeld, setSpaceHeld] = useState(false);
    const [rotation, setRotation] = useState(0);
    const spaceRef = useRef(false), pointerInside = useRef(false);
    useEffect(()=>{setRotation(0);setSpaceHeld(false);spaceRef.current=false;},[editingScene]);
    useEffect(()=>{
      const viewport=viewportRef.current;
      if(!viewport)return;
      let previous='';
      const observer=new ResizeObserver(()=>{
        const rect=viewport.getBoundingClientRect(),size=rect.width+':'+rect.height;
        if(previous && previous!==size)zoomRef.current?.centerView(undefined,0);
        previous=size;
      });
      observer.observe(viewport);
      const release=()=>{spaceRef.current=false;setSpaceHeld(false);};
      const down=(event:KeyboardEvent)=>{
        if(event.code!=='Space'||event.repeat||!activeEditorRef.current||!pointerInside.current||isTextEntryFocused()||appState.dialogs.length)return;
        event.preventDefault();spaceRef.current=true;brushTool.current?.stopBrushing();setSpaceHeld(true);
      };
      const up=(event:KeyboardEvent)=>{if(event.code==='Space')release();};
      const enter=()=>{pointerInside.current=true;};
      const leave=()=>{pointerInside.current=false;};
      const wheel=(event:WheelEvent)=>{
        if(!activeEditorRef.current)return;
        if(spaceRef.current){event.preventDefault();event.stopPropagation();setRotation(value=>(value+(event.deltaY<0?15:-15)+540)%360-180);return;}
        if(event.ctrlKey||event.metaKey)return;
        event.preventDefault();event.stopPropagation();
        setBrushSize(value=>{const next=Math.max(1,Math.min(100,Number(value)+(event.deltaY<0?1:-1)));brushSizeSaved=next;return next;});
      };
      viewport.addEventListener('pointerenter',enter);viewport.addEventListener('pointerleave',leave);
      viewport.addEventListener('wheel',wheel,{passive:false,capture:true});
      window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',release);
      return ()=>{observer.disconnect();viewport.removeEventListener('pointerenter',enter);viewport.removeEventListener('pointerleave',leave);viewport.removeEventListener('wheel',wheel,true);window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',release);};
    },[]);
    const [image, setImage] = useState('');
    const [inputError, setInputError] = useState<string>();
    const [canUseStoredInput, setCanUseStoredInput] = useState(false);
    const [inputReload, setInputReload] = useState(0);
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    // 크기를 잰 이미지(같은 이미지일 때만 해상도 불일치 안내 — 씬 전환 직후 옛 크기로 판단하지 않게)
    const [loadedDims, setLoadedDims] = useState<
      { image: string; width: number; height: number } | undefined
    >(undefined);
    const [mask, setMask] = useState<string | undefined>(undefined);
    const [brushSize, setBrushSize] = useState(brushSizeSaved);
    const [eraserMode, setEraserMode] = useState(false);
    const [brushing, setBrushing] = useState(true);
    // Focused 영역 도구(2026-10-04 S2) — 브러시 모드의 하위 도구(지우개처럼). 이동 모드로 바꾸면 쉬고 돌아오면 다시 영역.
    const [focusTool, setFocusTool] = useState(false);
    const [open, setOpen] = useState(false);
    // PC 조합 탭(0=프롬프트 에디터, 1=조합 에디터) — 조합 에디터면 이미지 패널을 숨겨 왼쪽을 넓힌다(모바일 FloatView 무관)
    const [pcComboTab, setPcComboTab] = useState(0);
    const def =workFlowService.getDef(editingScene.workflowType)!;
    const isMirror = editingScene.workflowType === 'SDMirror';
    // 미러 프리셋에는 focus 키가 없다(영역 버튼·오버레이 숨김).
    const supportsFocus = !!def?.hasMask && !isMirror && presetSupportsFocus(editingScene.preset);
    const pointerTarget = inpaintPointerTarget({
      hasMask: !!def?.hasMask,
      brushing,
      focusTool: supportsFocus && focusTool,
    });
    const focusRect = supportsFocus ? presetFocusRect(editingScene.preset) : null;
    const focusEnabled = supportsFocus && editingScene.preset.focusEnabled === true;
    const focusContext = normalizeFocusContext(editingScene.preset.focusContext);
    // 사각형·켜짐 값은 프리셋에 바로 쓴다(다른 프리셋 토글과 같은 경로 — 씬 toJSON reaction → 저장 큐).
    // 사용자 동작(영역 드래그·켜기/끄기·맥락 슬라이더)만 되돌리기 기록(U5) — 이미지 크기 맞춤 보정(아래 [image] 효과)은 기록 안 함.
    const applyFocusRect = (rect: Parameters<typeof focusRectPresetPatch>[0]) => {
      editVariantFields(
        appState.curSession,
        editingScene,
        { preset: VARIANT_FOCUS_RECT_KEYS },
        UNDO_TEXT.variantFocusRect(editingScene.name),
        () => {
          runInAction(() => {
            Object.assign(editingScene.preset, focusRectPresetPatch(rect));
          });
        },
      );
    };
    const commitFocusDrag = (result: FocusDragResult) => {
      if (result.kind === 'set') applyFocusRect(result.rect);
      else if (result.kind === 'clear') applyFocusRect(null);
    };
    const setFocusEnabled = (on: boolean) =>
      setVariantPresetField(
        appState.curSession,
        editingScene,
        'focusEnabled',
        on,
        on ? UNDO_TEXT.variantFocusOn(editingScene.name) : UNDO_TEXT.variantFocusOff(editingScene.name),
      );
    const selectFocusTool = () => {
      if (focusTool && brushing) {
        // 켜진 영역 도구를 다시 누르면 Focused 끄기(사각형 값은 보존 — 다시 켜면 복원).
        setFocusTool(false);
        setFocusEnabled(false);
        return;
      }
      setFocusTool(true);
      setBrushing(true);
      setFocusEnabled(true);
    };
    // 맥락 여백 슬라이더 — 누름~뗌 1항목(D12), 키보드 조작은 1초 병합
    const startFocusContextSlide = () =>
      commitOnPointerRelease(
        beginVariantSlide(
          appState.curSession,
          editingScene,
          'focusContext',
          UNDO_TEXT.variantFocusContext(editingScene.name),
        ),
      );
    // 조합 에디터 탭(2026-10-04 B4, SPEC §7-4) — 미러('shared') 또는 조합 모드 I2I·인페인트('shared'·'snapshot', 인페인트는 P1).
    // 'shared' 는 상위/하위/전역 네거티브 칸이 현재 사전 세팅에 바로 쓰고(실시간 공유), 'snapshot' 은 씬 프리셋의 고정값.
    // 칸 배치(단일 계열 순서·상위/하위 레거시 전용·전역 네거티브 접힘+「사용」)는 ComboPromptEditor(2026-11-03).
    const comboMode = variantComboMode(editingScene);
    // 조합 모드를 끌 수 있는 씬(I2I·인페인트) — 미러는 항상 조합이라 끄기·모드 표시 없음
    const isComboOptional = !isMirror && !!comboMode;
    const globalPreset = comboMode === 'shared' && curSession?.selectedWorkflow
      ? curSession.getCommonSetup(curSession.selectedWorkflow)[1]
      : null;
    const showComboTabs = comboMode === 'snapshot' || (comboMode === 'shared' && !!globalPreset);
    // 조합 탭이 사라졌다 다시 생기면 TabComponent 는 0번 탭으로 새로 시작한다 — 상태도 맞춘다
    useEffect(() => {
      if (!showComboTabs) setPcComboTab(0);
    }, [showComboTabs]);
    useEffect(()=>{
      const toggle=(event:KeyboardEvent)=>{
        if(event.key!=='Tab'||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
        if(!activeEditor||!pointerInside.current||pointerTarget!=='brush'||spaceRef.current||isTextEntryFocused()||appState.dialogs.length)return;
        if(editingScene.workflowType!=='SDInpaint')return;
        event.preventDefault();event.stopImmediatePropagation();
        if(!event.repeat){setPaintTool(value=>value==='mask'?'paint':'mask');setEraserMode(false);}
      };
      window.addEventListener('keydown',toggle,true);return ()=>window.removeEventListener('keydown',toggle,true);
    },[activeEditor,pointerTarget,editingScene]);
    // PC 조합 에디터 탭: 이미지 패널을 hidden(display:none)으로 숨긴다 — 언마운트하지 않아 마스크 캔버스·붓질 이력·
    // Focused 영역이 그대로 남고, 오버레이 크기는 다시 보일 때 ResizeObserver 가 재측정한다. md 미만(모바일)은 불변.
    const pcComboWide = showComboTabs && pcComboTab === 1;
    // 조합 모드 I2I·인페인트는 단일 「프롬프트」 칸 대신 조합 프롬프트 자리가 있는 편집 칸(내용 = ComboPromptEditor).
    // 인페인트의 마스크·Focused 영역 도구는 이미지 패널 그대로.
    const presetEditorElement = isComboOptional
      ? editingScene.workflowType === 'SDInpaint'
        ? SDInpaintComboUI
        : SDI2IComboUI
      : workFlowService.getI2IEditor(editingScene.workflowType);
    const getMiddlePrompt = () => {
      if (editingScene.slots.length > 0 && editingScene.slots[0].length > 0) {
        return editingScene.slots[0][0].prompt;
      }
      return editingScene.preset.prompt || '';
    };

    // 중간 프롬프트 = 프리셋 prompt + 첫 조각(조합 에디터 첫 칸)을 함께 — 입력 칸을 떠날 때 1항목(D13, U5)
    const setMiddlePrompt = (txt: string) => {
      if (txt !== getMiddlePrompt()) {
        touchVariantEdit(
          appState.curSession,
          editingScene,
          { scene: ['slots'], preset: ['prompt'] },
          UNDO_TEXT.sceneMiddlePrompt(editingScene.name),
        );
      }
      editingScene.preset.prompt = txt;
      if (editingScene.slots.length > 0 && editingScene.slots[0].length > 0) {
        editingScene.slots[0][0].prompt = txt;
      }
    };

    const ensureSlots = () => {
      if (editingScene.slots.length === 0) {
        editingScene.slots = [[
          PromptPiece.fromJSON({
            prompt: editingScene.preset.prompt || '',
            characterPrompts: [],
            enabled: true,
            id: uuidv4(),
          }),
        ]];
      }
    };

    // 「조합 모드 끄기」 — slots 는 남기고 comboMode 만 지운다. 단일 프롬프트 = 첫 조합의 중간 프롬프트.
    const turnOffComboMode = async () => {
      const first = enumerateCombinations(editingScene as unknown as Scene, 1)[0];
      const middle = first ? combinationMiddlePrompt(first) : getMiddlePrompt();
      const ok = await appState.confirmAsync({
        text: COMBO_EDITOR_TEXT.turnOffConfirm(middle),
        confirmText: COMBO_EDITOR_TEXT.turnOff,
      });
      if (!ok) return;
      // 되돌리기 = 조합 모드·단일 프롬프트를 함께 되살림(U5). 다시 켜기는 프롬프트 칸 머리 「조합 모드 켜기」(2026-11-03)
      editVariantFields(
        appState.curSession,
        editingScene,
        { scene: ['comboMode'], preset: ['prompt'] },
        UNDO_TEXT.variantComboOff(editingScene.name),
        () => {
          runInAction(() => {
            editingScene.preset.prompt = middle;
            editingScene.comboMode = undefined;
          });
        },
      );
    };

    // 「조합 모드 켜기」(2026-11-03, 끄기의 짝 — SPEC §7-4) — 단일 I2I·인페인트(미러·조합 모드 씬 제외).
    // 단일 계열 편집 칸(SDI2IUI·SDInpaintUI)의 「프롬프트」 칸 머리 줄 오른쪽 끝(끄기 = 중간 프롬프트 머리 줄과 같은 자리 감각).
    // 공유/고정·출처 선택·적용·되돌리기 기록은 comboSource.turnOnComboMode 단일 출처. 켜지면 조합 계열 창(comboTabs)으로 바뀐다.
    const canTurnOn = !isMirror && !comboMode && !isSingleImageEdit(editingScene) && canChooseComboMode(editingScene.workflowType);
    const singleHeaderEnds = canTurnOn
      ? {
          prompt: () => (
            <button
              className="round-button back-gray btn-sm flex-none"
              data-combo-turn-on=""
              onClick={() => void turnOnComboMode(appState.curSession, editingScene)}
            >
              {COMBO_EDITOR_TEXT.turnOn}
            </button>
          ),
        }
      : undefined;

    // 「프롬프트 에디터」 탭의 글자 칸 — 'snapshot' 은 이 변형 씬 프리셋, 'shared' 는 현재 그림체(프로젝트 사전 세팅)에 쓴다.
    // 둘 다 사전 세팅 setField 집약(setWorkflowField)과 같은 편집 세션 기록(D13, U5).
    const setPromptRow = (target: any, field: string, rowLabel: string, v: string) =>
      setWorkflowField(appState.curSession, { preset: target }, 'preset', field, v, {
        label: workflowFieldLabel('preset', rowLabel, { preset: target }, appState.curSession),
        mode: 'edit',
      });

    const comboTabs = (pc: boolean) => [
      {
        label: '프롬프트 에디터',
        emoji: <FaImages />,
        onClick: pc ? () => setPcComboTab(0) : undefined,
        // 단일 계열과 같은 순서의 편집 칸(중간 프롬프트·[상위/하위]·전역 네거티브를 편집 칸 안 「프롬프트」 자리에 끼움,
        // 2026-11-03 정렬 — ComboPromptEditor). 모바일 FloatView·PC 오른쪽 패널 공용.
        content: (
          <ComboPromptEditor
            scene={editingScene}
            mode={comboMode!}
            globalPreset={globalPreset}
            element={presetEditorElement}
            canTurnOff={isComboOptional}
            pc={pc}
            getMiddlePrompt={getMiddlePrompt}
            setMiddlePrompt={setMiddlePrompt}
            setPromptRow={setPromptRow}
            onTurnOff={turnOffComboMode}
            onImageUploaded={onImageUploaded}
          />
        ),
      },
      {
        label: '조합 에디터',
        emoji: <FaPuzzlePiece />,
        onClick: pc
          ? () => {
              ensureSlots();
              setPcComboTab(1);
            }
          : ensureSlots,
        // 조각 캐릭터란 기준 = 이 씬 프리셋의 캐릭터 프롬프트(expandVariantCombos 와 같음 — 씬 캐릭터 역할 모드 없음)
        content: (
          <SlotEditor
            scene={editingScene}
            characterContext={variantCharacterContext(editingScene.preset)}
          />
        ),
      },
    ];

    const uploadMirrorImage = async () => {
      // 모드 선택 다이얼로그
      const selectedMode = await appState.pushDialogAsync({
        type: 'select',
        text: '미러 캔버스 모드를 선택해주세요',
        items: [
          { text: '빈 캔버스 (우측 빈 영역에 새로 생성)', value: 'blank' },
          { text: '이미지 복제 (우측에 원본 복제 후 변형)', value: 'duplicate' },
        ],
      });
      if (!selectedMode) return;
      curSession!.mirrorMode = selectedMode as 'blank' | 'duplicate';

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).replace(
            /^data:image\/[^;]+;base64,/,
            '',
          );
          const storedPath = await imageService.storeVibeImage(
            curSession!,
            base64,
          );
          curSession!.mirrorImage = storedPath;
          // 모든 미러 씬의 캔버스/마스크 초기화 (새 이미지로 재생성되도록)
          for (const [, scene] of curSession!.inpaints) {
            if (scene.workflowType === 'SDMirror' && scene !== editingScene) {
              scene.preset.image = '';
              scene.preset.mask = '';
            }
          }
          await refreshMirrorCanvas();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    };

    const refreshMirrorCanvas = async () => {
      if (!curSession?.mirrorImage) return;
      const srcData = await imageService.fetchVibeImage(
        curSession!,
        curSession.mirrorImage,
      );
      if (!srcData) return;
      const srcBase64 = dataUriToBase64(srcData);
      const result = await prepareMirrorCanvas(srcBase64, curSession!.mirrorMode || 'blank');
      if (!editingScene.preset.image) {
        editingScene.preset.image = await imageService.storeWorkImage(
          curSession!, editingScene, 'input',
          result.canvas,
        );
      } else {
        await imageService.writeVibeImage(
          curSession!,
          editingScene.preset.image,
          result.canvas,
        );
      }
      if (!editingScene.preset.mask) {
        editingScene.preset.mask = await imageService.storeWorkImage(
          curSession!, editingScene, 'mask',
          result.mask,
        );
      } else {
        await imageService.writeVibeImage(
          curSession!,
          editingScene.preset.mask,
          result.mask,
        );
      }
      editingScene.resolution = 'custom';
      editingScene.resolutionWidth = result.width;
      editingScene.resolutionHeight = result.height;
      editingScene.mirrorCropX = result.cropX;
      setImage(result.canvas);
      setWidth(result.width);
      setHeight(result.height);
    };

    useEffect(() => {
      setFocusTool(false);
      if (isMobile) {
        setBrushing(false);
      }
      if (!editingScene) {
        setImage('');
        setMask(undefined);
        return;
      }
      setImage('');
      setMask(undefined);
      let cancelled=false;
      let inputRequest=0;
      async function loadImage() {
        const request=++inputRequest;
        setInputError(undefined);setCanUseStoredInput(false);
        try {
          const data = ['SDInpaint','SDI2I'].includes(editingScene.workflowType)
            ? await imageService.fetchInpaintInput(curSession!,editingScene,editingScene.preset,false)
            : await imageService.fetchVibeImage(curSession!,editingScene.preset.image);
          if(cancelled||request!==inputRequest)return;
          setImage(dataUriToBase64(data!));setInputRevision(value=>value+1);
        } catch (e) {
          if(cancelled||request!==inputRequest)return;
          setInputError(e instanceof Error ? e.message : String(e));
          // Offer the original snapshot explicitly; never silently substitute stale pixels.
          if (!editingScene.meta.get(DETACHED_INPUT_META) && /\.(png|webp)$/i.test(editingScene.preset.image ?? '')) {
            try {
              const stored = await imageService.fetchVibeImage(curSession!, editingScene.preset.image);
              if (stored) {
                await getImageDimensions(dataUriToBase64(stored));
                if(!cancelled&&request===inputRequest)setCanUseStoredInput(true);
              }
            } catch { /* No usable snapshot; keep the source error visible. */ }
          }
        }
      }
      async function loadMask() {
        if (!editingScene.preset.mask) return;
        try {
          const data = await imageService.fetchVibeImage(
            curSession!,
            editingScene.preset.mask,
          );
          if (data) setMask(dataUriToBase64(data));
        } catch (e) {}
      }
      const dispose = reaction(
        () => [editingScene.preset.image, editingScene.sourceImage, editingScene.sourceInpaint, editingScene.sceneRef, editingScene.meta.get(DETACHED_INPUT_META)],
        () => {
          loadImage();
        },
      );
      if (isMirror && !editingScene.preset.image && curSession?.mirrorImage) {
        refreshMirrorCanvas();
      } else {
        loadImage();
      }
      if (def?.hasMask) loadMask();
      else setBrushing(false);
      imageService.addEventListener('image-cache-invalidated', loadImage);
      return () => {
        cancelled=true;
        imageService.removeEventListener('image-cache-invalidated', loadImage);
        dispose();
      };
    }, [editingScene, inputReload]);
    useEffect(() => {
      // 영역 도구가 포인터를 받는 동안 마스크 캔버스는 칠하지 않는다(오버레이가 위에서 받음 — 이중 차단).
      if (pointerTarget === 'brush' && !spaceHeld && paintTool === 'mask') {
        brushTool.current!.startBrushing();
      } else {
        brushTool.current!.stopBrushing();
        if (pointerTarget === 'focus') brushTool.current!.clearPreview();
      }
    }, [pointerTarget,spaceHeld,paintTool]);
    useEffect(() => {
      const scene = editingScene;
      getImageDimensions(image)
        .then(({ width, height }) => {
          setWidth(width);
          setHeight(height);
          if (image) setLoadedDims({ image, width, height });
          // 표시 이미지 크기에 저장된 Focused 사각형을 맞춘다(다른 이미지·작은 이미지 — 무효면 해제).
          // 그사이 다른 씬으로 바뀌었으면 손대지 않는다.
          if (!image || scene !== editingSceneRef.current) return;
          if (!presetSupportsFocus(scene.preset) || scene.workflowType === 'SDMirror') return;
          const r = reconcileFocusRect(presetFocusRect(scene.preset), width, height);
          if (r.kind === 'set') Object.assign(scene.preset, focusRectPresetPatch(r.rect));
          else if (r.kind === 'clear') Object.assign(scene.preset, focusRectPresetPatch(null));
        })
        .catch(() => {});
    }, [image]);

    // 씬 해상도 = 첨부 이미지 크기(R-res, SPEC §7-3) — 업로드·「이미지 크기로 맞추기」 공용.
    const applyResolution = (scene: InpaintScene, r: ImageResolution) => {
      applyImageResolution(scene, r);
      const notice = paidResolutionNotice(r);
      if (notice) appState.pushMessage(notice, 'info');
    };
    // 「이미지 크기로 맞추기」 버튼 = 해상도 3필드 1항목(U5)
    const fitResolution = (r: ImageResolution) =>
      editSceneFields(
        appState.curSession,
        editingScene,
        VARIANT_RESOLUTION_KEYS,
        UNDO_TEXT.variantFitResolution(editingScene.name),
        () => applyResolution(editingScene, r),
      );
    // 편집 창 이미지 입력칸에 새 이미지를 올리면(ⓑ) 저장 뒤 씬 해상도를 그 크기로 맞춘다.
    // 등록된 씬의 비어 있던 이미지 칸이면 ImageSelect → uploadVariantImageRecorded 가 경로 설정 + 이 해상도 맞춤을 1항목으로 담는다
    // (이미 있던 이미지를 덮어쓴 업로드는 기록하지 않음).
    const onImageUploaded = async (field: string, base64: string) => {
      const scene = editingScene;
      if (field === 'image') scene.meta.set(DETACHED_INPUT_META,true);
      if (field !== 'image' || !workflowUsesImageResolution(scene.workflowType)) return;
      const r = await resolutionFromImage(base64);
      if (r) applyResolution(scene, r);
    };
    // 기존 씬 불일치 안내(자동 변경 없음) — 표시 이미지 크기와 요청 해상도(lowerResolution)가 다를 때만.
    const sceneSize =
      editingScene.resolution in resolutionMap
        ? lowerResolution(
            editingScene.resolution as Resolution,
            editingScene.resolutionWidth,
            editingScene.resolutionHeight,
          )
        : { width: undefined, height: undefined };
    const fitTarget =
      image &&
      loadedDims?.image === image &&
      workflowUsesImageResolution(editingScene.workflowType)
        ? imageResolutionMismatch(sceneSize, loadedDims.width, loadedDims.height)
        : undefined;

    const deleteScene = () => {
      appState.pushDialog({
        type: 'confirm',
        ...deleteConfirmText({
          kind: 'inpaintScene',
          name: editingScene.name,
          outcome: { trashDays: SCENE_RETENTION_DAYS },
        }),
        callback: async () => {
          // 휴지통 이동 실패면 씬이 그대로 남는다(2026-10-02 S1) — 알리고 편집 창은 닫지 않는다.
          // 다른 창 잠금으로 조용히 돌아와 씬이 남아 있어도 실패로 센다(SPEC §8, X4).
          // 실제로 휴지통으로 간 경우만 되돌리기 기록(U4)
          const session = curSession!;
          const rec = beginSceneDelete(session);
          const outcome = await runTrashDelete({
            remove: () => rec.trash(editingScene!),
            stillExists: () => session.hasScene('inpaint', editingScene.name),
          });
          rec.commit();
          if (outcome.kind === 'error') {
            appState.pushMessage(outcome.message || '씬을 휴지통으로 옮기지 못했습니다.');
            return;
          }
          if (outcome.kind === 'still-present') {
            appState.pushMessage(DELETE_RESULT_TEXT.sceneStillPresent);
            return;
          }
          // 지운 씬에 닫힐 때 이름 확정이 걸리지 않게 입력값을 원상태로 둔다
          nameDraftRef.current = editingScene.name;
          onConfirm();
          onDelete();
        },
      });
    };

    const brushTool = useRef<WorkflowCanvasRef | null>(null);
    // 브러시 스트로크 후 마스크 데이터를 캐싱 (언마운트 시 ref가 null이므로)
    const cachedMaskRef = useRef<string | null>(null);

    const onDrawEnd = () => {
      if (brushTool.current) {
        cachedMaskRef.current = brushTool.current.getMaskBase64();
      }
    };

    const saveMask = async () => {
      if (inputError || !paintHistory.ready) return;
      await brushTool.current?.saveDrawing?.();
      if (def?.hasMask && brushTool.current) {
        const mask = brushTool.current.getMaskBase64();
        if (!editingScene.preset.mask) {
          editingScene.preset.mask = await imageService.storeWorkImage(
            curSession!, editingScene, 'mask',
            mask,
          );
        } else {
          await imageService.writeVibeImage(
            curSession!,
            editingScene.preset.mask,
            mask,
          );
        }
        cachedMaskRef.current = null; // 이미 저장됨
      }
    };

    // 컴포넌트 언마운트 시 캐싱된 마스크 자동 저장 (ESC로 닫을 때도 마스크 유지)
    useEffect(() => {
      return () => {
        const mask = cachedMaskRef.current;
        const scene = editingScene;
        const session = curSession;
        if (def?.hasMask && session && mask) {
          if (!scene.preset.mask) {
            imageService.storeWorkImage(session, scene, 'mask', mask).then((path) => {
              scene.preset.mask = path;
            });
          } else {
            imageService.writeVibeImage(session, scene.preset.mask, mask);
          }
        }
      };
    }, [editingScene, def?.hasMask, curSession]);

    // 씬 이름(2026-10-03 X15a): 예전에는 매 키 입력마다 scene.name 만 바꿔 Map 키·inpaints 폴더가
    // 옛 이름에 남았다. 입력은 초안으로만 두고 blur/Enter/닫을 때 확정 — 동명·잘못된 이름 거부,
    // 폴더 이동은 renameInpaintScene(다른 창 잠금·withLock·이동 실패 시 무변경) 관문을 거친다.
    const [nameDraft, setNameDraft] = useState(editingScene.name);
    const nameDraftRef = useRef(editingScene.name);
    const nameCommitRef = useRef<string | null>(null); // 진행 중인 확정 대상(중복 확정 방지)
    const mountedRef = useRef(true);
    useEffect(() => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }, []);
    useEffect(() => {
      setNameDraft(editingScene.name);
      nameDraftRef.current = editingScene.name;
      nameCommitRef.current = null;
    }, [editingScene]);
    const sceneRef = useRef(editingScene);
    sceneRef.current = editingScene;
    // 확정이 끝났을 때 다른 씬으로 바뀌어 있으면 그 씬의 입력값을 덮지 않는다
    const updateNameDraft = (v: string, forScene = editingScene) => {
      if (sceneRef.current !== forScene) return;
      nameDraftRef.current = v;
      if (mountedRef.current) setNameDraft(v);
    };
    const commitName = async (typed: string) => {
      const session = curSession;
      if (!session) return;
      const scene = editingScene;
      const oldName = scene.name;
      const check = checkInpaintSceneRename(oldName, typed, (n) =>
        session.inpaints.has(n),
      );
      if (check.kind === 'unchanged') return;
      if (check.kind !== 'ok') {
        appState.pushMessage(check.message);
        updateNameDraft(oldName, scene);
        return;
      }
      if (nameCommitRef.current === check.name) return;
      nameCommitRef.current = check.name;
      try {
        if (session.inpaints.get(oldName) === scene) {
          const changed = await renameInpaintScene(session, oldName, check.name);
          if (!changed) {
            updateNameDraft(scene.name, scene);
            return;
          }
          // 이름 변경이 끝난 뒤(잠금이 풀린 뒤) 되돌리기 기록(U2a)
          recordSceneRename(session, scene, oldName);
        } else {
          // 아직 프로젝트에 등록되지 않은 씬(옮길 폴더 없음) — 이름만 바꾼다
          scene.name = check.name;
        }
        updateNameDraft(scene.name, scene);
      } catch (e: any) {
        appState.pushMessage(e?.message || '씬 이름을 바꾸지 못했습니다.');
        updateNameDraft(scene.name, scene);
      } finally {
        nameCommitRef.current = null;
      }
    };
    // 닫을 때(Esc·저장·바깥) 확정되지 않은 이름이 남아 있으면 확정한다(일반 씬 편집 창과 같음)
    useEffect(() => {
      return () => {
        const draft = nameDraftRef.current;
        if (draft.trimEnd() !== editingScene.name) void commitName(draft);
      };
    }, [editingScene]);

    const confirm = async () => {
      await saveMask();
      onConfirm();
    };
    const queueWork=async()=>{
      if(queuingRef.current||inputError)return false;
      queuingRef.current=true;setQueuing(true);
      try {
        if(!await ensureSingleImagePrompt(curSession!,editingScene,()=>mountedRef.current&&sceneRef.current===editingScene))return false;
        if(isMirror){if(!curSession?.mirrorImage){appState.pushMessage('미러 이미지를 먼저 업로드해주세요.');return false;}await refreshMirrorCanvas();}
        await saveMask();
        const preset={...editingScene.preset};
        if(def?.hasMask&&!isMirror){
          preset.image=await brushTool.current!.getInputImage();
          preset.mask=await imageService.storeWorkImage(curSession!,editingScene,'mask',brushTool.current!.getMaskBase64());
        }
        const count=Math.max(1,Math.min(99,Math.floor(Number(appState.samples)||1)));
        appState.samples=count;
        // Results stay in their output gallery; never promote them to the editing input.
        const queued=isMirror?await queueMirrorWorkflow(curSession!,editingScene.workflowType,preset,editingScene,count)
          :await queueI2IWorkflow(curSession!,editingScene.workflowType,preset,editingScene,count);
        if(queued===0){appState.pushMessage(COMBO_EMPTY_TEXT);return false;}return true;
      }catch(error){appState.pushMessage('생성 예약 실패: '+(error as Error).message,'error');return false;}
      finally{queuingRef.current=false;if(mountedRef.current)setQueuing(false);}
    };
    const queueWorkRef=useRef(queueWork);queueWorkRef.current=queueWork;
    const generationDisabled=queuing||!!inputError||!!def?.hasMask&&!isMirror&&!paintHistory.ready;
    useLayoutEffect(()=>{
      if(!activeEditor)return;
      const target={session:curSession!,scene:editingScene,queue:()=>queueWorkRef.current(),disabled:generationDisabled};
      generationControlState.update({target});
      return ()=>{if(generationControlState.snapshot.target===target)generationControlState.update({target:null});};
    },[activeEditor,curSession,editingScene,generationDisabled]);
    return (
      <div
        className={`sds-inpaint-editor flex flex-col ${pcComboWide ? '' : 'md:flex-row'} py-3 h-full w-full overflow-hidden`}
      >
        <div
          className={`px-3 flex flex-col flex-none ${
            pcComboWide ? 'md:flex-1 md:min-h-0 md:w-full' : 'md:h-auto md:w-1/2 xl:w-1/3'
          } gap-2 overflow-hidden`}
        >
          <div className="flex flex-wrap gap-2">
            <div className="mb-1 flex items-center gap-3 flex-none">
              <label className="gray-label">씬 이름: </label>
              <input
                type="text"
                className="gray-input flex-1"
                value={nameDraft}
                onBlur={(e) => {
                  void commitName(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                onChange={(e) => {
                  updateNameDraft(e.target.value);
                }}
              />
              {editingScene && (
                <button
                  className={`round-button back-red`}
                  onClick={deleteScene}
                >
                  삭제
                </button>
              )}
              <button className={`round-button back-sky`} onClick={confirm}>
                저장
              </button>
            </div>
            <div className="flex-none inline-flex md:flex whitespace-nowrap gap-3 items-center">
              {!isMobile && <span className="gray-label">해상도:</span>}
              <div className="w-36">
                <DropdownSelect
                  options={resolutionOptions}
                  menuPlacement="bottom"
                  selectedOption={editingScene.resolution}
                  onSelect={async (opt) => {
                    if (
                      opt.value.startsWith('large') ||
                      opt.value.startsWith('wallpaper')
                    ) {
                      appState.pushDialog({
                        type: 'confirm',
                        text: '해당 해상도는 Anlas를 소모합니다 (유료임) 계속하시겠습니까?',
                        callback: () => {
                          editResolution(() => {
                            editingScene.resolution = opt.value as Resolution;
                          });
                        },
                      });
                    } else if (opt.value === 'custom') {
                      // 숫자 검증·64px 보정은 공용 흐름(빈칸·문자 거부 — 예전에는 0x0 저장, X15c)
                      const size = await promptCustomResolution({
                        width: editingScene.resolutionWidth,
                        height: editingScene.resolutionHeight,
                      });
                      if (!size) return;
                      editResolution(() => {
                        editingScene.resolution = opt.value as Resolution;
                        editingScene.resolutionWidth = size.width;
                        editingScene.resolutionHeight = size.height;
                      });
                    } else {
                      editResolution(() => {
                        editingScene.resolution = opt.value as Resolution;
                      });
                    }
                  }}
                />
              </div>
            </div>
            {fitTarget && loadedDims && (
              <div className="w-full flex flex-wrap items-center gap-2">
                <span className="gray-label text-xs">
                  {IMAGE_RESOLUTION_TEXT.mismatch(loadedDims, sceneSize)}
                </span>
                <button
                  className="round-button back-sky flex-none"
                  onClick={() => fitResolution(fitTarget)}
                >
                  {IMAGE_RESOLUTION_TEXT.fitButton}
                </button>
              </div>
            )}
          </div>
          {isMirror && (
            <div className="flex flex-wrap gap-2 mt-1">
              <button
                className="round-button back-sky flex-none"
                onClick={uploadMirrorImage}
              >
                <ActionIcon id="import" className="inline mr-1" />
                미러 이미지 {curSession?.mirrorImage ? '변경' : '업로드'}
              </button>
              {curSession?.mirrorImage && (
                <span className="gray-label text-xs self-center">
                  ✓ {curSession.mirrorMode === 'duplicate' ? '이미지 복제' : '빈 캔버스'} 모드
                </span>
              )}
            </div>
          )}
          {open && (
            <FloatView priority={1} onEscape={() => setOpen(false)}>
              {showComboTabs ? (
                <TabComponent tabs={comboTabs(false)} />
              ) : (
                <InnerPreSetEditor
                  type={editingScene.workflowType}
                  preset={editingScene.preset}
                  shared={undefined}
                  element={workFlowService.getI2IEditor(
                    editingScene.workflowType,
                  )}
                  middlePromptMode={false}
                  onImageUploaded={onImageUploaded}
                  fieldHeaderEnds={singleHeaderEnds}
                />
              )}
            </FloatView>
          )}
          <div className="flex-none md:hidden mb-2">
            <button
              className="round-button back-sky w-full"
              onClick={() => setOpen(true)}
            >
              씬 세팅 열기
            </button>
          </div>
          {showComboTabs ? (
            <div className="flex-1 hidden md:flex flex-col overflow-hidden">
              <TabComponent tabs={comboTabs(true)} />
            </div>
          ) : (
            <div className="flex-1 hidden md:block overflow-hidden">
              <InnerPreSetEditor
                nopad
                type={editingScene.workflowType}
                preset={editingScene.preset}
                shared={undefined}
                element={workFlowService.getI2IEditor(editingScene.workflowType)}
                middlePromptMode={false}
                onImageUploaded={onImageUploaded}
                fieldHeaderEnds={singleHeaderEnds}
              />
            </div>
          )}
          {def?.hasMask && !isMirror && <div className={pcComboWide?'md:hidden':''}>
            <InpaintDrawingTools tool={paintTool} setTool={tool=>{setPaintTool(tool);setEraserMode(false);setFocusTool(false);setBrushing(true);}}
              eraser={eraserMode} setEraser={enabled=>{setEraserMode(enabled);setFocusTool(false);setBrushing(true);}}
              color={paintColor} setColor={setPaintColor} opacity={paintOpacity} setOpacity={setPaintOpacity}
              history={paintHistory} canvas={brushTool} brushSize={Number(brushSize)}
              setBrushSize={value=>{setBrushSize(value);brushSizeSaved=value;}}
              onResetView={()=>{setRotation(0);zoomRef.current?.resetTransform();}}
              focusControl={supportsFocus && <Tooltip content={FOCUS_EDITOR_TEXT.toolTooltip}>
                <button className={`round-button icon-only ${focusTool?'back-sky toggle-on':'back-gray'}`}
                  aria-label={FOCUS_EDITOR_TEXT.toolLabel} aria-pressed={focusTool} onClick={selectFocusTool}><ActionIcon id="focus-area"/></button>
              </Tooltip>}
              focusSettings={supportsFocus&&focusTool&&<label className="sds-tool-label">{FOCUS_EDITOR_TEXT.contextLabel} {focusContext}px
                <input aria-label={FOCUS_EDITOR_TEXT.contextLabel} type="range" min={FOCUS_CONTEXT_MIN} max={FOCUS_CONTEXT_MAX} step={FOCUS_GRID}
                  value={focusContext} onPointerDown={startFocusContextSlide} onChange={event=>setVariantPresetField(appState.curSession,editingScene,'focusContext',normalizeFocusContext(Number(event.target.value)),UNDO_TEXT.variantFocusContext(editingScene.name))}/>
              </label>}/>
          </div>}
          {supportsFocus && (focusTool || focusEnabled) && (
            // U4 마스크 규칙 미리보기 — 맥락 띠의 마스크는 요청 때 지워지고, 안쪽이 비면 안쪽 전체를 인페인트.
            <div
              className={`flex-none flex flex-wrap items-center gap-x-2 text-xs text-muted pb-2 ${
                pcComboWide ? 'md:hidden' : ''
              }`}
              data-focus-hint
            >
              <span className="font-bold">
                {!focusEnabled
                  ? 'Focused 꺼짐'
                  : focusRect
                    ? `영역 ${focusRect.w}×${focusRect.h} · ${focusRequestLabel(focusRect, width, height)}`
                    : 'Focused 켜짐'}
              </span>
              <span>{focusRect ? FOCUS_EDITOR_TEXT.maskRule : FOCUS_EDITOR_TEXT.noRect}</span>
              {focusEnabled && (
                <button
                  className="btn-link"
                  onClick={() => {
                    setFocusTool(false);
                    setFocusEnabled(false);
                  }}
                >
                  {FOCUS_EDITOR_TEXT.off}
                </button>
              )}
            </div>
          )}
        </div>
        <div
          className={`flex flex-col flex-1 ${pcComboWide ? 'md:flex-none' : ''} overflow-hidden`}
        >
          {inputError && (
            <div role="alert" className="flex-none m-3 p-3 rounded-lg bg-[var(--c-surface-2)] text-default">
              <p className="font-bold">입력 이미지를 불러오지 못했습니다</p>
              <p className="text-sm text-sub mt-1">{inputError}</p>
              {canUseStoredInput && <p className="text-sm text-sub mt-1">작업 생성 당시 저장본으로 열 수 있습니다. 이후 원본 편집 내용은 포함되지 않으며, 이 작업은 저장본을 사용하게 됩니다.</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" className="round-button back-gray" onClick={() => setInputReload(value => value + 1)}>다시 불러오기</button>
                {canUseStoredInput && <button type="button" className="round-button back-sky" onClick={() => {
                  editingScene.meta.set(DETACHED_INPUT_META, true);
                  sessionService.markDirty(curSession!.name);
                }}>저장된 입력본으로 열기</button>}
              </div>
            </div>
          )}
          {/* PC 조합 에디터 탭: 이미지만 숨기고 아래 생성 바는 남긴다(언마운트 금지 — 마스크·Focused 보존) */}
          <div ref={viewportRef} data-space-pan={spaceHeld} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}} className={`sds-inpaint-viewport flex-1 overflow-hidden ${pcComboWide ? 'md:hidden' : ''}`}>
            <TransformWrapper
              ref={zoomRef} disabled={false} limitToBounds={false}
              panning={{disabled: !spaceHeld && pointerTarget !== 'pan'}}
              wheel={{wheelDisabled:true,step:0.12}} doubleClick={{disabled:true}}
              minScale={0.2} maxScale={8}
              initialScale={0.7}
              centerOnInit={true}
            >
              <TransformComponent wrapperClass="wrapper flex-none items-center justify-center">
                <div className="sds-canvas-rotation" style={{transform:'rotate('+rotation+'deg)'}}>
                <WorkflowCanvas
                  session={curSession!} inputRevision={inputRevision}
                  pointerToImage={(element,event,width,height)=>canvasPointerPoint(element,event,width,height,rotation)}
                  brushPreviewEnabled={activeEditor&&!spaceHeld&&pointerTarget==='brush'&&!isMirror}
                  tool={spaceHeld||pointerTarget!=='brush'?'pan':paintTool==='paint'&&eraserMode?'erase':paintTool}
                  color={paintColor} opacity={paintOpacity} onHistoryChange={setPaintHistory} onPickColor={setPaintColor}
                  brushSize={brushSize}
                  eraserMode={eraserMode}
                  mask={mask ? base64ToDataUri(mask) : undefined}
                  // 씬이 바뀔 때만 캔버스를 mask 로 다시 그린다 — 생성 결과 표시(setImage)로는 붓질 유지
                  resetKey={editingScene}
                  ref={brushTool}
                  image={base64ToDataUri(image)}
                  imageWidth={width}
                  imageHeight={height}
                  onDrawEnd={onDrawEnd}
                  overlay={
                    supportsFocus ? (
                      <FocusAreaOverlay
                        imageWidth={width}
                        imageHeight={height}
                        rect={focusRect}
                        context={focusContext}
                        visible={focusEnabled || focusTool}
                        interactive={!spaceHeld && pointerTarget === 'focus'}
                        pointerToImage={(element,event,width,height)=>canvasPointerPoint(element,event,width,height,rotation)}
                        onCommit={commitFocusDrag}
                      />
                    ) : undefined
                  }
                />
                </div>
              </TransformComponent>
            </TransformWrapper>
          </div>
          <div className="sds-inpaint-generation sds-shared-generation">
            {editingScene.workflowType==='SDInpaint'&&<div className="sds-generation-caption">
              <div className="sds-effective-mode" role="status">{!paintHistory.ready?'마스크 확인 중…':paintHistory.hasMask?'인페인트 · 마스크 영역 변형':'I2I · 이미지 전체 변형 (마스크 없음)'}</div>
              {!isMobile&&<p className="sds-canvas-shortcuts">{['Tab: 펜 전환','휠: 크기','Ctrl+휠: 확대','우클릭: 지우기','Ctrl+우클릭: 스포이드','Space+드래그: 이동','Space+휠: 회전'].map(text=><span key={text}>{text}</span>)}</p>}
            </div>}
            <TaskQueueControl queueCurrent={queueWork} queueDisabled={generationDisabled}/>
          </div>
        </div>
      </div>
    );
  },
);

export default InPaintEditor;
