/** @jest-environment jsdom */
const mockState = {
  modalOverlayCount: 0, imageGridFocusable: false, resultViewerOpen: false,
  dialogs: [], floatViewCount: 0, undoFloatViewCount: 0, configScreenOpen: false,
  pieceEditorOpen: false, findReplaceOpen: false,
};
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('..', () => ({ isMobile: true }));
jest.mock('../historyPreview', () => ({ historyPreviewState: { entryId: null } }));
import { KeyboardShortcutService, isShortcutActionActive, ShortcutGateState } from '../KeyboardShortcutService';
const base: ShortcutGateState = {
  imageGridFocusable: true, resultViewerOpen: true, dialogCount: 0, floatViewCount: 0,
  undoFloatViewCount: 0, configScreenOpen: false, pieceEditorOpen: false, findReplaceOpen: false,
};
beforeEach(() => { mockState.modalOverlayCount = 0; localStorage.clear(); });
afterEach(() => { document.body.innerHTML = ''; });
test.each(['scene', 'global', 'viewer', 'image-grid'] as const)('a modal blocks %s actions even with active background views', category => {
  const action = { id: 'test', label: '', category, defaultKey: 'Space', allowInFloatView: true as const };
  expect(isShortcutActionActive(action, { ...base, modalOverlayCount: 1 })).toBe(false);
  expect(isShortcutActionActive(action, { ...base, modalOverlayCount: 2 })).toBe(false);
  expect(isShortcutActionActive(action, base)).toBe(true);
});
test.each([
  { key: ' ', action: 'queue-run' }, { key: 'Enter', action: 'scene-open-images' },
  { key: 'Tab', action: 'scene-open-editor' }, { key: 'ArrowRight', action: 'scene-right' },
  { key: 'g', ctrlKey: true, action: 'queue-all-scenes' },
])('modal leaves $key available to the focused control and does not dispatch $action', spec => {
  const svc = new KeyboardShortcutService(), dispatched = jest.fn(), inside = jest.fn();
  const button = document.createElement('button'); document.body.append(button); button.focus();
  button.addEventListener('keydown', inside);
  window.addEventListener('shortcut-action', dispatched); svc.install();
  try {
    mockState.modalOverlayCount = 1;
    const event = new KeyboardEvent('keydown', { ...spec, bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false); expect(inside).toHaveBeenCalledTimes(1);
    expect(dispatched).not.toHaveBeenCalled();
    mockState.modalOverlayCount = 0;
    button.dispatchEvent(new KeyboardEvent('keydown', { ...spec, bubbles: true, cancelable: true }));
    expect(dispatched).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ action: spec.action }) }));
  } finally { svc.uninstall(); window.removeEventListener('shortcut-action', dispatched); }
});
