import React, { useEffect, useRef, useState } from 'react';
import { backend, imageService, isMobile } from '../models';
import { appState } from '../models/AppService';
import { GenerationHistoryEntry } from '../models/ImageHistoryService';
import { dropHistoryImage } from '../models/historyImageDrop';
import { dataUriToBase64 } from '../models/ImageService';
import { backStackService } from '../models/BackStackService';
import { captureCard, followScroll, GridDrag, ReorderDragPreview } from './GridReorder';

function dropTarget(x: number, y: number) {
  const hit = document.elementFromPoint(x, y);
  const scene = hit?.closest<HTMLElement>('[data-history-drop-scene]');
  const image = hit?.closest<HTMLElement>('[data-history-drop-path]');
  return { hit, scene, image };
}

export function useHistoryImageDrag(entry: GenerationHistoryEntry, onClick: () => void) {
  const [drag, setDrag] = useState<GridDrag<string> | null>(null);
  const cleanup = useRef<(() => void) | undefined>();
  const suppressClick = useRef(false);
  useEffect(() => () => cleanup.current?.(), [entry.path]);
  const start = (event: React.MouseEvent<HTMLElement>) => {
    if (isMobile || event.button !== 0 || event.ctrlKey || event.shiftKey || cleanup.current) return;
    const card = event.currentTarget;
    const preview = captureCard(card, event);
    if (!preview) return;
    const origin = { x: event.clientX, y: event.clientY };
    let current: GridDrag<string> | undefined;
    let highlight: HTMLElement | undefined;
    let highlightClasses: string[] = [];
    let stopScroll: (() => void) | undefined;
    let scrolling: HTMLElement | undefined;
    let escape: { remove: () => void } | undefined;
    let native = false;
    const clearHighlight = () => {
      highlight?.classList.remove(...highlightClasses);
      highlightClasses = [];
      highlight = undefined;
    };
    const clear = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', finish);
      window.removeEventListener('mouseout', leave);
      window.removeEventListener('blur', blur);
      window.removeEventListener('history-native-drop', nativeDrop);
      escape?.remove(); stopScroll?.(); clearHighlight();
      delete document.documentElement.dataset.sdstudioHistoryFileDrag;
      setDrag(null); cleanup.current = undefined;
    };
    const commit = async (x: number, y: number) => {
      const target = dropTarget(x, y);
      if (target.hit?.closest('[data-history-image-cell]')) return;
      try {
        const session = appState.curSession;
        if (target.scene && session) {
          const type = target.scene.dataset.historyDropType === 'inpaint' ? 'inpaint' : 'scene';
          const scene = session.getScene(type, target.scene.dataset.historyDropScene!);
          if (!scene) throw new Error('대상 씬을 찾을 수 없습니다.');
          const bounds = target.image?.getBoundingClientRect();
          await dropHistoryImage(entry, session, scene, target.image?.dataset.historyDropPath,
            bounds ? x > bounds.left + bounds.width / 2 : false);
        } else if (target.hit && !target.hit.closest('button,input,textarea,select,[contenteditable="true"]')) {
          const image = await imageService.fetchImage(entry.path);
          if (!image) throw new Error('이미지 파일을 찾을 수 없습니다.');
          appState.openExternalImage(dataUriToBase64(image));
        }
      } catch (error: any) {
        appState.pushMessage(error.message || '이미지를 옮기지 못했습니다.', 'error');
      }
    };
    function nativeDrop(event: Event) {
      const { x, y } = (event as CustomEvent).detail;
      void commit(x, y);
    }
    function blur() { if (!native) clear(); }
    function leave(event: MouseEvent) {
      if (!current || native || event.relatedTarget !== null ||
        (event.clientX > 0 && event.clientX < window.innerWidth - 1 && event.clientY > 0 && event.clientY < window.innerHeight - 1)) return;
      native = true;
      stopScroll?.(); clearHighlight(); setDrag(null);
      document.documentElement.dataset.sdstudioHistoryFileDrag = 'true';
      void backend.startFileDrag(entry.path).catch(() => {
        appState.pushMessage('이미지 파일을 드래그하지 못했습니다.', 'error');
      }).finally(clear);
    }
    const update = (point: { x: number; y: number }) => {
      const target = dropTarget(point.x, point.y);
      const element = target.image ?? target.scene ?? undefined;
      if (element !== highlight) {
        clearHighlight(); highlight = element;
        if (highlight) {
          highlightClasses = ['ring-2', 'ring-sky-500'].filter(name => !highlight!.classList.contains(name));
          highlight.classList.add(...highlightClasses);
        }
      }
      current = { preview: preview!, point, items: [entry.id] };
      setDrag(current);
      let viewport = target.hit instanceof HTMLElement ? target.hit : target.hit?.parentElement;
      while (viewport && viewport !== document.body && viewport.scrollHeight <= viewport.clientHeight) viewport = viewport.parentElement;
      if (viewport !== scrolling) {
        stopScroll?.(); scrolling = viewport ?? undefined;
        if (scrolling) stopScroll = followScroll(scrolling, () => current?.point, point => update(point));
      }
    };
    function move(event: MouseEvent) {
      if (native) return;
      if (!(event.buttons & 1)) { clear(); return; }
      if (!current && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= 4) return;
      event.preventDefault();
      suppressClick.current = true;
      if (!escape) escape = backStackService.push(clear, { preempt: true, back: 'skip' });
      update({ x: event.clientX, y: event.clientY });
    }
    function finish(event: MouseEvent) {
      if (native) return;
      const moved = !!current;
      clear();
      if (moved) void commit(event.clientX, event.clientY);
    }
    cleanup.current = clear;
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', finish);
    window.addEventListener('mouseout', leave);
    window.addEventListener('blur', blur);
    window.addEventListener('history-native-drop', nativeDrop);
  };
  return {
    start,
    click: () => { if (suppressClick.current) { suppressClick.current = false; return; } onClick(); },
    preview: drag ? <ReorderDragPreview type="history-image" drag={drag} /> : null,
    dragging: !!drag,
  };
}
