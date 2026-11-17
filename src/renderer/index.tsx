import { createRoot } from 'react-dom/client';

import { App } from './componenets/App';
import { bootstrapApp } from './models/bootstrap';
import { isTextEntryElement } from './models/keyTargetGuard';

// Let app shortcuts handle the key first, then replace the browser's page-wide selection.
window.addEventListener('keydown', (event) => {
  if (
    event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey ||
    !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a'
  ) return;

  const focused = document.activeElement;
  if (focused instanceof HTMLInputElement) {
    if (['text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(focused.type)) return;
  } else if (isTextEntryElement(focused)) {
    return;
  }

  event.preventDefault();
  const text = focused?.closest('[data-selectable-text]');
  if (text) window.getSelection()?.selectAllChildren(text);
});

// 명시적 부트 시퀀스 시작 — App 은 appState.bootReady 로 완료를 감지해 메인 UI 를 연다.
// (bootstrapApp 은 내부에서 실패를 격리하므로 여기서 reject 되지 않는다)
void bootstrapApp();

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<App />);
