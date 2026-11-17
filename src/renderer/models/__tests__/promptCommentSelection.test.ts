import { togglePromptCommentAtSelection as toggle } from '../promptTransforms';

describe('selected prompt comment shortcut', () => {
  it('wraps selected tags and the separator, then restores them exactly', () => {
    const text = 'first, blue hair, smile, last';
    const start = text.indexOf('blue');
    const end = text.indexOf(', last');
    const result = toggle(text, start, end, true)!;
    expect(result.text).toBe('first, ##blue hair, smile,## last');
    const restored = toggle(result.text, result.selectionStart, result.selectionEnd, true)!;
    expect(restored).toEqual({ text, selectionStart: start, selectionEnd: end });
  });

  it.each([3, 4, 5, 6, 7])('keeps padding outside for a selection ending at %i and restores the selection', end => {
    const text = 'tag, \t next';
    const result = toggle(text, 0, end, true)!;
    expect(result.text).toBe('##tag,## \t next');
    expect(toggle(result.text, result.selectionStart, result.selectionEnd, true))
      .toEqual({ text, selectionStart: 0, selectionEnd: end });
  });

  it('can remove a saved comment that includes the space after the comma', () => {
    expect(toggle('##old, ##next', 3, 3, true)?.text).toBe('old, next');
  });

  it('comments the active tag immediately after a comment', () => {
    const text = '##hidden, ##visible, next';
    const caret = text.indexOf('visible');
    expect(toggle(text, caret, caret, true)!.text).toBe('##hidden, ####visible,## next');
  });

  it('does not consume the next line or change the pairing of other comments', () => {
    expect(toggle('tag, \r\nnext', 1, 1, true)!.text).toBe('##tag,## \r\nnext');
    expect(toggle('a, ##hidden##, b', 0, 12, true)).toBeUndefined();
  });
});
