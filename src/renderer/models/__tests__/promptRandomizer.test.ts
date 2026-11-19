jest.mock('..', () => ({ backend: {}, isMobile: false, promptService: {}, globalPieceService: { library: new Map() } }));
import { promptService } from '..';
import { PromptService, expandInlineRandom, highlightPrompt, lowerPromptNode, toPARR } from '../PromptService';
import { activeRandomizerOptions, readPromptRandomizer, splitPromptPieceLines } from '../promptRandomizer';
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

describe('comments in multi-line prompt pieces', () => {
  const sessionWith = (prompt: string) => ({
    library: new Map([['L', { pieces: [{ name: 'P', multi: true, prompt }] }]]),
  });

  test.each(['\n', '\r\n', '\r'])('keeps paired comments intact across %j line breaks', newline => {
    const block = `##hidden one${newline}hidden two##`;
    expect(splitPromptPieceLines(`alpha${newline}${block}${newline}omega`))
      .toEqual(['alpha', block, 'omega']);
  });

  test.each([0, 0.3, 0.5, 0.99])('never selects disabled rows or leaks multiline comment text at %s', value => {
    jest.spyOn(Math, 'random').mockReturnValue(value);
    const source = 'alpha\n##hidden one\nhidden two##\n##<missing.piece>##, \nomega';
    expect(lower('<L.P>', sessionWith(source))).toBe(value < 0.5 ? 'alpha' : 'omega');
  });

  test('an entirely commented piece contributes no text or random draw', () => {
    const random = jest.spyOn(Math, 'random');
    const session = sessionWith('##hidden one\nhidden two##\n##hidden three,##');
    expect(lower('before, <L.P>, after', session)).toBe('before, after');
    expect(random).not.toHaveBeenCalled();
  });

  test('preserves intentional blank choices and incomplete comments', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(lower('<L.P>', sessionWith('alpha\n\nomega'))).toBe('');
    expect(lower('<L.P>', sessionWith('alpha\n##incomplete\nomega'))).toBe('##incomplete');
  });

  test('keeps active text around a multiline comment and disabled inline choices', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const session = sessionWith('alpha, ##hidden\nignored## omega\n||##disabled##|visible||');
    expect(lower('<L.P>', session)).toBe('alpha, omega');
    jest.spyOn(Math, 'random').mockReturnValue(0.99);
    expect(lower('<L.P>', session)).toBe('visible');
  });
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

test('groups the whole randomizer beneath weights and comments without changing text', () => {
  const text = 'before, ||0.5::red hair::|1.5::blue hair::|##2::green hair::##||, after';
  const root = document.createElement('div');root.innerHTML = highlightPrompt({} as any, text);
  expect(root.textContent).toBe(text);
  const groups = root.querySelectorAll('.syntax-randomizer');
  expect(groups).toHaveLength(1);
  expect(groups[0].textContent).toBe(text.slice(text.indexOf('||'), text.lastIndexOf('||') + 2));
  expect(groups[0].querySelector('.syntax-weight-deemphasis')?.textContent).toBe('0.5::red hair::');
  expect(groups[0].querySelector('.syntax-weight-emphasis')?.textContent).toBe('1.5::blue hair::');
  expect(groups[0].querySelector('.syntax-comment')?.textContent).toBe('##2::green hair::##');
  expect(root.querySelector('.syntax-comment [class*=syntax-weight]')).toBeNull();
});

test('preserves prompt-piece styling inside the randomizer background', () => {
  const session = { library: new Map([['L', { pieces: [{ name: 'P', prompt: 'smile' }] }]]) };
  const root = document.createElement('div');root.innerHTML = highlightPrompt(session as any, '||<L.P>|plain||');
  expect(root.textContent).toBe('||<L.P>|plain||');
  expect(root.querySelector('.syntax-randomizer .syntax-wildcard')?.textContent).toBe('<L.P>');
});

test('keeps multiline choice backgrounds inside each line with original offsets', () => {
  const text = 'outside ||red,\n1.5::blue::|green|| after ||cat|dog||';
  const root = document.createElement('div');root.innerHTML = highlightPrompt({} as any, text);
  expect(root.textContent).toBe(text);
  expect(Array.from(root.querySelectorAll('.syntax-randomizer')).map(e => e.textContent))
    .toEqual(['||red,', '1.5::blue::|green||', '||cat|dog||']);
  expect(root.querySelector('.syntax-randomizer .syntax-line')).toBeNull();
  expect(root.querySelector('.syntax-randomizer .syntax-weight-emphasis')?.textContent).toBe('1.5::blue::');
});

test('does not add choice backgrounds to commented or incomplete syntax', () => {
  const text = '##||a|b||##, |, ||unfinished|choice';
  const root = document.createElement('div');root.innerHTML = highlightPrompt({} as any, text);
  expect(root.textContent).toBe(text);
  expect(root.querySelector('.syntax-randomizer')).toBeNull();
});
