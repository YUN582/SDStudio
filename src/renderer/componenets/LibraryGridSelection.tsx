import React, { useEffect, useRef, useState } from 'react';
import { backStackService, useBackLayer } from '../models/BackStackService';
import { gridCardUsesSelection, gridClickSelection, gridKeyboardMove, gridSelectionCanReceiveEscape, isGridCardControl } from '../models/gridSelection';
import { canStartSelectionBox, indicesInBox, isOnNativeScrollbar } from '../models/dragSelection';
import { followScroll } from './GridReorder';

type Box = { x1: number; y1: number; x2: number; y2: number };

/** Desktop library selection shares the scene/image range and box rules. */
export function useLibraryGridSelection({ desktop, active, scope, ids, viewport, cardSelector, idOf, suppressClick }: {
  desktop: boolean; active: boolean; scope: string; ids: string[];
  viewport: React.RefObject<HTMLDivElement>; cardSelector: string;
  idOf: (card: HTMLElement) => string | undefined; suppressClick: React.MutableRefObject<boolean>;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [box, setBox] = useState<Box | null>(null);
  const [focusedId, setFocusedId] = useState<string>();
  const anchor = useRef<string>();
  const pending = useRef<(() => void) | null>(null);
  const latest = useRef({ ids, selectedIds, idOf });
  latest.current = { ids, selectedIds, idOf };
  const clear = () => { anchor.current = undefined; setSelectedIds(new Set()); };
  useEffect(() => {
    if (desktop) { clear(); setFocusedId(undefined); }
    return () => pending.current?.();
  }, [desktop, active, scope]);
  const orderKey = JSON.stringify(ids);
  useEffect(() => {
    setSelectedIds(current => {
      const next = new Set([...current].filter(id => latest.current.ids.includes(id)));
      return next.size === current.size ? current : next;
    });
  }, [orderKey]);
  useEffect(() => {
    const classes = ['outline', 'outline-2', 'outline-sky-500', 'outline-offset-2'];
    const cards = Array.from(viewport.current?.querySelectorAll<HTMLElement>(cardSelector) ?? []);
    for (const card of cards) {
      const focused = desktop && active && idOf(card) === focusedId;
      card.dataset.libraryFocused = String(focused);
      for (const name of classes) card.classList.toggle(name, focused);
    }
    return () => { for (const card of cards) { delete card.dataset.libraryFocused; card.classList.remove(...classes); } };
  }, [focusedId, orderKey, desktop, active]);

  const onKeyDownCapture = (event: React.KeyboardEvent) => {
    if (!desktop || !active || event.nativeEvent.isComposing || event.altKey || isGridCardControl(event) || !gridSelectionCanReceiveEscape()) return;
    const order = latest.current.ids, view = viewport.current;
    if (!order.length || !view) return;
    const cards = Array.from(view.querySelectorAll<HTMLElement>(cardSelector));
    const find = (id: string) => cards.find(card => latest.current.idOf(card) === id);
    const current = focusedId ?? [...latest.current.selectedIds].at(-1);
    const direction = ({ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const)[event.key];
    const modifier = event.ctrlKey || event.metaKey;
    if (direction) {
      // The add tile occupies a grid cell too, even though it cannot be selected.
      const siblings = Array.from(cards[0]?.parentElement?.children ?? []);
      const first = siblings[0]?.getBoundingClientRect();
      const columns = first ? siblings.filter(card => Math.abs(card.getBoundingClientRect().top - first.top) < 2).length : 1;
      const next = gridKeyboardMove(order, current, anchor.current, direction, columns, event.shiftKey);
      if (next) {
        setFocusedId(next.key); anchor.current = next.anchor;
        setSelectedIds(next.keys ?? new Set());
        find(next.key)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    } else if (event.key === ' ' && modifier) {
      const id = current ?? order[0];
      const next = gridClickSelection(order, latest.current.selectedIds, anchor.current, id, { ctrlKey: true });
      setFocusedId(id); anchor.current = next.anchor; setSelectedIds(next.keys);
    } else if (event.key.toLowerCase() === 'a' && modifier) {
      setSelectedIds(new Set(order)); setFocusedId(current ?? order[0]); anchor.current ??= order[0];
    } else if (event.key === 'Enter' && !modifier) {
      find(current ?? order[0])?.querySelector<HTMLElement>('[data-library-card-activate]')?.click();
    } else return;
    event.preventDefault(); event.stopPropagation();
  };
  useBackLayer(desktop && active && selectedIds.size > 0, clear, {
    preempt: true, back: 'skip',
    get escape() { return gridSelectionCanReceiveEscape() ? 'close' : 'skip'; },
  });

  const onClickCapture = (event: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false; event.preventDefault(); event.stopPropagation(); return;
    }
    if (!desktop || !active || !gridSelectionCanReceiveEscape()) return;
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>(cardSelector) : null;
    const id = card && viewport.current?.contains(card) ? latest.current.idOf(card) : undefined;
    if (desktop && id !== undefined) setFocusedId(id);
    if (id !== undefined && gridCardUsesSelection(event)) {
      const next = gridClickSelection(latest.current.ids, latest.current.selectedIds, anchor.current, id, event);
      anchor.current = next.anchor; setSelectedIds(next.keys);
      event.preventDefault(); event.stopPropagation();
    } else if (!isGridCardControl(event) && !gridCardUsesSelection(event)) clear();
  };

  const onMouseDownCapture = (event: React.MouseEvent): boolean => {
    suppressClick.current = false;
    if (!desktop || !active || event.button !== 0 || pending.current || !gridSelectionCanReceiveEscape()) return false;
    const view = viewport.current;
    if (!view || !canStartSelectionBox(event.target, false, cardSelector) ||
        (event.target instanceof Element && isOnNativeScrollbar(event.target, event.clientX, event.clientY))) return false;
    event.preventDefault(); view.focus({ preventScroll: true });
    const position = (x: number, y: number) => {
      const bounds = view.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(bounds.width, x - bounds.left)) + view.scrollLeft,
        y: Math.max(0, Math.min(bounds.height, y - bounds.top)) + view.scrollTop,
      };
    };
    const origin = position(event.clientX, event.clientY);
    const base = new Set(latest.current.selectedIds);
    const additive = gridCardUsesSelection(event);
    let point = { x: event.clientX, y: event.clientY };
    let current: Box | null = null;
    let stopScroll: (() => void) | undefined;
    let escape: { remove: () => void } | undefined;
    const update = () => {
      const next = position(point.x, point.y);
      current = { x1: origin.x, y1: origin.y, x2: next.x, y2: next.y };
      setBox(current);
    };
    const cancel = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', cancel); stopScroll?.(); escape?.remove();
      if (current) suppressClick.current = true;
      pending.current = null; setBox(null);
    };
    function move(event: MouseEvent) {
      if (!(event.buttons & 1)) { cancel(); return; }
      point = { x: event.clientX, y: event.clientY };
      if (!current && Math.hypot(point.x - originClient.x, point.y - originClient.y) <= 4) return;
      event.preventDefault(); update();
      if (!stopScroll) {
        stopScroll = followScroll(view!, () => point, update);
        escape = backStackService.push(cancel, { preempt: true, back: 'skip' });
      }
    }
    function finish() {
      if (current) {
        const bounds = view!.getBoundingClientRect();
        const cards = Array.from(view!.querySelectorAll<HTMLElement>(cardSelector));
        const hits = indicesInBox(cards.map((card, index) => {
          const { left, right, top, bottom } = card.getBoundingClientRect();
          return { index, left, right, top, bottom };
        }), {
          x1: current.x1 + bounds.left - view!.scrollLeft, y1: current.y1 + bounds.top - view!.scrollTop,
          x2: current.x2 + bounds.left - view!.scrollLeft, y2: current.y2 + bounds.top - view!.scrollTop,
        }).map(index => latest.current.idOf(cards[index])).filter((id): id is string => id !== undefined);
        const next = new Set(additive ? base : []);
        for (const id of hits) next.add(id);
        anchor.current = hits[0]; setFocusedId(hits.at(-1)); setSelectedIds(next);
      }
      cancel();
    }
    const originClient = { x: event.clientX, y: event.clientY };
    pending.current = cancel;
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', finish);
    window.addEventListener('blur', cancel);
    return true;
  };
  const overlay = box && <div data-library-selection-box=""
    className="absolute bg-sky-500/30 border-2 border-sky-500 rounded pointer-events-none z-50"
    style={{ left: Math.min(box.x1, box.x2), top: Math.min(box.y1, box.y2), width: Math.abs(box.x2 - box.x1), height: Math.abs(box.y2 - box.y1) }} />;
  return { selectedIds, setSelectedIds, clear, onMouseDownCapture, onClickCapture, onKeyDownCapture, overlay };
}
