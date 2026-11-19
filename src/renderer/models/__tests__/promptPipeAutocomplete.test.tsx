import React, { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('..', () => ({ isMobile: false,
  backend: { searchTags: jest.fn(async () => [{ word: 'blue hair', normalized: 'blue hair', redirect: 'null', category: 0, priority: 1, freq: 100 }]), lookupTag: async () => [] },
  artistLibraryService: { findArtistByName: () => undefined }, sessionService: {},
}));
jest.mock('../AppService', () => ({ appState: { fullWordAutoComplete: false } }));
jest.mock('../sceneFieldUndo', () => ({ holdSceneFieldEdit: () => () => {} }));
import { backend } from '..';
import { appState } from '../AppService';
import PromptEditTextArea from '../../componenets/PromptEditTextArea';

function Fixture({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  return <PromptEditTextArea value={text} onChange={setText} />;
}

beforeEach(() => {
  jest.clearAllMocks();
  const createRange = document.createRange.bind(document);
  jest.spyOn(document, 'createRange').mockImplementation(() => Object.assign(createRange(), {
    getBoundingClientRect: () => ({ bottom: 10, top: 10, right: 10 }),
  }));
});
const settleCaret = () => act(async () => { await new Promise(requestAnimationFrame); });
afterEach(async () => { await settleCaret(); window.getSelection()?.removeAllRanges(); jest.restoreAllMocks(); });

test.each([
  [false, 'before, ||blu|red hair||, after', 'before, ||blue hair|red hair||, after'],
  [false, 'before, ||red hair|blu||, after', 'before, ||red hair|blue hair||, after'],
  [false, '||red hair|  blu||', '||red hair|  blue hair||'],
  [true, '||red hair|blu tail|green hair||', '||red hair|blue hair|green hair||'],
  [true, '||red hair|1.5::blu tail::||', '||red hair|1.5::blue hair::||'],
  [false, '##hidden, tag##blu', '##hidden, tag##blue hair'],
  [false, '##hidden##  blu', '##hidden##  blue hair'],
  [false, 'blu##hidden##', 'blue hair##hidden##'],
  [true, '##left##blu tail##right##', '##left##blue hair##right##'],
  [true, '##left##  blu tail  ##right##', '##left##  blue hair  ##right##'],
  [true, '##left##1.5::blu tail::##right##', '##left##1.5::blue hair::##right##'],
  [false, '||##disabled##|##note##blu||', '||##disabled##|##note##blue hair||'],
  [false, '##blu##', '##blue hair##'],
])('completes only the current tag, preserving surrounding syntax (full word=%s)', async (fullWord, initial, expected) => {
  appState.fullWordAutoComplete = fullWord;
  render(<Fixture initial={initial} />);
  const editor = document.querySelector('[contenteditable=true]') as HTMLElement;
  editor.focus();
  await settleCaret();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent?.includes('blu')) continue;
    const range = document.createRange();
    range.setStart(node, node.textContent.indexOf('blu') + 3);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
    break;
  }
  fireEvent(editor, new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'e' }));
  await waitFor(() => expect(backend.searchTags).toHaveBeenCalledWith(fullWord ? 'blue tail' : 'blue', undefined));
  await screen.findByText('100');
  fireEvent.keyDown(editor, { key: 'Enter' });
  await waitFor(() => expect(editor.textContent).toBe(expected));
  await settleCaret();
});
