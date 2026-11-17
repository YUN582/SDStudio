/** @jest-environment node */
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { restoreEditedPng } from '../editedImageMetadata';
import {
  encodePngChunks,
  extractTextChunks,
  makeTextChunk,
  parsePngChunks,
  readTextChunk,
} from '../../renderer/models/pngTextChunks';

jest.mock('electron', () => ({}));

const png = (comment: string, rgb: number) =>
  encodePngChunks([
    {
      type: 'IHDR',
      data: Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0),
    },
    makeTextChunk('Comment', comment),
    makeTextChunk('Copyright', 'edited image credit'),
    { type: 'IDAT', data: Uint8Array.of(rgb) },
    { type: 'IEND', data: Uint8Array.of() },
  ]);

it('copies metadata to a different filename and preserves the edited pixels and both inputs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdstudio-edited-png-'));
  const source = path.join(dir, 'source.png');
  const edited = path.join(dir, '편집본 & 다른 이름.png');
  const output = path.join(dir, 'restored.png');
  const original = png('{"seed":123}', 1);
  const edit = png('edited comment', 2);
  const tools = {
    readGenerationTags: jest.fn(async () => ({})),
    writeExif: jest.fn(async () => false),
  };
  try {
    await writeFile(source, original);
    await writeFile(edited, edit);
    await restoreEditedPng(source, edited, output, tools);
    const read = async (p: string) => new Uint8Array(await readFile(p));
    const restored = await read(output);
    expect(extractTextChunks(restored).map(readTextChunk)).toEqual([
      { keyword: 'Copyright', text: 'edited image credit' },
      { keyword: 'Comment', text: '{"seed":123}' },
    ]);
    expect(
      parsePngChunks(restored).find((c) => c.type === 'IDAT')!.data,
    ).toEqual(Uint8Array.of(2));
    expect(tools.writeExif).toHaveBeenCalledWith(source, expect.any(String));
    expect(tools.readGenerationTags).not.toHaveBeenCalled();
    expect(await read(source)).toEqual(original);
    expect(await read(edited)).toEqual(edit);
    await expect(
      restoreEditedPng(source, edited, edited, tools),
    ).rejects.toThrow('이미 있는 파일');
    expect(await read(edited)).toEqual(edit);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { captureGenerationMetadata, applyGenerationMetadata } from '../editedImageMetadata';
import { embedSDStudioMetadataInPngBase64, embedSDStudioMetadataInWebpBytes, extractSDStudioMetadataFromBase64 } from '../../shared/sdstudioImageMetadata';

const studio = {
  schemaVersion: 1 as const,
  promptSource: { schemaVersion: 1 as const, workflowType: 'SDImageGen', frontPrompt: 'style', extraPrompt: '', middlePrompt: 'one chosen combination', backPrompt: 'background' },
};

test('automatic restoration keeps the exact combination through repeated edits, preserving the edited pixels', async () => {
  const original = Buffer.from(embedSDStudioMetadataInPngBase64(Buffer.from(png('{"prompt":"style, one chosen combination, background"}', 1)).toString('base64'), studio), 'base64');
  const snapshot = await captureGenerationMetadata(original, async () => ({}));
  for (const pixels of [2, 3]) {
    const restored = applyGenerationMetadata(Buffer.from(png('editor metadata', pixels)), snapshot);
    expect(extractSDStudioMetadataFromBase64(restored.toString('base64'))).toEqual(studio);
    const chunks = parsePngChunks(new Uint8Array(restored));
    expect(chunks.find(chunk => chunk.type === 'IDAT')?.data).toEqual(Uint8Array.of(pixels));
    expect(extractTextChunks(new Uint8Array(restored)).map(readTextChunk)).toContainEqual({ keyword: 'Comment', text: '{"prompt":"style, one chosen combination, background"}' });
    expect(applyGenerationMetadata(restored, snapshot)).toEqual(restored);
  }
});

test('stealth-only generation text becomes readable PNG metadata after pixel edits', async () => {
  const source = Buffer.from(encodePngChunks(parsePngChunks(png('', 1)).filter(chunk => chunk.type !== 'tEXt')));
  const snapshot = await captureGenerationMetadata(source, async () => ({ Comment: '{"prompt":"stealth original"}' }));
  const restored = applyGenerationMetadata(Buffer.from(png('', 2)), snapshot);
  expect(extractTextChunks(new Uint8Array(restored)).map(readTextChunk)).toContainEqual({ keyword: 'Comment', text: '{"prompt":"stealth original"}' });
});

test('WebP custom metadata also survives editing without altering the edited image payload', async () => {
  const webp = (pixel: number) => {
    const b = Buffer.alloc(22); b.write('RIFF'); b.writeUInt32LE(14, 4); b.write('WEBP', 8); b.write('VP8 ', 12); b.writeUInt32LE(2, 16); b[20] = pixel;
    return b;
  };
  const source = Buffer.from(embedSDStudioMetadataInWebpBytes(new Uint8Array(webp(1)), studio));
  const snapshot = await captureGenerationMetadata(source, async () => ({}));
  const restored = applyGenerationMetadata(webp(2), snapshot);
  expect(extractSDStudioMetadataFromBase64(restored.toString('base64'))).toEqual(studio);
  expect(restored[20]).toBe(2);
});

test('different-name PNG export preserves SDStudio sections as well as NAI metadata', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sdstudio-combination-'));
  try {
    const source = path.join(dir, 'source.png'), edited = path.join(dir, 'edited.png'), output = path.join(dir, 'restored.png');
    const bytes = Buffer.from(embedSDStudioMetadataInPngBase64(Buffer.from(png('{"prompt":"original"}', 1)).toString('base64'), studio), 'base64');
    await writeFile(source, new Uint8Array(bytes)); await writeFile(edited, png('', 2));
    await restoreEditedPng(source, edited, output, { readGenerationTags: async () => ({}), writeExif: async () => false });
    expect(extractSDStudioMetadataFromBase64((await readFile(output)).toString('base64'))).toEqual(studio);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
