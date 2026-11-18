import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
jest.mock('..', () => ({ isMobile: false, backend: { searchTags: async () => [], lookupTag: async () => [] }, artistLibraryService: { findArtistByName: () => undefined }, sessionService: {} }));
jest.mock('../AppService', () => ({ appState: { incrementModalOverlay: jest.fn(), decrementModalOverlay: jest.fn() } }));
jest.mock('../sceneFieldUndo', () => ({ holdSceneFieldEdit: () => () => {} }));
jest.mock('@capacitor/app', () => ({ App: {} }));
import PromptEditTextArea from '../../componenets/PromptEditTextArea';
function Fixture() {
  const [text, setText] = useState('alpha, beta, ALPHA');
  return <PromptEditTextArea value={text} onChange={setText} />;
}

beforeEach(() => {
  const createRange = document.createRange.bind(document);
  jest.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), { getBoundingClientRect: () => ({ bottom: 0 }) }));
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
