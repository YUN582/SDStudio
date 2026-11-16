import { galleryFavoritePlan, galleryImageKey, GALLERY_ORDER_KEY, orderGalleryEntries, selectGalleryExportEntries, SceneGalleryEntry } from '../sceneImageVariants';
import type { GenericScene } from '../types';

const owner = (name: string, type = 'scene') => ({ name, type, mains: [], meta: new Map() } as unknown as GenericScene);
const entry = (scene: GenericScene, filename: string): SceneGalleryEntry => ({ owner: scene, filename, path: `${scene.name}/${filename}` });

test('new variant results precede older originals while each work keeps its manual order', () => {
  const original = owner('original'), variant = owner('variant', 'inpaint');
  const first = entry(original, '1700000000001.png'), last = entry(original, '1700000000003.png');
  const edit = entry(variant, '1700000000002.png');
  expect(orderGalleryEntries([[first, last], [edit]], original)).toEqual([edit, first, last]);
});

test('manual combined order distinguishes matching filenames and prepends new entries', () => {
  const original = owner('original'), variant = owner('variant', 'inpaint');
  const source = entry(original, 'same.png'), edited = entry(variant, 'same.png'), fresh = entry(variant, '1700000000004.png');
  original.meta.set(GALLERY_ORDER_KEY, [galleryImageKey(variant, edited.filename, original), galleryImageKey(original, source.filename, original)]);
  expect(orderGalleryEntries([[source], [fresh, edited]], original)).toEqual([fresh, edited, source]);
  expect(selectGalleryExportEntries([fresh, edited, source], false, [source.path, edited.path, edited.path])).toEqual([source, edited]);
});

test('favorite-only exports use the actual variant pixels and fall back once for the scene', () => {
  const original = owner('original'), variant = owner('variant', 'inpaint');
  const source = entry(original, 'same.png'), edited = entry(variant, 'same.png');
  variant.mains = ['same.png'];
  expect(selectGalleryExportEntries([source, edited], true)).toEqual([edited]);
  variant.mains = [];
  expect(selectGalleryExportEntries([source, edited], true)).toEqual([source]);
});

test('mixed selection adds all favorites; an entirely starred selection removes all', () => {
  const original = owner('original'), variant = owner('variant', 'inpaint');
  original.mains = ['same.png'];
  const groups = new Map([[original, ['original/same.png']], [variant, ['variant/same.png']]]);
  expect(galleryFavoritePlan(groups)).toMatchObject({ add: true, count: 2 });
  variant.mains = ['same.png'];
  expect(galleryFavoritePlan(groups)).toMatchObject({ add: false, count: 2 });
});
import { galleryPreviewEntry, linkedImageVariants } from '../sceneImageVariants';

test('scene preview uses gallery order across original and variant favorites, not favorite insertion order', () => {
  const original = owner('original'), variant = owner('variant', 'inpaint');
  original.mains = ['second.png', 'first.png'];
  variant.mains = ['edit.png'];
  const a = entry(original, 'first.png'), b = entry(original, 'second.png'), c = entry(variant, 'edit.png');
  expect(galleryPreviewEntry([c, a, b])).toBe(c);
  expect(galleryPreviewEntry([a, c, b])).toBe(a);
  original.mains = []; variant.mains = [];
  expect(galleryPreviewEntry([c, a, b])).toBe(c);
});

test('chained dependencies belong to the actual result owner even when filenames match', () => {
  const root = owner('root'), parent = owner('parent', 'inpaint');
  const direct = { name:'parent', sceneRef:'root', sourceImage:'same.png' } as any;
  const child = { name:'child', sceneRef:'root', sourceInpaint:'parent', sourceImage:'same.png' } as any;
  expect(linkedImageVariants(root, [direct, child], 'same.png')).toEqual([direct]);
  expect(linkedImageVariants(parent, [direct, child], 'same.png')).toEqual([child]);
  expect(linkedImageVariants(root, [direct, child])).toEqual([direct, child]);
});
