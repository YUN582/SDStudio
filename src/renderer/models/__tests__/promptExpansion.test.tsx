import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
jest.mock('..', () => ({ isMobile: false, backend: { searchTags: async () => [], lookupTag: async () => [] }, artistLibraryService: { findArtistByName: () => undefined }, sessionService: {} }));
jest.mock('../AppService', () => ({ appState: { incrementModalOverlay: jest.fn(), decrementModalOverlay: jest.fn() } }));
jest.mock('../sceneFieldUndo', () => ({ holdSceneFieldEdit: () => () => {} }));
jest.mock('@capacitor/app', () => ({ App: {} }));
import PromptEditTextArea from '../../componenets/PromptEditTextArea';
function Fixture({ initial = 'alpha, beta, ALPHA' }: { initial?: string }) {
  const [text, setText] = useState(initial);
  return <PromptEditTextArea value={text} onChange={setText} />;
}

beforeEach(() => {
  const createRange = document.createRange.bind(document);
  jest.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), { getBoundingClientRect: () => ({ bottom: 0 }) }));
});

test('commented prompt weights respond to Ctrl+arrows and Ctrl+wheel with undo', async () => {
  render(<Fixture initial="before, ##1.2::blue hair::,## after" />);
  const editor = document.querySelector('[contenteditable=true]') as HTMLElement;
  editor.focus();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent?.includes('blue hair')) continue;
    const range = document.createRange();
    range.setStart(node, node.textContent.indexOf('blue hair'));
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    break;
  }
  fireEvent.keyDown(editor, { key: 'ArrowUp', ctrlKey: true });
  await waitFor(() => expect(editor.textContent).toBe('before, ##1.25::blue hair::,## after'));
  fireEvent.wheel(editor, { ctrlKey: true, deltaY: 100 });
  await waitFor(() => expect(editor.textContent).toBe('before, ##1.2::blue hair::,## after'));
  fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });
  await waitFor(() => expect(editor.textContent).toBe('before, ##1.25::blue hair::,## after'));
  fireEvent.keyDown(editor, { key: 'ArrowDown', ctrlKey: true });
  await waitFor(() => expect(editor.textContent).toBe('before, ##1.2::blue hair::,## after'));
});
afterEach(() => { window.getSelection()?.removeAllRanges(); jest.restoreAllMocks(); });

test('expanded prompt keeps backdrop clicks open, searches and replaces through editor undo, and closes with Escape or X', async () => {
  render(<Fixture />);
  fireEvent.click(screen.getByRole('button', { name: '크게 편집' }));
  const dialog = screen.getByRole('dialog', { name: '프롬프트 확대 편집' });
  expect(dialog.className).toContain('prompt-expanded');
  const backdrop = document.querySelector('[data-prompt-expanded-backdrop]')!;
  expect(backdrop.className).toContain('backdrop-blur');
  fireEvent.click(backdrop);
  expect(screen.getByRole('dialog')).toBe(dialog);
  const query = screen.getByRole('textbox', { name: '프롬프트 검색' });
  fireEvent.change(query, { target: { value: 'alpha' } });
  expect(screen.getByRole('status').textContent).toBe('0 / 2');
  fireEvent.click(screen.getByRole('button', { name: '다음 검색 결과' }));
  await waitFor(() => expect(window.getSelection()?.toString()).toBe('alpha'));
  fireEvent.change(screen.getByRole('textbox', { name: '프롬프트 바꿀 내용' }), { target: { value: 'gamma' } });
  fireEvent.click(screen.getByRole('button', { name: '모두 바꾸기' }));
  await waitFor(() => expect(dialog.querySelector('[contenteditable=true]')?.textContent).toBe('gamma, beta, gamma'));
  fireEvent.keyDown(dialog.querySelector('[contenteditable=true]')!, { key: 'z', ctrlKey: true });
  await waitFor(() => expect(dialog.querySelector('[contenteditable=true]')?.textContent).toBe('alpha, beta, ALPHA'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '크게 편집' }));
  fireEvent.click(screen.getByRole('button', { name: '크게 편집 닫기' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('inline editors retain the existing expansion button without the duplicated inline finder', () => {
  const view = render(<Fixture />);
  expect(view.container.querySelectorAll('[data-prompt-expand-toggle]')).toHaveLength(1);
  expect(view.container.querySelector('[data-prompt-find-toggle]')).toBeNull();
  expect(document.querySelector('[data-prompt-find-bar]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '크게 편집' }));
  expect(screen.getByRole('textbox', { name: '프롬프트 검색' })).toBeDefined();
  expect(screen.getByRole('textbox', { name: '프롬프트 바꿀 내용' })).toBeDefined();
});

test('read-only expansion reuses the themed shared viewer and supports selection and search', async () => {
  const theme = document.createElement('div');
  theme.setAttribute('data-app-theme-root', '');
  theme.className = 'dark';
  const clipped = document.createElement('div');
  theme.appendChild(clipped); document.body.appendChild(theme);
  const onChange = jest.fn(), onClose = jest.fn();
  const view = render(<PromptEditTextArea value="alpha, beta, ALPHA" disabled initialExpanded
    onExpandedClose={onClose} onChange={onChange} />, { container: clipped });
  const dialog = screen.getByRole('dialog', { name: '프롬프트 확대 보기' });
  expect(dialog.closest('[data-app-theme-root]')).toBe(theme);
  expect(clipped.querySelector('[role=dialog]')).toBeNull();
  expect(dialog.querySelector('[contenteditable=false]')?.hasAttribute('data-selectable-text')).toBe(true);
  expect(document.activeElement).toBe(dialog.querySelector('[contenteditable=false]'));
  fireEvent.keyDown(document.activeElement!, { key: 'f', ctrlKey: true });
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '프롬프트 검색' }));
  expect(screen.queryByRole('textbox', { name: '프롬프트 바꿀 내용' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: '프롬프트 검색' }), { target: { value: 'alpha' } });
  fireEvent.click(screen.getByRole('button', { name: '다음 검색 결과' }));
  await waitFor(() => expect(window.getSelection()?.toString()).toBe('alpha'));
  fireEvent.click(document.querySelector('[data-prompt-expanded-backdrop]')!);
  expect(screen.getByRole('dialog')).toBe(dialog);
  fireEvent.click(screen.getByRole('button', { name: '확대 보기 닫기' }));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.unmount(); theme.remove();
});

test('read-only expansion blocks weight/comment/paste edits and Escape closes just the viewer', async () => {
  const onChange = jest.fn(), onClose = jest.fn();
  render(<PromptEditTextArea value="alpha, beta" disabled initialExpanded onExpandedClose={onClose} onChange={onChange} />);
  const editor = document.querySelector('[contenteditable=false]') as HTMLElement;
  const range = document.createRange(); range.selectNodeContents(editor); range.collapse(true);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  onChange.mockClear();
  fireEvent.keyDown(editor, { key: 'ArrowUp', ctrlKey: true });
  fireEvent.keyDown(editor, { key: '3', code: 'Digit3', ctrlKey: true });
  fireEvent.wheel(editor, { ctrlKey: true, deltaY: -100 });
  fireEvent.paste(editor, { clipboardData: { getData: () => 'modified' } });
  expect(editor.textContent).toBe('alpha, beta');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onClose).toHaveBeenCalledTimes(1);
});
