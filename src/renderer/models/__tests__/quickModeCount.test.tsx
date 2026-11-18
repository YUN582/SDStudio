import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const queueQuickScene = jest.fn(async () => undefined);
const run = jest.fn();
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
  cyclingSessionService: { state: 'idle' },
  gameService: { getOutputs: () => [] },
  imageService: {
    refresh: jest.fn(async () => undefined),
    fetchImage: jest.fn(async () => undefined),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    getOutputDir: jest.fn(),
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

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  appState.samples = 10;
  jest.clearAllMocks();
});

afterEach(async () => {
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
