import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { backStackService } from '../models/BackStackService';
import { gridCardUsesSelection, gridSelectionCanReceiveEscape, isGridCardControl } from '../models/gridSelection';

type Point = { x: number; y: number };
interface CardPreview {
  width: number; height: number; offsetX: number; offsetY: number;
  theme: Element; attach: (host: HTMLDivElement | null) => void;
}
export interface GridDrag<T> { preview: CardPreview; point: Point; items: T[]; target?: T }

export function captureCard(card: HTMLElement, event: Pick<MouseEvent, 'clientX' | 'clientY'>): CardPreview | undefined {
  const bounds = card.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const copy = card.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  for (const child of Array.from(copy.querySelectorAll('[id]'))) child.removeAttribute('id');
  // Virtual grid cells carry absolute row/column offsets. The floating host
  // already owns positioning; keeping those offsets displaces the pixels from its shadow.
  Object.assign(copy.style, {
    position: 'relative', top: '0', left: '0', right: 'auto', bottom: 'auto',
    transform: 'none', margin: '0', width: '100%', height: '100%',
    animation: 'none', transition: 'none',
  });
  for (const child of Array.from(copy.querySelectorAll<HTMLElement>('.image-anime'))) {
    child.style.animation = 'none';
  }
  return {
    width: bounds.width, height: bounds.height,
    offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top,
    theme: card.closest('[data-app-theme-root]') ?? document.body,
    attach: host => { if (host && host.firstChild !== copy) host.replaceChildren(copy); },
  };
}

export function ReorderDragPreview<T>({ type, drag }: { type: string; drag: GridDrag<T> }) {
  const { preview, point, items } = drag;
  return createPortal(
    <div data-reorder-drag-preview={type} aria-hidden="true" style={{ position: 'fixed', inset: 0, overflow: 'hidden', contain: 'strict', pointerEvents: 'none', zIndex: 'var(--z-dnd-preview)' }}>
      <div className="absolute" style={{ left: point.x - preview.offsetX, top: point.y - preview.offsetY, width: preview.width, height: preview.height, rotate: '2deg', scale: '1.025' }}>
        {Array.from({ length: Math.min(2, items.length - 1) }, (_, i) => i + 1).reverse().map(depth =>
          <div key={depth} data-reorder-stack-card="" className="absolute inset-0 rounded-lg border line-color bg-[var(--c-zone)]" style={{ transform: `translate(${depth * 6}px,${depth * 5}px) rotate(${depth * 3}deg)` }} />)}
        <div ref={preview.attach} className="relative w-full h-full rounded-lg" style={{ boxShadow: '0 8px 22px rgba(0,0,0,0.32)' }} />
        {items.length > 1 && <span data-reorder-count="" className="absolute top-1 right-1 rounded-full bg-[var(--c-surface-2)] text-default border line-color px-2 py-0.5 text-xs font-bold shadow">{items.length}</span>}
      </div>
    </div>, preview.theme,
  );
}

export function followScroll(viewport: HTMLElement, readPoint: () => Point | undefined, refresh: (point: Point) => void) {
  let request = 0, last = 0, left = viewport.scrollLeft, top = viewport.scrollTop, moved = false;
  const speed = (value: number, min: number, max: number) => {
    if (value < min || value >= max) return 0;
    const zone = Math.min(64, (max - min) / 3);
    const start = (value - min) / zone, end = (max - value) / zone;
    return start < 1 ? -Math.ceil(22 * (1 - start)) : end < 1 ? Math.ceil(22 * (1 - end)) : 0;
  };
  const tick = (time: number) => {
    const point = readPoint();
    if (!point || !viewport.isConnected) return;
    const bounds = viewport.getBoundingClientRect();
    const right = bounds.left + viewport.clientWidth, bottom = bounds.top + viewport.clientHeight;
    const step = last ? Math.min(2, (time - last) / 16.67) : 1;
    last = time;
    if (point.x >= bounds.left && point.x < right && point.y >= bounds.top && point.y < bottom) {
      if (viewport.scrollWidth > viewport.clientWidth) viewport.scrollLeft += speed(point.x, bounds.left, right) * step;
      if (viewport.scrollHeight > viewport.clientHeight) viewport.scrollTop += speed(point.y, bounds.top, bottom) * step;
    }
    const changed = left !== viewport.scrollLeft || top !== viewport.scrollTop;
    left = viewport.scrollLeft; top = viewport.scrollTop;
    if (changed || moved) refresh(point);
    moved = changed;
    request = requestAnimationFrame(tick);
  };
  request = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(request);
}

/** Pointer reordering leaves wheel scrolling native; selection boxes remain separate. */
export function useGridReorder<T>({ enabled, scope, viewport, cardSelector, resolve, selected, commit, suppressClick }: {
  enabled: boolean; scope: unknown; viewport: React.RefObject<HTMLElement>;
  cardSelector: string; resolve: (card: HTMLElement) => T | undefined;
  selected: (item: T) => T[]; commit: (item: T, target: T, group: T[]) => void;
  suppressClick: React.MutableRefObject<boolean>;
}) {
  const [drag, setDrag] = useState<GridDrag<T> | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const actions = useRef({ resolve, selected, commit });
  actions.current = { resolve, selected, commit };
  useEffect(() => () => pending.current?.(), [enabled, scope]);
  const start = (event: React.MouseEvent) => {
    if (!enabled || event.button !== 0 || gridCardUsesSelection(event) || event.altKey ||
        isGridCardControl(event) || pending.current || !gridSelectionCanReceiveEscape()) return;
    const view = viewport.current;
    const element = event.target instanceof Element ? event.target : null;
    if (!view || element?.closest('[data-no-scene-drag]')) return;
    const card = element?.closest<HTMLElement>(cardSelector);
    if (!card || !view.contains(card)) return;
    const item = actions.current.resolve(card);
    if (item === undefined) return;
    const preview = captureCard(card, event);
    if (!preview) return;
    const items = actions.current.selected(item);
    const origin = { x: event.clientX, y: event.clientY };
    let moving: GridDrag<T> | null = null;
    let stopScroll: (() => void) | undefined;
    let escape: { remove: () => void } | undefined;
    const targetAt = (point: Point) => {
      const hit = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>(cardSelector);
      if (!hit || !view.contains(hit)) return;
      const target = actions.current.resolve(hit);
      return target !== undefined && !items.includes(target) ? target : undefined;
    };
    const update = (point: Point, keepPreview = false) => {
      const target = targetAt(point);
      if (keepPreview && moving?.target === target) return;
      moving = { preview, point, items, target };
      setDrag(moving);
    };
    function clear() {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', clear);
      escape?.remove(); stopScroll?.();
      if (moving) { suppressClick.current = true; setDrag(null); }
      pending.current = null;
    }
    function move(event: MouseEvent) {
      if (!(event.buttons & 1)) { clear(); return; }
      const point = { x: event.clientX, y: event.clientY };
      if (!moving && Math.hypot(point.x - origin.x, point.y - origin.y) <= 4) return;
      event.preventDefault(); update(point);
      if (!stopScroll) {
        escape = backStackService.push(clear, { preempt: true, back: 'skip' });
        stopScroll = followScroll(view!, () => moving?.point, point => update(point, true));
      }
    }
    function finish(event: MouseEvent) {
      const target = moving ? targetAt({ x: event.clientX, y: event.clientY }) : undefined;
      clear();
      if (target !== undefined) actions.current.commit(item!, target, items);
    }
    pending.current = clear;
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', finish);
    window.addEventListener('blur', clear);
  };
  return { drag, start };
}
