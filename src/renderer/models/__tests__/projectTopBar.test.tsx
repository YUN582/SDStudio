import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
let mobile = false;
const appState = { uiLayoutTemplate: 'classic', uiToolbar: {}, genWidget: { detached: false }, genControlOverlayCount: 0, mobileV2QuickBar: false };
jest.mock('..', () => ({ get isMobile() { return mobile; } }));
jest.mock('../AppService', () => ({ appState }));
jest.mock('../mobileV2', () => ({ isV2: () => false, V2_QUICK_BAR_SLOT_ID: 'quick' }));
jest.mock('../../componenets/SessionSelect', () => ({ __esModule: true, default: () => <div data-testid="project-selector" /> }));
jest.mock('../../componenets/TaskQueueControl', () => ({ __esModule: true, default: () => <div data-testid="generation-controls" /> }));
jest.mock('../../componenets/GenControlWidget', () => ({ GenControlHandle: () => null }));
jest.mock('../../componenets/UndoBarSlot', () => ({ UndoBarSlot: () => null }));
import ProjectTopBar from '../../componenets/ProjectTopBar';
import BottomBar from '../../componenets/BottomBar';
import PersonalTab from '../../componenets/ConfigPersonalTab';

afterEach(() => { mobile = false; appState.uiLayoutTemplate = 'classic'; });
test.each(['classic', 'compact'])('%s desktop places project selection above and generation controls below once', layout => {
  appState.uiLayoutTemplate = layout;
  const ui = render(<><ProjectTopBar /><BottomBar /></>);
  expect(screen.getAllByTestId('project-selector')).toHaveLength(1);
  expect(screen.getAllByTestId('generation-controls')).toHaveLength(1);
  expect(ui.container.querySelector('[data-project-top-bar]')?.contains(screen.getByTestId('project-selector'))).toBe(true);
  expect(ui.container.querySelector('[data-gen-dock]')?.contains(screen.getByTestId('project-selector'))).toBe(false);
});
test.each(['sidebar', 'modern'])('%s keeps the dedicated project surface without a duplicate top selector', layout => {
  appState.uiLayoutTemplate = layout;
  render(<ProjectTopBar />);
  expect(screen.queryByTestId('project-selector')).toBeNull();
});
test('mobile keeps its own project placement', () => {
  mobile = true;
  render(<ProjectTopBar />);
  expect(screen.queryByTestId('project-selector')).toBeNull();
});
test('startup shortcut help is opt-in and its setting reports changes', () => {
  const change = jest.fn();
  render(<PersonalTab showShortcutHelpOnStartup={false} setShowShortcutHelpOnStartup={change} />);
  const checkbox = screen.getByRole('checkbox', { name: '시작 시 단축키 도움말 표시' }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(change).toHaveBeenCalledWith(true);
});
