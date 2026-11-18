import { filterSortGlobalPresets, reorderGlobalPresetIds } from '../globalPresetListView';

const order = ['a', 'hidden', 'b', 'c', 'd'];

test('filtered drag preserves hidden slots and selected card order in both directions', () => {
  const visible = ['a', 'b', 'c', 'd'];
  expect(reorderGlobalPresetIds(order, visible, ['b', 'a'], 'b', 'd'))
    .toEqual(['c', 'hidden', 'd', 'a', 'b']);
  expect(reorderGlobalPresetIds(order, visible, ['d'], 'd', 'a'))
    .toEqual(['d', 'hidden', 'a', 'b', 'c']);
  expect(reorderGlobalPresetIds(order, visible, ['a', 'b'], 'a', 'b')).toBeUndefined();
});

test('manual sort follows the stored array even when names or dates change', () => {
  const list = [{ name: 'z', updatedAt: 1 }, { name: 'a', updatedAt: 9 }];
  expect(filterSortGlobalPresets(list, '', 'manual')).toEqual(list);
});
