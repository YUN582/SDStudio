jest.mock('..', () => ({ backend: {}, isMobile: false, promptService: {}, globalPieceService: { library: new Map() } }));
import { promptService } from '..';
import { PromptService, expandInlineRandom, highlightPrompt, lowerPromptNode, toPARR } from '../PromptService';
import { activeRandomizerOptions, readPromptRandomizer } from '../promptRandomizer';
import { adjustPromptWeightAtSelection, getPromptWeightAtSelection, togglePromptCommentAtSelection } from '../promptTransforms';

const parser = new PromptService();
beforeAll(() => Object.setPrototypeOf(promptService, PromptService.prototype));
afterEach(() => jest.restoreAllMocks());
const lower = (text: string, session?: any) => lowerPromptNode({ type: 'group', children: toPARR(text).map(word => parser.parseWord(word, session)) });

test('keeps commas and comments in a randomizer intact until generation', () => {
  const text = 'before, ||red hair, glasses|##disabled, tag##|blue hair||, after';
  expect(toPARR(text)).toEqual(['before', '||red hair, glasses|##disabled, tag##|blue hair||', 'after']);
  jest.spyOn(Math, 'random').mockReturnValue(0);
  expect(lower(text)).toBe('before, red hair, glasses, after');
});

test('resolves each image independently without changing its queued prompt', () => {
  const random = jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99);
  const node = parser.parseWord('||red hair|blue hair||');
  const original = JSON.stringify(node);
  expect(random).not.toHaveBeenCalled();
  expect(lowerPromptNode(node)).toBe('red hair');
  expect(lowerPromptNode(node)).toBe('blue hair');
  expect(JSON.stringify(node)).toBe(original);
});

test.each([
  ['A girl with ||red|blue|| hair', 'A girl with blue hair'],
  ['||red |blue ||hair', 'blue hair'],
  ['||1.5::|0.5::|::||rain::', '::rain::'],
  ['||red|blue|| ||skirt|jeans||', 'blue jeans'],
  ['||red|##disabled||candidate##|blue||', 'blue'],
  ['##||hidden|ignored||## ||left|right||', ' right'],
  ['||##hidden##|##ignored##||', ''],
  ['||red|,||', ','],
])('expands %s', (text, expected) => {
  jest.spyOn(Math, 'random').mockReturnValue(0.99);
  expect(expandInlineRandom(text)).toBe(expected);
});

test('supports legacy brace choices inside and outside NAI sections', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  expect(expandInlineRandom('||{a|b}|c||')).toBe('a');
  expect(expandInlineRandom('{||a|b|||c}')).toBe('a');
  expect(expandInlineRandom('{best quality}')).toBe('{best quality}');
  expect(expandInlineRandom('front, |, back, ||unfinished|choice')).toBe('front, |, back, ||unfinished|choice');
});

test('a selected candidate can reference a prompt piece', () => {
  jest.spyOn(Math, 'random').mockReturnValue(0);
  const session = { library: new Map([['L', { pieces: [{ name: 'P', prompt: 'glasses, smile' }] }]]) };
  expect(lower('||<L.P>|standing||', session)).toBe('glasses, smile');
  expect(activeRandomizerOptions(readPromptRandomizer('||##off##|on||', 0)!)).toEqual(['on']);
});

test('commented candidates do not trigger missing-piece preflight errors', () => {
  const session = { library: new Map() };
  const scene = { type: 'scene', slots: [[{ prompt: '||##<missing.piece>##|standing||' }]] };
  expect(parser.findMissingPieces(session as any, scene as any)).toEqual([]);
});

test.each(['red hair', 'blue hair'])('weight and comment shortcuts affect only %s', tag => {
  const text = 'front, ||red hair|blue hair||, back';
  const caret = text.indexOf(tag);
  const weighted = adjustPromptWeightAtSelection(text, caret, caret + tag.length, 0.05)!;
  expect(weighted.text).toBe(text.replace(tag, '1.05::' + tag + '::'));
  expect(weighted.text.slice(weighted.selectionStart, weighted.selectionEnd)).toBe(tag);
  expect(getPromptWeightAtSelection(weighted.text, weighted.selectionStart)?.weight).toBe(1.05);
  const commented = togglePromptCommentAtSelection(text, caret, caret, true)!;
  expect(commented.text).toBe(text.replace(tag, '##' + tag + '##'));
  expect(togglePromptCommentAtSelection(commented.text, commented.selectionStart, commented.selectionEnd, true)?.text).toBe(text);
});

test('a commented candidate can be weighted while staying disabled', () => {
  const text = '||##red hair##|blue hair||';
  const caret = text.indexOf('red');
  const result = adjustPromptWeightAtSelection(text, caret, caret, 0.05)!;
  expect(result.text).toBe('||##1.05::red hair::##|blue hair||');
  jest.spyOn(Math, 'random').mockReturnValue(0);
  expect(lower(result.text)).toBe('blue hair');
});

test('weight highlighting does not spill across random alternatives', () => {
  const text = '||0.5::red hair::|1.5::blue hair::|##green hair##||';
  const root = document.createElement('div');root.innerHTML = highlightPrompt({} as any, text);
  expect(root.textContent).toBe(text);
  const content = (selector: string) => Array.from(root.querySelectorAll(selector)).map(e => e.textContent).join('');
  expect(content('.syntax-weight-deemphasis')).toBe('0.5::red hair::');
  expect(content('.syntax-weight-emphasis')).toBe('1.5::blue hair::');
  expect(content('.syntax-comment')).toBe('##green hair##');
});
