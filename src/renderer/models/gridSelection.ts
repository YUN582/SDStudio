import { appState } from './AppService';
import { hasOpenContextMenu } from '../componenets/contextMenuBack';

export interface GridModifiers { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
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
