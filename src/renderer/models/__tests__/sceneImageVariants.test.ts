import { groupImagePaths, linkedImageVariants } from '../sceneImageVariants';
import type { GenericScene, InpaintScene, Scene } from '../types';

const original = { type: 'scene', name: 'original' } as Scene;
const inpaint = {
  type: 'inpaint', name: 'inpaint', sceneRef: 'original', sourceImage: 'same.png',
} as InpaintScene;
const i2i = {
  type: 'inpaint', name: 'i2i', sceneRef: 'original', sourceImage: 'same.png',
} as InpaintScene;
const legacy = { type: 'inpaint', name: 'legacy', sceneRef: 'original' } as InpaintScene;
const unrelated = {
  type: 'inpaint', name: 'other', sceneRef: 'different', sourceImage: 'same.png',
} as InpaintScene;

test('finds work for the exact source image and includes legacy links in scene results', () => {
  const variants = [inpaint, i2i, legacy, unrelated];
  expect(linkedImageVariants(original, variants)).toEqual([inpaint, i2i, legacy]);
  expect(linkedImageVariants(original, variants, 'same.png')).toEqual([inpaint, i2i]);
  expect(linkedImageVariants(original, variants, 'other.png')).toEqual([]);
  expect(linkedImageVariants(inpaint, variants, 'same.png')).toEqual([]);
});

test('groups same-name original and result files by their actual owners', () => {
  const source = 'outs/original/same.png';
  const result = 'inpaints/inpaint/same.png';
  const otherResult = 'inpaints/inpaint/other.png';
  const owners = new Map<string, GenericScene>([
    [source, original],
    [result, inpaint],
    [otherResult, inpaint],
  ]);
  expect([...groupImagePaths([source, result, otherResult, 'stale.png'], owners)]).toEqual([
    [original, [source]],
    [inpaint, [result, otherResult]],
  ]);
});
