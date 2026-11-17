import * as React from 'react';
import { createPortal } from 'react-dom';
import BrushTool, { BrushToolProps, BrushToolRef } from './BrushTool';
import { FloatViewActiveContext } from './FloatView';
import { imageService, sessionService } from '../models';
import { appState } from '../models/AppService';
import { isTextEntryFocused } from '../models/keyTargetGuard';
import { InpaintScene, Session } from '../models/types';
import { PAINT_META, paintCanvas, paintImage } from '../models/inpaintInput';

type XY = { x: number; y: number };
type Point = { clientX: number; clientY: number };
type Picked = {
  point: XY;
  clientX: number;
  clientY: number;
  color: string | null;
};
type HistoryItem = {
  kind: 'paint' | 'mask';
  before: ImageData | string;
  after: ImageData | string;
};
type PaintDocument = {
  layer: HTMLCanvasElement;
  layerPath?: string;
  past: HistoryItem[];
  future: HistoryItem[];
  stroke: {
    before: ImageData;
    points: XY[];
    erase: boolean;
    size: number;
    color: string;
    opacity: number;
  } | null;
  ready: boolean;
  restoring?: boolean;
  pending: Promise<void>;
  revision: number;
  source: string;
  base: string;
  initialImage: string;
  mask: string;
};
export interface PaintHistory {
  undo: boolean;
  redo: boolean;
  ready: boolean;
  hasMask?: boolean;
}
export interface WorkflowCanvasProps extends Omit<BrushToolProps, 'resetKey'> {
  resetKey: InpaintScene;
  tool: 'mask' | 'paint' | 'erase' | 'pan';
  color: string;
  opacity: number;
  session: Session;
  onHistoryChange?: (history: PaintHistory) => void;
  inputRevision: number;
  brushPreviewEnabled?: boolean;
  onPickColor?: (color: string) => void;
}
export interface WorkflowCanvasRef extends Pick<
  BrushToolRef,
  'getMaskBase64' | 'startBrushing' | 'stopBrushing' | 'clearPreview' | 'clear'
