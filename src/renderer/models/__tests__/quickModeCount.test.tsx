import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const queueQuickScene = jest.fn(async () => undefined);
const run = jest.fn();
let outputs: string[] = [];
const fetchImage = jest.fn(async () => 'data:image/png;base64,QUJD');
const imageEvents = new EventTarget();
const quickScene = { name: 'default', resolution: 'portrait' };
const quickSession = {
  name: '퀵 생성',
  scenes: new Map([['default', quickScene]]),
};
const currentSession = { name: '현재 프로젝트' };
const appState = {
  curSession: currentSession,
  samples: 10,
  mobileV2QuickBar: false,
  dialogs: [],
  floatViewCount: 0,
  undoFloatViewCount: 0,
  imageGridFocusable: false,
  resultViewerOpen: false,
  pushMessage: jest.fn(),
};
const taskQueueService = {
  isRunning: () => false,
  isEmpty: () => true,
  statsTasksFromScene: () => ({ done: 0, total: 0 }),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  run,
  stop: jest.fn(),
  removeTasksFromScene: jest.fn(),
};

jest.mock('..', () => ({
  isMobile: true,
  cyclingSessionService: { state: 'idle' },
  gameService: { getOutputs: () => outputs },
  imageService: {
    refresh: jest.fn(async () => undefined),
    fetchImage,
    addEventListener: jest.fn((...args: Parameters<EventTarget['addEventListener']>) => imageEvents.addEventListener(...args)),
    removeEventListener: jest.fn((...args: Parameters<EventTarget['removeEventListener']>) => imageEvents.removeEventListener(...args)),
    getOutputDir: () => 'outs/quick/default',
  },
  sessionService: { markDirty: jest.fn() },
  taskQueueService,
  templateService: {
    ensureQuickGenProject: jest.fn(async () => quickSession),
  },
}));
jest.mock('../AppService', () => ({ appState }));
jest.mock('../sceneQueueActions', () => ({ queueQuickScene }));
jest.mock('../mobileV2', () => ({
  isV2: () => false,
  V2_QUICK_BAR_SLOT_ID: 'quick-bar',
}));
jest.mock('../../componenets/useV2Slot', () => ({
  useV2Slot: () => null,
}));
jest.mock('react-contexify', () => ({
  useContextMenu: () => ({ show: jest.fn() }),
}));
jest.mock('../../componenets/ResolutionPicker', () => ({
  ResolutionPicker: () => <div data-testid="resolution-picker" />,
}));

import QuickModeTab from '../../componenets/QuickModeTab';
import { KeyboardShortcutService } from '../KeyboardShortcutService';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let shortcuts: KeyboardShortcutService;

beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  shortcuts = new KeyboardShortcutService();
  shortcuts.install();
  appState.samples = 10;
  appState.floatViewCount = 0;
  outputs = [];
  jest.clearAllMocks();
});

test('quick navigation works with global shortcuts installed, from older to newer, without hijacking inputs', async () => {
  outputs = ['2.png', '3.png', '1.png'];
  await act(async () => { root.render(<QuickModeTab />); await Promise.resolve(); });
  expect(fetchImage).toHaveBeenLastCalledWith('outs/quick/default/3.png');
  expect((host.querySelector('[aria-label="퀵 생성 다음 이미지"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => (host.querySelector('[aria-label="퀵 생성 이전 이미지"]') as HTMLButtonElement).click());
  expect(fetchImage).toHaveBeenLastCalledWith('outs/quick/default/2.png');
  await act(async () => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  expect(fetchImage).toHaveBeenLastCalledWith('outs/quick/default/1.png');
  const calls = fetchImage.mock.calls.length;
  (host.querySelector('[aria-label="퀵 생성 개수"]') as HTMLInputElement).focus();
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(fetchImage).toHaveBeenCalledTimes(calls);
  (document.activeElement as HTMLElement).blur();
  await act(async () => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(fetchImage).toHaveBeenLastCalledWith('outs/quick/default/2.png');
});

test('newly generated images append on the right and refresh preserves the current image', async () => {
  outputs = ['3.png', '2.png', '1.png'];
  await act(async () => { root.render(<QuickModeTab />); await Promise.resolve(); });
  outputs = ['4.png', ...outputs];
  await act(async () => imageEvents.dispatchEvent(new CustomEvent('image-added', { detail: {
    session: quickSession, sceneType: 'scene', sceneName: 'default', path: 'outs/quick/default/4.png',
  } })));
  expect(fetchImage).toHaveBeenLastCalledWith('outs/quick/default/4.png');
  expect((host.querySelector('[aria-label="퀵 생성 다음 이미지"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  expect(fetchImage).toHaveBeenLastCalledWith('outs/quick/default/3.png');
  await act(async () => imageEvents.dispatchEvent(new Event('updated')));
  const calls = fetchImage.mock.calls.length;
  appState.floatViewCount = 1;
  await act(async () => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
  expect(fetchImage).toHaveBeenCalledTimes(calls);
  appState.floatViewCount = 0;
  await act(async () => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(fetchImage).toHaveBeenLastCalledWith('outs/quick/default/4.png');
});

test('inactive quick tab does not consume the scene navigation keys', async () => {
  outputs = ['2.png', '1.png'];
  await act(async () => { root.render(<QuickModeTab isActive={false} />); await Promise.resolve(); });
  const action = jest.fn();
  window.addEventListener('shortcut-action', action);
  const calls = fetchImage.mock.calls.length;
  try {
    await act(async () => host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })));
    expect(fetchImage).toHaveBeenCalledTimes(calls);
    expect(action.mock.calls[0][0].detail.action).toBe('scene-left');
  } finally {
    window.removeEventListener('shortcut-action', action);
  }
});

afterEach(async () => {
  shortcuts.uninstall();
  await act(async () => root.unmount());
  host.remove();
});

test('quick generation queues the selected count', async () => {
  await act(async () => {
    root.render(<QuickModeTab />);
    await Promise.resolve();
  });

  const count = host.querySelector(
    '[aria-label="퀵 생성 개수"]',
  ) as HTMLInputElement;
  expect(count.value).toBe('10');

  const generate = Array.from(host.querySelectorAll('button')).find((button) =>
    button.textContent?.startsWith('생성 ('),
  ) as HTMLButtonElement;
  await act(async () => {
    generate.click();
    await Promise.resolve();
  });

  expect(queueQuickScene).toHaveBeenCalledWith(
    currentSession,
    quickSession,
    quickScene,
    10,
  );
  expect(run).toHaveBeenCalledTimes(1);
});
