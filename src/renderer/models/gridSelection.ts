import { appState } from './AppService';
import { hasOpenContextMenu } from '../componenets/contextMenuBack';

export interface GridModifiers { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }

export type GridDirection = 'left' | 'right' | 'up' | 'down';

export function gridNavigationAction(action: string, scope: 'scene' | 'image') {
  const match = new RegExp(`^${scope}-(extend-)?(left|right|up|down)$`).exec(action);
  return match ? { extend: !!match[1], direction: match[2] as GridDirection } : undefined;
}

/** Keep one anchor while Shift grows/shrinks the range; plain movement starts a new anchor. */
export function gridKeyboardMove(
  order: readonly string[], focused: string | undefined, anchor: string | undefined,
  direction: GridDirection, columns: number, extend: boolean,
) {
  if (!order.length) return undefined;
  const index = focused === undefined ? -1 : order.indexOf(focused);
  const stride = Math.max(1, columns);
  const delta = direction === 'left' ? -1 : direction === 'right' ? 1 : direction === 'up' ? -stride : stride;
  const next = index < 0 ? 0 : Math.max(0, Math.min(order.length - 1, index + delta));
  const key = order[next];
  const rangeAnchor = extend && anchor !== undefined && order.includes(anchor)
    ? anchor : extend && index >= 0 ? order[index] : key;
  const start = order.indexOf(rangeAnchor);
  return {
    key, anchor: rangeAnchor,
    keys: extend ? new Set(order.slice(Math.min(start, next), Math.max(start, next) + 1)) : undefined,
  };
}

/** Card clicks must release a previously focused search field without stealing focus from controls. */
export function focusGridSurface(event: { target: EventTarget | null; currentTarget: HTMLElement }) {
  if (!isGridCardControl(event)) event.currentTarget.focus({ preventScroll: true });
}
export function gridCardUsesSelection(event: GridModifiers = {}): boolean {
  return !!(event.ctrlKey || event.metaKey || event.shiftKey);
}
export function gridClickSelection(order: string[], current: Set<string>, anchor: string | undefined, key: string, event: GridModifiers) {
  const index = order.indexOf(key);
  if (index < 0) return { keys: current, anchor };
  const toggle = event.ctrlKey || event.metaKey;
  if (event.shiftKey) {
    const startKey = anchor !== undefined && current.has(anchor) && order.includes(anchor)
      ? anchor : [...current].reverse().find(selected => order.includes(selected));
    const start = startKey === undefined ? index : order.indexOf(startKey);
    const range = order.slice(Math.min(start, index), Math.max(start, index) + 1);
    return { keys: new Set(toggle ? [...current, ...range] : range), anchor: startKey ?? key };
  }
  const keys = new Set(toggle ? current : []);
  if (toggle && keys.has(key)) {
    keys.delete(key);
    return { keys, anchor: [...keys].reverse().find(selected => order.includes(selected)) };
  }
  keys.add(key);
  return { keys, anchor: key };
}

export function isGridCardControl(event: { target: EventTarget | null }) {
  return event.target instanceof Element && !!event.target.closest('button,a,input,select,textarea,[contenteditable=true]');
}

export function gridSelectionCanReceiveEscape() {
  return !appState.dialogs.length && !appState.modalOverlayCount && !appState.sceneMergeRequest &&
    !appState.configScreenOpen && !appState.pieceEditorOpen && !appState.findReplaceOpen &&
    !appState.batchInsertOpen && !appState.projectBrowserOpen && !hasOpenContextMenu();
}
