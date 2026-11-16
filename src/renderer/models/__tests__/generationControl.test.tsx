import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
const run = jest.fn();
const add = jest.fn(async (..._args: any[]) => true);
const confirm = jest.fn(async () => true);
const state = {
  samples: 10,
  curMainTab: 'scene',
  curSession: { name: 'project' },
  selectedSceneCount: () => 2,
  confirmAsync: confirm,
  pushMessage: jest.fn(),
};
const service = {
  addEventListener: () => {},
  removeEventListener: () => {},
  isRunning: () => false,
  isLongBreak: () => false,
  statsAllTasks: () => ({ total: 50, done: 0 }),
  estimateTime: () => 1000,
  calculateCost: jest.fn(() => [] as any[]),
  run,
};
jest.mock('..', () => ({
  taskQueueService: service,
  cyclingSessionService: { state: 'idle' },
}));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../sceneQueueActions', () => ({ addScenesToQueue: add }));
jest.mock('../mobileV2', () => ({ isV2: () => false }));
jest.mock('../../componenets/Tooltip', () => ({
  __esModule: true,
  default: ({ children }: any) => children,
}));
jest.mock('../../componenets/SceneQueueMenu', () => ({
  __esModule: true,
  default: ({ children }: any) => children,
}));
import TaskQueueControl from '../../componenets/TaskQueueControl';
import { generationControlState } from '../generationControl';

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  jest.clearAllMocks();
  service.calculateCost.mockReturnValue([]);
  confirm.mockResolvedValue(true);
  generationControlState.update({ target: null, busy: false });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  generationControlState.update({ target: null, busy: false });
});
const click = async (label: string) =>
  act(async () => {
    (
      host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement
    ).click();
  });

test('normal play appends all current-tab scenes even when old tasks and selections exist, then starts', async () => {
  await act(async () => root.render(<TaskQueueControl />));
  await click('생성 시작');
  expect(add).toHaveBeenCalledWith(state.curSession, 'scene', false);
  expect(run).toHaveBeenCalledTimes(1);
});
test('both bars use the active editor target instead of all scenes; closing restores normal scope', async () => {
  const queue = jest.fn(async () => true);
  generationControlState.update({
    target: {
      session: state.curSession as any,
      scene: {} as any,
      queue,
      disabled: false,
    },
  });
  await act(async () => root.render(<TaskQueueControl />));
  await click('현재 편집 작업 예약');
  expect(queue).toHaveBeenCalledTimes(1);
  expect(add).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  await click('생성 시작');
  expect(queue).toHaveBeenCalledTimes(2);
  expect(run).toHaveBeenCalledTimes(1);
  await act(async () => generationControlState.update({ target: null }));
  await click('생성 시작');
  expect(add).toHaveBeenCalledTimes(1);
});
test('simultaneous bars share the busy lock and paid cancellation retains queued work without running', async () => {
  let done: (value: boolean) => void = () => {};
  const queue = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        done = resolve;
      }),
  );
  await act(async () =>
    root.render(
      <>
        <TaskQueueControl queueCurrent={queue} />
        <TaskQueueControl queueCurrent={queue} />
      </>,
    ),
  );
  const buttons = host.querySelectorAll('[aria-label="생성 시작"]');
  await act(async () => {
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
  });
  expect(queue).toHaveBeenCalledTimes(1);
  service.calculateCost.mockReturnValue([{ text: '1 Anlas', scene: 'work' }]);
  confirm.mockResolvedValueOnce(false);
  await act(async () => done(true));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(run).not.toHaveBeenCalled();
  expect(generationControlState.snapshot.busy).toBe(false);
});
