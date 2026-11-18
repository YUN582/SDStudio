jest.mock('..', () => ({ backend: {}, isMobile: false, promptService: {}, globalPieceService: {} }));

import { highlightPrompt, stripPromptComments } from '../PromptService';
import type { Session } from '../types';

const render = (text: string) => {
  const root = document.createElement('div');
  root.innerHTML = highlightPrompt({} as Session, text);
  expect(root.textContent).toBe(text);
  return root;
};
const content = (root: Element, selector: string) =>
  Array.from(root.querySelectorAll(selector)).map(node => node.textContent).join('');

test.each([
  ['##ignored,## 1.5::tag::', 'syntax-weight-emphasis'],
  ['1.5::tag::##ignored##', 'syntax-weight-emphasis'],
  ['##left## 0.5::tag:: ##right##', 'syntax-weight-deemphasis'],
  ['##left## -0.5::tag:: ##right##', 'syntax-weight-negative'],
  ['##ignored##{tag}', 'syntax-weight-emphasis'],
  ['[tag]##ignored##', 'syntax-weight-deemphasis'],
  ['##multi,\nline,## 1.5::tag::', 'syntax-weight-emphasis'],
  ['before,\n##ignored,## 0.5::tag::, after', 'syntax-weight-deemphasis'],
])('keeps weight highlighting beside comments in %s', (text, className) => {
  const root = render(text);
  expect(content(root, '.' + className)).toContain('tag');
  expect(root.querySelector('.syntax-comment [class*=syntax-weight]')).toBeNull();
  // Line breaks sit between syntax-line spans, outside their comment spans.
  expect(content(root, '.syntax-comment')).toBe(text.match(/##[\s\S]*?##/g)!.join('').replace(/\n/g, ''));
  expect(stripPromptComments(root.textContent!)).toBe(stripPromptComments(text));
});

test('commented weight markers cannot consume or color the next active weight', () => {
  const root = render('##2::ignored## 0.5::tag::');
  expect(content(root, '.syntax-weight-deemphasis')).toContain('tag');
  expect(root.querySelector('.syntax-weight-emphasis')).toBeNull();
});

test('commented brackets do not change the next active tag weight', () => {
  const root = render('##{ignored## tag');
  expect(root.querySelector('[class*=syntax-weight]')).toBeNull();
});

test('an active weighted group keeps its highlight around an embedded comment', () => {
  const root = render('1.5::left, ##ignored,## right::');
  const weighted = content(root, '.syntax-weight-emphasis');
  expect(weighted).toContain('left');
  expect(weighted).toContain('right');
  expect(weighted).not.toContain('ignored');
});

test.each(['1.5::left::,##ignored##', '##ignored##,1.5::right::'])('does not extend comment or weight highlighting onto an outside comma in %s', text => {
  const root = render(text);
  expect(content(root, '.syntax-comment')).toBe('##ignored##');
  expect(content(root, '[class*=syntax-weight]')).not.toContain(',');
});

test('escapes visible prompt text beside a comment', () => {
  const root = render('##hidden## 1.5::tag & <b>literal</b>::');
  expect(root.querySelector('b')).toBeNull();
  expect(content(root, '.syntax-weight-emphasis')).toContain('tag & <b>literal</b>');
});

test.each([
  ['##0.5::jaggy lines::,## 1.1::dithering::,', '1.1::dithering::'],
  ['##left## 0.5::tag with spaces:: ##right##', '0.5::tag with spaces::'],
  ['1.5::tag::  ##right##', '1.5::tag::'],
  ['##left## \t1.5::tag:: \t##right##', '1.5::tag::'],
])('keeps separator whitespace outside the highlight in %s', (text, weighted) => {
  const root = render(text);
  expect(content(root, '[class*=syntax-weight]')).toBe(weighted);
});

test('keeps whitespace inside an active weighted group highlighted around a comment', () => {
  const root = render('1.5::left, ##hidden## right::');
  expect(content(root, '.syntax-weight-emphasis')).toBe('1.5::left,  right::');
});
