import { adjustPromptWeightAtSelection, getPromptCommentAtSelection, getPromptWeightAtSelection } from '../promptTransforms';

describe('weight edits beside comments', () => {
  it.each([
    ['##ignored, tags, ##active', '##ignored, tags, ##1.05::active::'],
    ['active##ignored, tags##', '1.05::active::##ignored, tags##'],
    ['##left## active ##right##', '##left## 1.05::active:: ##right##'],
  ])('adjusts only active text in %s', (text, expected) => {
    const caret = text.indexOf('active');
    const result = adjustPromptWeightAtSelection(text, caret, caret, 0.05)!;
    expect(result.text).toBe(expected);
    expect(result.text[result.selectionStart]).toBe('a');
    expect(getPromptWeightAtSelection(result.text, result.selectionStart)?.weight).toBe(1.05);
  });

  it.each([
    ['before, ##tag,## after', -0.05, 'before, ##0.95::tag::,## after', 0.95],
    ['before, ##1.2::tag::,## after', 0.05, 'before, ##1.25::tag::,## after', 1.25],
    ['##left## ##1.05::tag::## ##right##', -0.05, '##left## ##tag## ##right##', 1],
    ['##first, \n tag, last,## tail', 0.05, '##first, \n 1.05::tag::, last,## tail', 1.05],
    ['##tag, ##active', 0.05, '##1.05::tag::, ##active', 1.05],
  ])('adjusts commented tags without enabling them in %s', (text, delta, expected, weight) => {
    const caret = text.indexOf('tag');
    const result = adjustPromptWeightAtSelection(text, caret, caret + 3, delta)!;
    expect(result.text).toBe(expected);
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('tag');
    expect(getPromptWeightAtSelection(result.text, result.selectionStart)?.weight).toBe(weight);
    expect(getPromptCommentAtSelection(result.text, result.selectionStart)).toBeDefined();
  });

  it('keeps the caret inside the same comment during repeated changes', () => {
    let result = { text: 'before, ##tag,## after', selectionStart: 10, selectionEnd: 13 };
    for (const delta of [0.05, 0.05, -0.05, -0.05]) {
      result = adjustPromptWeightAtSelection(result.text, result.selectionStart, result.selectionEnd, delta)!;
      expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe('tag');
    }
    expect(result.text).toBe('before, ##tag,## after');
  });

  it('does not adjust comment markers or an empty commented segment', () => {
    const text = '##tag,##';
    for (const caret of [0, 1, 6, 7, 8]) {
      expect(adjustPromptWeightAtSelection(text, caret, caret, -0.05)).toBeUndefined();
      expect(getPromptWeightAtSelection(text, caret)).toBeUndefined();
    }
    expect(adjustPromptWeightAtSelection('##  ##', 3, 3, 0.05)).toBeUndefined();
  });
});
