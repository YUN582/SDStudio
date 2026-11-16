import type { ReactNode, RefObject } from 'react';
import type { PaintHistory, WorkflowCanvasRef } from './WorkflowCanvas';
interface Props {
  tool: 'mask' | 'paint';
  setTool: (tool: 'mask' | 'paint') => void;
  color: string;
  setColor: (color: string) => void;
  opacity: number;
  setOpacity: (value: number) => void;
  history: PaintHistory;
  canvas: RefObject<WorkflowCanvasRef>;
  brushSize: number;
  setBrushSize: (value: number) => void;
  focusControl?: ReactNode;
  focusSettings?: ReactNode;
  onResetView: () => void;
}
export function InpaintDrawingTools({
  tool,
  setTool,
  color,
  setColor,
  opacity,
  setOpacity,
  history,
  canvas,
  brushSize,
  setBrushSize,
  focusControl,
  focusSettings,
  onResetView,
}: Props) {
  return (
    <div
      className="sds-compact-tools"
      role="toolbar"
      aria-label="인페인트 그리기 도구"
    >
      <div className="sds-tools-primary">
        <div
          className="sds-tool-group sds-mode-tools"
          role="group"
          aria-label="마스크 도구"
        >
          <button
            type="button"
            className={
              'round-button ' + (tool === 'mask' ? 'back-sky' : 'back-gray')
            }
            aria-pressed={tool === 'mask'}
            onClick={() => {
              setTool('mask');
              canvas.current?.focus();
            }}
          >
            마스크
          </button>
          <button
            type="button"
            className="round-button sds-tool-reset"
            aria-label="마스크 초기화"
            title="마스크 초기화"
            disabled={!history.ready}
            onClick={() => canvas.current?.clear()}
          >
            초기화
          </button>
        </div>
        <div
          className="sds-tool-group sds-mode-tools"
          role="group"
          aria-label="그리기 도구"
        >
          <button
            type="button"
            className={
              'round-button ' + (tool === 'paint' ? 'back-sky' : 'back-gray')
            }
            aria-pressed={tool === 'paint'}
            onClick={() => {
              setTool('paint');
              canvas.current?.focus();
            }}
          >
            그리기
          </button>
          <button
            type="button"
            className="round-button sds-tool-reset"
            aria-label="그리기 초기화"
            title="그리기 초기화"
            disabled={!history.ready}
            onClick={() => canvas.current?.clearDrawing()}
          >
            초기화
          </button>
        </div>
        {focusControl}
        <span className="sds-tool-group sds-history-tools">
          <button
            type="button"
            className="round-button back-gray"
            disabled={!history.undo}
            title="실행 취소 (Ctrl+Z)"
            onClick={() => canvas.current?.undo()}
          >
            실행 취소
          </button>
          <button
            type="button"
            className="round-button back-gray"
            disabled={!history.redo}
            title="다시 실행 (Ctrl+Y)"
            onClick={() => canvas.current?.redo()}
          >
            다시 실행
          </button>
        </span>
      </div>
      <div className="sds-tools-settings">
        <label className="sds-tool-label">
          색상{' '}
          <input
            aria-label="그리기 색상"
            type="color"
            value={color}
            disabled={tool === 'mask'}
            onChange={(event) => setColor(event.target.value)}
          />
        </label>
        <label className="sds-tool-label">
          불투명도{' '}
          <input
            aria-label="그리기 불투명도"
            type="range"
            min="1"
            max="100"
            value={Math.round(opacity * 100)}
            disabled={tool === 'mask'}
            onChange={(event) => setOpacity(Number(event.target.value) / 100)}
          />
          <span className="sds-tool-value">{Math.round(opacity * 100)}%</span>
        </label>
        <label className="sds-tool-label">
          크기{' '}
          <input
            aria-label="브러시 크기"
            type="range"
            min="1"
            max="100"
            value={brushSize}
            onChange={(event) => setBrushSize(Number(event.target.value))}
          />
          <span className="sds-tool-value">{brushSize}</span>
        </label>
        <button
          type="button"
          className="round-button back-gray sds-view-reset"
          title="회전·확대·이동을 처음 보기 상태로 초기화"
          onClick={onResetView}
        >
          보기 초기화
        </button>
      </div>
      {focusSettings && (
        <div className="sds-focus-settings">{focusSettings}</div>
      )}
    </div>
  );
}
