import { resolveVariantSceneSeed } from '../sceneSeedGroups';

describe('inpaint seed input', () => {
  const scene = { type: 'inpaint', workflowType: 'SDInpaint' };
  it.each([{}, { seed: undefined }, { seed: null }, { seed: NaN }])(
    'does not inherit the original scene seed for %p', preset => {
      expect(resolveVariantSceneSeed(scene, preset, 12345)).toBeUndefined();
    },
  );
  it('preserves an explicit seed, including zero', () => {
    expect(resolveVariantSceneSeed(scene, { seed: 0 }, 12345)).toBe(0);
    expect(resolveVariantSceneSeed(scene, { seed: 42 }, 12345)).toBe(42);
  });
});