> {
  focus(): void;
  clearDrawing(): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  saveDrawing(): Promise<void>;
  getInputImage(): Promise<string>;
}
const WorkflowCanvas = React.forwardRef<WorkflowCanvasRef, WorkflowCanvasProps>(
  function WorkflowCanvas(props, ref) {
    const {
      image,
      imageWidth: width,
      imageHeight: height,
      mask,
      resetKey: scene,
      brushSize,
      overlay,
      onDrawEnd,
      tool,
      color,
      opacity,
      session,
      onHistoryChange,
      inputRevision,
    } = props;
    const maskRef = React.useRef<BrushToolRef>(null),
      layerRef = React.useRef<HTMLCanvasElement>(null),
      hostRef = React.useRef<HTMLDivElement>(null),
      doc = React.useRef<PaintDocument | null>(null);
    const active = React.useContext(FloatViewActiveContext);
    const [loaded, setLoaded] = React.useState(false);
    const [box, setBox] = React.useState({
      width: 0,
      height: 0,
    });
    const [baseOverride, setBaseOverride] = React.useState<string | null>(null);
    const pointerRef = React.useRef<Point | null>(null);
    const pickingRef = React.useRef<number | null>(null),
      loupeRef = React.useRef<HTMLCanvasElement>(null);
    const [picked, setPicked] = React.useState<Picked | null>(null);
    const [cursor, setCursor] = React.useState<XY | null>(null);
    const previewEnabled =
      active &&
      loaded &&
      props.brushPreviewEnabled !== false &&
      (tool === 'mask' || tool === 'paint' || tool === 'erase');
    const imagePoint = (event: Point) => {
      const canvas =
        hostRef.current?.querySelector<HTMLCanvasElement>('canvas.canvas');
      if (!canvas) return null;
      const point = props.pointerToImage
        ? props.pointerToImage(canvas, event, width, height)
        : (() => {
            const r = canvas.getBoundingClientRect();
            return {
              x: ((event.clientX - r.x) * width) / r.width,
              y: ((event.clientY - r.y) * height) / r.height,
            };
          })();
      return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height
        ? point
        : null;
    };
    const updateCursor = () =>
      setCursor(
        previewEnabled && pointerRef.current
          ? imagePoint(pointerRef.current)
          : null,
      );
    React.useLayoutEffect(updateCursor, [
      previewEnabled,
      width,
      height,
      box.width,
      box.height,
      brushSize,
      props.pointerToImage,
    ]);
    const trackPointer = (event: React.PointerEvent<HTMLDivElement>) => {
      if (pickingRef.current !== null) {
        if (!event.ctrlKey || !(event.buttons & 2)) {
          finishPicking();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        sampleColor(event);
        return;
      }
      pointerRef.current =
        event.pointerType === 'touch'
          ? null
          : { clientX: event.clientX, clientY: event.clientY };
      updateCursor();
    };
    const sampleColor = (event: Point) => {
      const point = imagePoint(event),
        base =
          hostRef.current?.querySelector<HTMLImageElement>('.canvas-image'),
        d = doc.current;
      if (!point || !base?.complete || !base.naturalWidth || !d?.ready) return;
      const sample = document.createElement('canvas');
      sample.width = sample.height = 1;
      const ctx = sample.getContext('2d')!,
        x = Math.floor(point.x),
        y = Math.floor(point.y);
      ctx.drawImage(
        base,
        (x * base.naturalWidth) / width,
        (y * base.naturalHeight) / height,
        base.naturalWidth / width,
        base.naturalHeight / height,
        0,
        0,
        1,
        1,
      );
      ctx.drawImage(d.layer, x, y, 1, 1, 0, 0, 1, 1);
      const rgba = ctx.getImageData(0, 0, 1, 1).data;
      const color = rgba[3]
        ? '#' +
          Array.from(rgba.slice(0, 3), (v) =>
            v.toString(16).padStart(2, '0'),
          ).join('')
        : null;
      if (color) props.onPickColor?.(color);
      setPicked({
        point: { x, y },
        clientX: event.clientX,
        clientY: event.clientY,
        color,
      });
    };
    const finishPicking = () => {
      const pointerId = pickingRef.current;
      pickingRef.current = null;
      if (pointerId !== null && hostRef.current?.hasPointerCapture?.(pointerId))
        hostRef.current.releasePointerCapture(pointerId);
      setPicked(null);
      setCursor(null);
    };
    const pickColor = (event: React.PointerEvent<HTMLDivElement>) => {
      if (previewEnabled && [0, 2].includes(event.button))
        hostRef.current?.focus({ preventScroll: true });
      if (
        !previewEnabled ||
        !event.ctrlKey ||
        event.button !== 2 ||
        !props.onPickColor
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      pickingRef.current = event.pointerId;
      hostRef.current?.setPointerCapture?.(event.pointerId);
      setCursor(null);
      sampleColor(event);
    };
    const endPicking = (event: React.PointerEvent<HTMLDivElement>) => {
      if (pickingRef.current === null) return;
      event.preventDefault();
      event.stopPropagation();
      finishPicking();
    };
    React.useEffect(() => {
      const release = (event: KeyboardEvent) => {
        if (event.key === 'Control') finishPicking();
      };
      window.addEventListener('keyup', release, true);
      window.addEventListener('blur', finishPicking);
      return () => {
        window.removeEventListener('keyup', release, true);
        window.removeEventListener('blur', finishPicking);
      };
    }, []);
    React.useEffect(() => {
      if (!previewEnabled) finishPicking();
    }, [previewEnabled]);
    React.useLayoutEffect(() => {
      const canvas = loupeRef.current,
        base =
          hostRef.current?.querySelector<HTMLImageElement>('.canvas-image'),
        d = doc.current;
      if (!picked || !canvas || !base?.naturalWidth || !d) return;
      const ctx = canvas.getContext('2d')!,
        sx = picked.point.x - 12,
        sy = picked.point.y - 12;
      ctx.clearRect(0, 0, 96, 96);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        base,
        (sx * base.naturalWidth) / width,
        (sy * base.naturalHeight) / height,
        (24 * base.naturalWidth) / width,
        (24 * base.naturalHeight) / height,
        0,
        0,
        96,
        96,
      );
      ctx.drawImage(d.layer, sx, sy, 24, 24, 0, 0, 96, 96);
    }, [picked, width, height]);
    const generatedPreview =
      doc.current && image !== doc.current.initialImage && !baseOverride;
    const report = () => {
      const d = doc.current;
      onHistoryChange?.({
        undo: !!d?.past.length,
        redo: !!d?.future.length,
        ready: !!d?.ready,
        hasMask: !!maskRef.current?.hasMask(),
      });
    };
    const renderLayer = () => {
      const d = doc.current,
        canvas = layerRef.current;
      if (!d || !canvas) return;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(d.layer, 0, 0);
    };
    const persist = () => {
      const d = doc.current;
      if (!d?.ready) return Promise.resolve();
      const revision = ++d.revision,
        png = d.layer.toDataURL('image/png').split(',')[1];
      d.pending = d.pending
        .catch(() => {})
        .then(async () => {
          if (revision !== d.revision || scene.preset.image !== d.source)
            return;
          if (d.layerPath)
            await imageService.writeVibeImage(session, d.layerPath, png);
          else d.layerPath = await imageService.storeWorkImage(session, scene, 'drawing', png);
          if (revision !== d.revision || scene.preset.image !== d.source)
            return;
          scene.meta.set(PAINT_META, {
            source: d.source,
            layer: d.layerPath,
            owner: scene.name,
          });
          sessionService.markDirty(session.name);
        });
      d.pending.catch((error) =>
        appState.pushMessage('그림 저장 실패: ' + error.message, 'error'),
      );
      return d.pending;
    };
    const remember = (
      kind: HistoryItem['kind'],
      before: ImageData | string,
      after: ImageData | string,
    ) => {
      const d = doc.current!;
      d.past.push({
        kind,
        before,
        after,
      });
      d.future = [];
      const max = Math.max(
        2,
        Math.min(
          30,
          Math.floor((64 * 1024 * 1024) / Math.max(1, width * height * 8)),
        ),
      );
      if (d.past.length > max) d.past.shift();
      report();
    };
    const travel = async (redo: boolean) => {
      const d = doc.current;
      if (!d?.ready || d.stroke || d.restoring) return;
      const from = redo ? d.future : d.past,
        to = redo ? d.past : d.future,
        item = from.pop();
      if (!item) return;
      d.restoring = true;
      try {
        const state = redo ? item.after : item.before;
        if (item.kind === 'paint') {
          setBaseOverride(d.base);
          d.layer.getContext('2d')!.putImageData(state as ImageData, 0, 0);
          renderLayer();
          void persist();
        } else {
          await maskRef.current!.restoreMask(state as string);
          d.mask = state as string;
          onDrawEnd?.();
        }
        to.push(item);
      } finally {
        d.restoring = false;
        report();
      }
    };
    React.useEffect(() => {
      if (!width || !height || !image || !maskRef.current) return;
      let cancelled = false;
      const layer = paintCanvas(width, height);
      const d: PaintDocument = {
        layer,
        past: [],
        future: [],
        stroke: null,
        ready: false,
        pending: Promise.resolve(),
        revision: 0,
        source: scene.preset.image,
        base: image,
        initialImage: image,
        mask: maskRef.current!.getMaskBase64(),
      };
      doc.current = d;
      setLoaded(false);
      setBaseOverride(null);
      const restore = async () => {
        const saved = scene.meta.get(PAINT_META);
        if (saved?.source === d.source && saved.layer) {
          const paint = await imageService.fetchVibeImage(session, saved.layer);
          if (!paint) throw new Error('저장된 밑그림을 읽지 못했습니다.');
          const bitmap = await paintImage(paint);
          if (cancelled) return;
          layer.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
          if (saved.owner === scene.name) d.layerPath = saved.layer;
        }
        if (cancelled) return;
        d.ready = true;
        setLoaded(true);
        renderLayer();
        report();
      };
      restore().catch((error) => {
        if (!cancelled) appState.pushMessage(error.message, 'error');
      });
      return () => {
        cancelled = true;
      };
    }, [scene, scene.preset.image, width, height, !!image]);
    React.useEffect(() => {
      const d = doc.current;
      if (d && image) {
        d.base = image;
        d.initialImage = image;
        setBaseOverride(null);
      }
    }, [inputRevision]);
    React.useLayoutEffect(() => {
      const canvas =
        hostRef.current?.querySelector<HTMLCanvasElement>('canvas.canvas');
      if (!canvas) return;
      const measure = () =>
        setBox({
          width: canvas.offsetWidth,
          height: canvas.offsetHeight,
        });
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(canvas);
      return () => observer.disconnect();
    }, [width, height, loaded]);
    React.useEffect(() => {
      renderLayer();
    }, [loaded, width, height]);
    React.useEffect(() => {
      const keydown = (event: KeyboardEvent) => {
        if (
          !previewEnabled ||
          !(event.ctrlKey || event.metaKey) ||
          !['z', 'y'].includes(event.key.toLowerCase())
        )
          return;
        if (
          isTextEntryFocused() ||
          appState.dialogs.length ||
          !hostRef.current?.getClientRects().length
        )
          return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void travel(event.key.toLowerCase() === 'y' || event.shiftKey);
      };
      window.addEventListener('keydown', keydown, true);
      return () => window.removeEventListener('keydown', keydown, true);
    });
    React.useImperativeHandle(ref, () => ({
      focus: () => hostRef.current?.focus({ preventScroll: true }),
      getMaskBase64: () => maskRef.current?.getMaskBase64() || '',
      startBrushing: () => maskRef.current?.startBrushing(),
      stopBrushing: () => maskRef.current?.stopBrushing(),
      clearPreview: () => maskRef.current?.clearPreview(),
      clear: () => {
        if (!doc.current?.ready) return;
        hostRef.current?.focus({ preventScroll: true });
        const before = maskRef.current!.getMaskBase64();
        maskRef.current!.clear();
        const after = maskRef.current!.getMaskBase64();
        remember('mask', before, after);
        doc.current!.mask = after;
        onDrawEnd?.();
      },
      clearDrawing: () => {
        const d = doc.current;
        if (!d?.ready || d.stroke || d.restoring) return;
        hostRef.current?.focus({ preventScroll: true });
        const ctx = d.layer.getContext('2d')!;
        const before = ctx.getImageData(0, 0, width, height);
        if (!before.data.some((value, index) => index % 4 === 3 && value > 0))
          return;
        ctx.clearRect(0, 0, width, height);
        remember('paint', before, ctx.getImageData(0, 0, width, height));
        renderLayer();
        void persist();
      },
      undo: () => {
        hostRef.current?.focus({ preventScroll: true });
        return travel(false);
      },
      redo: () => {
        hostRef.current?.focus({ preventScroll: true });
        return travel(true);
      },
      saveDrawing: () => doc.current?.pending ?? Promise.resolve(),
      getInputImage: async () => {
        const d = doc.current;
        if (!d?.ready)
          throw new Error('이미지를 불러온 뒤 다시 시도해 주세요.');
        await d.pending;
        return (await imageService.fetchInpaintInput(session, scene)).split(
          ',',
        )[1];
      },
    }));
    const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (props.pointerToImage)
        return props.pointerToImage(event.currentTarget, event, width, height);
      const rect = event.currentTarget.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) * width) / rect.width,
        y: ((event.clientY - rect.top) * height) / rect.height,
      };
    };
    const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const d = doc.current;
      if (!d?.stroke) return;
      const stroke = d.stroke;
      stroke.points.push(point(event));
      const ctx = d.layer.getContext('2d')!;
      ctx.putImageData(stroke.before, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = stroke.erase
        ? 'destination-out'
        : 'source-over';
      ctx.globalAlpha = stroke.opacity;
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      const first = stroke.points[0];
      if (stroke.points.length === 1) {
        ctx.arc(first.x, first.y, stroke.size / 2, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.moveTo(first.x, first.y);
        for (const p of stroke.points.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
      ctx.restore();
      renderLayer();
    };
    const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
      const d = doc.current;
      if (!d?.stroke) return;
      remember(
        'paint',
        d.stroke.before,
        d.layer.getContext('2d')!.getImageData(0, 0, width, height),
      );
      d.stroke = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      void persist();
    };
    const Brush = BrushTool;
    return React.createElement(
      'div',
      {
        ref: hostRef,
        className: 'sds-paint-host',
        tabIndex: -1,
        'data-canvas-history-active': previewEnabled ? 'true' : undefined,
        'data-brush-preview':
          previewEnabled && cursor && !picked ? 'true' : undefined,
        'data-eyedropper': picked ? 'true' : undefined,
        onPointerMoveCapture: trackPointer,
        onPointerEnter: trackPointer,
        onPointerDownCapture: pickColor,
        onPointerUpCapture: endPicking,
        onPointerCancelCapture: endPicking,
        onLostPointerCapture: () => {
          if (pickingRef.current !== null) finishPicking();
        },
        onPointerLeave: () => {
          pointerRef.current = null;
          setCursor(null);
        },
      },
      React.createElement(
        Brush,
        Object.assign({}, props, {
          ref: maskRef,
          image: baseOverride || image,
          disableUndo: true,
          showBrushPreview: false,
          onMaskReady: () => {
            if (doc.current)
              doc.current.mask = maskRef.current!.getMaskBase64();
            report();
          },
          onDrawEnd: () => {
            const d = doc.current,
              after = maskRef.current!.getMaskBase64();
            if (d?.ready && d.mask !== after) remember('mask', d.mask, after);
            if (d) d.mask = after;
            onDrawEnd?.();
          },
          overlay: tool === 'mask' ? overlay : null,
          paintLayer: React.createElement('canvas', {
            ref: layerRef,
            width: width,
            height: height,
            'aria-label': '\uC778\uD398\uC778\uD2B8 \uBC11\uADF8\uB9BC',
            className: 'sds-paint-layer',
            style: {
              width: box.width,
              height: box.height,
              zIndex: tool === 'mask' ? 1 : 4,
              opacity: generatedPreview ? 0 : 1,
              pointerEvents:
                tool === 'paint' || tool === 'erase' ? 'auto' : 'none',
            },
            onPointerDown: (event: React.PointerEvent<HTMLCanvasElement>) => {
              const d = doc.current;
              if (
                !d?.ready ||
                d.restoring ||
                ![0, 2].includes(event.button) ||
                event.ctrlKey
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              setBaseOverride(d.base);
              event.currentTarget.setPointerCapture(event.pointerId);
              d.stroke = {
                before: d.layer
                  .getContext('2d')!
                  .getImageData(0, 0, width, height),
                points: [],
                erase: event.button === 2 || tool === 'erase',
                size: Number(brushSize) * 2,
                color,
                opacity,
              };
              draw(event);
            },
            onPointerMove: draw,
            onPointerUp: finish,
            onPointerCancel: finish,
          }),
        }),
      ),
      previewEnabled &&
        cursor &&
        !picked &&
        React.createElement(
          'svg',
          {
            className: 'sds-brush-preview',
            'aria-hidden': true,
            width: box.width,
            height: box.height,
            viewBox: '0 0 ' + width + ' ' + height,
            preserveAspectRatio: 'none',
            'data-radius': Number(brushSize),
          },
          React.createElement('circle', {
            cx: cursor.x,
            cy: cursor.y,
            r: Number(brushSize),
            fill: 'none',
            stroke: 'black',
            strokeWidth: 3,
            vectorEffect: 'non-scaling-stroke',
          }),
          React.createElement('circle', {
            cx: cursor.x,
            cy: cursor.y,
            r: Number(brushSize),
            fill: 'none',
            stroke: 'white',
            strokeWidth: 1,
            vectorEffect: 'non-scaling-stroke',
          }),
        ),
      picked &&
        createPortal(
          React.createElement(
            'div',
            {
              className: 'sds-eyedropper-preview',
              style: {
                left: Math.max(
                  8,
                  Math.min(window.innerWidth - 120, picked.clientX + 24),
                ),
                top: Math.max(
                  8,
                  Math.min(window.innerHeight - 144, picked.clientY - 48),
                ),
              },
              'aria-hidden': true,
            },
            React.createElement(
              'div',
              { className: 'sds-eyedropper-magnifier' },
              React.createElement('canvas', {
                ref: loupeRef,
                width: 96,
                height: 96,
              }),
              React.createElement('span', {
                className: 'sds-eyedropper-target',
              }),
            ),
            React.createElement(
              'div',
              { className: 'sds-eyedropper-color' },
              React.createElement('span', {
                style: { background: picked.color || 'transparent' },
              }),
              picked.color?.toUpperCase() || '투명',
            ),
          ),
          document.body,
        ),
    );
  },
);

export default WorkflowCanvas;
