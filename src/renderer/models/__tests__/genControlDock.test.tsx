import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { makeAutoObservable } from 'mobx';
import { observer } from 'mobx-react-lite';

const state = makeAutoObservable({
  uiLayoutTemplate: 'classic', uiLayoutSlots: { genControl: 'floating', historySide: 'left' } as any,
  genWidget: { detached: true, x: 100, y: 100 }, genControlOverlayCount: 0,
});
const saved = jest.fn(async (_config: any) => {});
jest.mock('..', () => ({ isMobile: false, backend: {
  getConfig: async () => ({ keep: 'account settings', genWidget: { detached: true } }),
  setConfig: (config: any) => saved(config),
} }));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../mobileV2', () => ({ isV2: () => false, V2_QUICK_BAR_SLOT_ID: 'quick' }));
jest.mock('../../componenets/TaskQueueControl', () => ({ __esModule: true, default: () => <div data-testid="generation-controls" /> }));
jest.mock('../../componenets/UndoBarSlot', () => ({ UndoBarSlot: () => null }));
jest.mock('../../componenets/Tooltip', () => ({ __esModule: true, default: ({ children }: any) => children }));
import BottomBar from '../../componenets/BottomBar';
import { GenControlFloating } from '../../componenets/GenControlWidget';

const Workspace = observer(() => <>
  <BottomBar genControl={state.uiLayoutSlots.genControl} />
  {(state.genWidget.detached || state.uiLayoutSlots.genControl === 'floating') && <GenControlFloating />}
</>);

beforeAll(() => { window.PointerEvent = MouseEvent as typeof PointerEvent; });

beforeEach(() => {
  state.uiLayoutTemplate = 'classic'; state.uiLayoutSlots = { genControl: 'floating', historySide: 'left' };
  state.genWidget = { detached: true, x: 100, y: 100 }; state.genControlOverlayCount = 0;
  saved.mockClear();
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: jest.fn(() => null) });
});

test('detached controls retain a dock target and the attach button restores the saved slot', async () => {
  const ui = render(<Workspace />);
  expect(screen.getByRole('button', { name: '생성 컨트롤을 여기에 놓아 부착' })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '하단 바에 부착' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({
    keep: 'account settings', genWidget: { detached: false, x: 100, y: 100 },
    uiLayoutSlots: { genControl: 'docked', historySide: 'left' },
  })));
  expect(screen.queryByRole('button', { name: '하단 바에 부착' })).toBeNull();
  expect(screen.getAllByTestId('generation-controls')).toHaveLength(1);
  expect(ui.container.querySelector('[data-gen-dock]')?.contains(screen.getByTestId('generation-controls'))).toBe(true);
});

test('dropping the floating handle onto the dock reattaches without duplicating controls', async () => {
  const ui = render(<Workspace />);
  const dock = ui.container.querySelector('[data-gen-dock-target]')!;
  (document.elementFromPoint as jest.Mock).mockReturnValue(dock);
  fireEvent.pointerDown(screen.getByLabelText('생성 컨트롤 이동 핸들'), { button: 0, pointerId: 1, clientX: 120, clientY: 120 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 200, clientY: 700 });
  await waitFor(() => expect(state.genWidget.detached).toBe(false));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(screen.getAllByTestId('generation-controls')).toHaveLength(1);
});

test('an editor with its own generation bar does not expose a competing dock target', () => {
  state.genControlOverlayCount = 1;
  render(<BottomBar />);
  expect(screen.queryByTestId('generation-controls')).toBeNull();
  expect(screen.queryByRole('button', { name: '생성 컨트롤을 여기에 놓아 부착' })).toBeNull();
});

test('layouts without a bottom bar keep their floating controls', () => {
  state.uiLayoutTemplate = 'compact';
  render(<GenControlFloating />);
  expect(screen.queryByRole('button', { name: '하단 바에 부착' })).toBeNull();
  expect(screen.getByTestId('generation-controls')).not.toBeNull();
});
