import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const extract = jest.fn();
const close = jest.fn();
const record = { preset: jest.fn(), shared: jest.fn(), scene: jest.fn(), presetAdded: jest.fn(), commit: jest.fn() };
const confirmAsync = jest.fn(async () => true);
const state: any = { curSession: undefined, confirmAsync, incrementModalOverlay: jest.fn(), decrementModalOverlay: jest.fn(), pushMessage: jest.fn() };
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('..', () => ({ isMobile: false, backend: {}, sessionService: {}, workFlowService: {}, imageService: {}, globalPresetService: {} }));
jest.mock('../util', () => ({ extractPromptDataFromBase64: (...args: any[]) => extract(...args) }));
jest.mock('../../componenets/BrushTool', () => ({ base64ToDataUri: (s: string) => 'data:image/png;base64,' + s }));
jest.mock('../../componenets/SceneEditor', () => ({ PromptHighlighter: ({ text }: { text: string }) => <div>{text}</div> }));
jest.mock('../BackStackService', () => ({ backStackService: { push: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('../imageStateUndo', () => ({ beginMetaApplyRecord: () => record }));
jest.mock('../undoService', () => ({ undoService: { canRecord: () => false }, UNDO_TEXT: {} }));
import { ExternalImageView } from '../../componenets/ExternalImageView';
import { planSelectedPromptImport } from '../sdstudioPromptImport';

const source: any = { schemaVersion: 1, workflowType: 'SDImageGen', frontPrompt: 'new front', extraPrompt: 'new extra', middlePrompt: 'new middle', backPrompt: 'new back' };
let preset: any, session: any, scene: any, theme: HTMLElement;
beforeEach(() => {
  jest.clearAllMocks();
  preset = { name: 'keep', frontPrompt: 'old front', backPrompt: 'old back', uc: 'old uc' };
  scene = { name: 'test', type: 'scene', slots: [[{ prompt: 'old middle', enabled: true }]] };
  session = { selectedWorkflow: { workflowType: 'SDImageGen', presetName: 'keep' }, presets: new Map([['SDImageGen', [preset]]]), presetShareds: new Map(), extraPrompt: 'old extra' };
  state.curSession = session;
  extract.mockResolvedValue({ prompt: 'merged prompt', uc: 'new uc', characterPrompts: [], vibes: [], characterReferences: [], seed: 123,
    sdstudioMetadata: { promptSource: source }, resolution: { width: 832, height: 1216 } });
  theme = document.createElement('div');theme.setAttribute('data-app-theme-root', '');document.body.appendChild(theme);
});
afterEach(() => theme.remove());

async function open() {
  const clipped = document.createElement('div');clipped.style.transform = 'translateX(0)';clipped.style.overflow = 'hidden';theme.appendChild(clipped);
  render(<ExternalImageView image="fixture" onClose={close} scene={scene} />, { container: clipped });
  await screen.findByLabelText('적용할 프리셋');
  fireEvent.change(screen.getByLabelText('적용할 프리셋'), { target: { value: 'current' } });
  return clipped;
}
function selectOnly(name: string) {
  document.querySelectorAll<HTMLInputElement>('[data-metadata-options] input[type=checkbox]').forEach(input => {
    const desired = input.closest('label')!.textContent!.trim() === name;
    if (!input.disabled && input.checked !== desired) fireEvent.click(input);
  });
}

test('portals above the clipped main region with the shared full-screen blurred backdrop and top-only checkboxes', async () => {
  const clipped = await open();
  expect(clipped.querySelector('[data-metadata-import]')).toBeNull();
  expect(theme.querySelector('[data-metadata-import]')).toBeTruthy();
  const frame = document.querySelector('[data-modal-size=xl]')!;
  expect((frame as HTMLElement).style.height).toBe('92vh');
  expect((frame.parentElement as HTMLElement).style.backdropFilter).toBe('blur(8px)');
  expect(frame.parentElement!.className).toContain('fixed inset-0');
  expect(document.querySelectorAll('[data-metadata-options] input[type=checkbox]').length).toBe(11);
  expect(screen.queryByLabelText('추가(프로젝트) 프롬프트')).toBeNull();
  expect(document.querySelector('[data-metadata-preview] input[type=checkbox]')).toBeNull();
  fireEvent.click(screen.getByLabelText('닫기'));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

test.each(['상위 프롬프트', '하위 프롬프트', '중간 프롬프트'])('applies only %s and leaves other sections untouched', async name => {
  await open();selectOnly(name);
  fireEvent.click(screen.getByRole('button', { name: '적용' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(preset.frontPrompt).toBe(name === '상위 프롬프트' ? 'new front' : 'old front');
  expect(preset.backPrompt).toBe(name === '하위 프롬프트' ? 'new back' : 'old back');
  expect(scene.slots[0][0].prompt).toBe(name === '중간 프롬프트' ? 'new middle' : 'old middle');
  expect(session.extraPrompt).toBe(name === '중간 프롬프트' ? 'new extra' : 'old extra');expect(preset.uc).toBe('old uc');
  expect(record.commit).toHaveBeenCalledTimes(1);
  expect(confirmAsync).toHaveBeenCalledTimes(name === '중간 프롬프트' ? 1 : 0);
});

test('external merged prompts do not pretend to have separate source sections', async () => {
  extract.mockResolvedValue({ prompt: 'merged prompt', uc: '', characterPrompts: [], vibes: [], characterReferences: [] });
  await open();
  expect((screen.getByLabelText('중간 프롬프트') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('하위 프롬프트') as HTMLInputElement).disabled).toBe(true);
  selectOnly('통합 프롬프트');fireEvent.click(screen.getByRole('button', { name: '적용' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(preset.frontPrompt).toBe('merged prompt');expect(preset.backPrompt).toBe('old back');
});

test('canceling a scene replacement leaves all prompt sections intact', async () => {
  confirmAsync.mockResolvedValueOnce(false);
  await open();selectOnly('중간 프롬프트');fireEvent.click(screen.getByRole('button', { name: '적용' }));
  await waitFor(() => expect(confirmAsync).toHaveBeenCalled());
  expect(close).not.toHaveBeenCalled();expect(record.commit).not.toHaveBeenCalled();
  expect(preset.frontPrompt).toBe('old front');expect(preset.backPrompt).toBe('old back');expect(scene.slots[0][0].prompt).toBe('old middle');
});

test('section masks preserve source text and handle folded destinations and selected empty fields', () => {
  const selected = { front: false, extra: false, middle: true, back: false };
  const opts = { targetType: 'SDImageGen', placeExtra: true, middle: 'fold' } as const;
  expect(planSelectedPromptImport('merged', source, opts, selected)).toEqual({ split: true, backPrompt: 'new middle' });
  expect(planSelectedPromptImport('merged', source, { ...opts, placeExtra: false }, { ...selected, middle: false, extra: true }))
    .toEqual({ split: true, frontPrompt: 'new extra' });
  expect(planSelectedPromptImport('merged', { ...source, backPrompt: '' }, opts, { ...selected, middle: false, back: true }))
    .toEqual({ split: true, backPrompt: '' });
  expect(source.frontPrompt).toBe('new front');expect(source.middlePrompt).toBe('new middle');
});
