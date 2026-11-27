jest.mock('../../componenets/BrushTool', () => ({ base64ToDataUri: (value: string) => 'data:image/png;base64,' + value }));
import { importedI2IResizeSize, resizeImportedI2IImage } from '../importedImageResize';

test.each([
  [3840, 2160, 1344, 768],
  [2160, 3840, 768, 1344],
  [2048, 2048, 1024, 1024],
  [1664, 2432, 832, 1216],
  [2432, 1664, 1216, 832],
  [833, 1217, 832, 1216],
])('near-budget resize %ix%i becomes %ix%i', (width, height, outputWidth, outputHeight) => {
  expect(importedI2IResizeSize(width, height)).toEqual({ width: outputWidth, height: outputHeight });
});

test.each([[1024, 1024], [832, 1216], [1216, 832], [512, 768]])('already eligible %ix%i is left alone', (width, height) => {
  expect(importedI2IResizeSize(width, height)).toBeUndefined();
});

test.each([[0, 1000], [1000, -1], [NaN, 1000], [1000, Infinity], [1000.5, 2000]])('invalid dimensions are rejected', (width, height) => {
  expect(importedI2IResizeSize(width, height)).toBeUndefined();
});

test('odd and extreme aspect ratios stay inside the pixel budget after 64px alignment', () => {
  for (const [width, height] of [[3212, 2043], [10001, 2011], [2001, 10003], [65536, 65536], [100000, 64]]) {
    const size = importedI2IResizeSize(width, height)!;
    expect(size.width % 64).toBe(0);
    expect(size.height % 64).toBe(0);
    expect(size.width * size.height).toBeLessThanOrEqual(1048576);
    expect(size.width).toBeLessThanOrEqual(width);
    expect(size.height).toBeLessThanOrEqual(height);
    expect(importedI2IResizeSize(height, width)).toEqual({ width: size.height, height: size.width });
  }
});

test('browser resizing rejects an unsafe output size before decoding or writing', async () => {
  await expect(resizeImportedI2IImage('pixels', { width: 2048, height: 1024 })).rejects.toThrow('크기');
  await expect(resizeImportedI2IImage('pixels', { width: 1345, height: 768 })).rejects.toThrow('크기');
});
