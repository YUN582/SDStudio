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
