import { act, fireEvent, render, screen } from '@testing-library/react';
import MobileKeyboardChip, { chipKeyboardUp, resetChipKeyboardTrack, caretChipAllowed } from '../../componenets/MobileKeyboardChip';
import { disposeFocusedPromptEditor, setFocusedPromptEditor, type FocusedPromptEditor } from '../promptEditorFocus';

jest.mock('../index', () => ({ isMobile: false }));
jest.mock('../util', () => ({ buildDanbooruSearchUrl: (text: string) => text ? 'https://example.invalid/' + text : '' }));

let editor: FocusedPromptEditor;
let field: HTMLTextAreaElement;
beforeEach(() => {
  resetChipKeyboardTrack();
  field = document.createElement('textarea'); field.className = 'prompt-full'; field.value = 'cat, dog'; document.body.appendChild(field);
  editor = { element: field, getCaretWeight: () => ({ inner: 'cat', weight: 1 }) as any,
    adjustWeight: jest.fn(), toggleComment: jest.fn(), isCaretInComment: () => false };
});
afterEach(() => { disposeFocusedPromptEditor(editor); field.remove(); });

async function focus(start: number, end = start) {
  await act(async () => {
    field.focus(); setFocusedPromptEditor(editor); field.setSelectionRange(start, end);
    document.dispatchEvent(new Event('selectionchange'));
  });
}

test('weight and comment controls remain available without an inline finder', async () => {
  render(<MobileKeyboardChip onSearch={() => {}} />); await focus(1);
  expect(document.querySelector('[data-kbd-chip=adjust]')).not.toBeNull();
  expect(screen.queryByRole('button', { name: '이 칸에서 찾기' })).toBeNull();
  const step = screen.getByRole('button', { name: '가중치 0.05 높이기' });
  fireEvent.pointerDown(step); fireEvent.pointerUp(step);
  expect(editor.adjustWeight).toHaveBeenCalledWith(0.05);
  const comment = screen.getByRole('button', { name: '주석 토글(##로 감싸기/풀기)' });
  fireEvent.pointerDown(comment); fireEvent.pointerUp(comment);
  expect(editor.toggleComment).toHaveBeenCalled();
});

test('selected text still offers the separate Danbooru search action', async () => {
  const onSearch = jest.fn(); render(<MobileKeyboardChip onSearch={onSearch} />); await focus(0, 3);
  const search = screen.getByRole('button', { name: /Danbooru/ });
  fireEvent.pointerDown(search); fireEvent.pointerUp(search);
  expect(onSearch).toHaveBeenCalledWith('cat');
});

test('an empty caret segment does not create a find-only chip', async () => {
  editor.getCaretWeight = () => undefined;
  render(<MobileKeyboardChip onSearch={() => {}} />); await focus(4);
  expect(document.querySelector('[data-kbd-chip]')).toBeNull();
});

test.each([[false, false, false], [false, true, true], [true, false, true], [true, true, true]])('caret chip keyboard=%s expanded=%s visibility=%s', (keyboard, expanded, expected) => {
  expect(caretChipAllowed(keyboard, expanded)).toBe(expected);
});

test('closing the keyboard hides a caret chip outside the expanded editor', async () => {
  field.classList.remove('prompt-full');
  render(<MobileKeyboardChip onSearch={() => {}} />); await focus(1);
  expect(document.querySelector('[data-kbd-chip=adjust]')).toBeNull();
});

test('keyboard shrinking and rotation update the visibility reference', () => {
  const height = window.innerHeight, width = window.innerWidth;
  try {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
    resetChipKeyboardTrack();expect(chipKeyboardUp()).toBe(false);
    window.innerHeight = 600;expect(chipKeyboardUp()).toBe(true);
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width + 100 });
    expect(chipKeyboardUp()).toBe(false);
  } finally {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    resetChipKeyboardTrack();
  }
});
