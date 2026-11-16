import { adjustPromptWeightAtSelection, getPromptWeightAtSelection } from '../promptTransforms';

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

  it('leaves comment contents unchanged', () => {
    const text = 'before, ##1.2::ignored, tags::##, after';
    const start = text.indexOf('##');
    const end = text.lastIndexOf('##') + 2;
    for (let caret = start; caret < end; caret += 1) {
      expect(adjustPromptWeightAtSelection(text, caret, caret, -0.05)).toBeUndefined();
      expect(getPromptWeightAtSelection(text, caret)).toBeUndefined();
    }
  });
});
