import { BrowserWindow, dialog, ipcMain } from 'electron';
import { constants, promises as fs } from 'fs';
import path from 'path';
import ExifReader from 'exifreader';
import { gunzipSync } from 'zlib';
import {
  embedSDStudioMetadataInPngBase64,
  extractSDStudioMetadataFromBase64,
} from '../shared/sdstudioImageMetadata';
import {
  encodePngChunks,
  isPng,
  isTextChunk,
  makeTextChunk,
  parsePngChunks,
  textChunkKeyword,
} from '../renderer/models/pngTextChunks';
import { extractStealthBits } from './stealth';
import { partPathFor } from './copyFileUnlessSame';

const GENERATION_KEYS = new Set([
  'Comment',
  'Description',
  'Generation time',
  'SDStudio',
  'Software',
  'Source',
  'Title',
  'parameters',
]);

interface ExifWriter {
  write: (
    target: string,
    tags: object,
    args: string[],
  ) => Promise<{ updated: number }>;
}

interface MetadataTools {
  writeExif: (source: string, target: string) => Promise<boolean>;
  readGenerationTags: (source: Buffer) => Promise<Record<string, string>>;
}

export async function restoreEditedPng(
  sourcePath: string,
  editedPath: string,
  outputPath: string,
  tools: MetadataTools,
): Promise<void> {
  if (path.extname(outputPath).toLowerCase() !== '.png') {
    throw new Error('복원본의 확장자는 .png여야 합니다.');
  }
  const [source, edited] = await Promise.all([
    fs.readFile(sourcePath),
    fs.readFile(editedPath),
  ]);
  const editedBytes = new Uint8Array(
    edited.buffer,
    edited.byteOffset,
    edited.byteLength,
  );
  const sourceBytes = new Uint8Array(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  );
  if (!isPng(editedBytes))
    throw new Error('클립 스튜디오에서 내보낸 PNG를 선택해주세요.');

  const sourceText = isPng(sourceBytes)
    ? parsePngChunks(sourceBytes).filter(
        (chunk) =>
          isTextChunk(chunk) && GENERATION_KEYS.has(textChunkKeyword(chunk)),
      )
    : [];
  const copiedKeys = new Set(sourceText.map(textChunkKeyword));
  if (!copiedKeys.has('Comment') && !copiedKeys.has('parameters')) {
    const tags = await tools.readGenerationTags(source);
    for (const [key, value] of Object.entries(tags)) {
      if (!copiedKeys.has(key)) {
        sourceText.push(makeTextChunk(key, value));
        copiedKeys.add(key);
      }
    }
  }

  const chunks = parsePngChunks(editedBytes).filter(
    (chunk) => !(isTextChunk(chunk) && copiedKeys.has(textChunkKeyword(chunk))),
  );
  chunks.splice(chunks.length - 1, 0, ...sourceText);
  let output = encodePngChunks(chunks);
  const studio = extractSDStudioMetadataFromBase64(source.toString('base64'));
  if (studio && !copiedKeys.has('SDStudio')) {
    const withStudio = Buffer.from(
      embedSDStudioMetadataInPngBase64(
        Buffer.from(output).toString('base64'),
        studio,
      ),
      'base64',
    );
    output = new Uint8Array(
      withStudio.buffer,
      withStudio.byteOffset,
      withStudio.byteLength,
    );
  }

  // ExifTool needs a file, so edit a temporary copy before publishing the result.
  const temporary = partPathFor(outputPath) + '.png';
  try {
    await fs.writeFile(temporary, output, { flag: 'wx' });
    const exifCopied = await tools.writeExif(sourcePath, temporary);
    if (!sourceText.length && !studio && !exifCopied) {
      throw new Error('원본에서 복원할 생성 정보나 EXIF를 찾지 못했습니다.');
    }
    await fs
      .copyFile(temporary, outputPath, constants.COPYFILE_EXCL)
      .catch((error) => {
        if (error.code === 'EEXIST') {
          throw new Error(
            '이미 있는 파일입니다. 복원본을 다른 이름으로 저장해주세요.',
          );
        }
        throw error;
      });
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

function escapeJsonText(json: string): string {
  return json.replace(
    /[^\x00-\x7f]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

export async function readStealthGenerationTags(
  source: Buffer,
  sharp: typeof import('sharp'),
): Promise<Record<string, string>> {
  const { data, info } = await sharp(
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits = extractStealthBits(data, info.width, info.height, info.channels);
  if (!bits) return {};
  const packed = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++)
    packed[i >> 3] |= bits[i] << (7 - (i & 7));
  const payload = packed.subarray(19);
  const bytes =
    packed.subarray(0, 15).toString('ascii') === 'stealth_pngcomp'
      ? gunzipSync(
          new Uint8Array(
            payload.buffer,
            payload.byteOffset,
            payload.byteLength,
          ),
          { maxOutputLength: 1024 * 1024 },
        )
      : payload;
  const dataTags = JSON.parse(bytes.toString('utf8'));
  if (!dataTags || typeof dataTags !== 'object' || Array.isArray(dataTags))
    return {};
  const tags: Record<string, string> = {};
  for (const key of GENERATION_KEYS) {
    if (key === 'SDStudio') continue;
    if (typeof dataTags[key] === 'string') tags[key] = dataTags[key];
  }
  if (
    !tags.Comment &&
    dataTags.Comment &&
    typeof dataTags.Comment === 'object'
  ) {
    tags.Comment = JSON.stringify(dataTags.Comment);
  }
  if (!tags.Comment && typeof dataTags.prompt === 'string')
    tags.Comment = JSON.stringify(dataTags);
  // The PNG text helper writes Latin-1; use JSON escapes for the NAI JSON.
  if (tags.Comment) tags.Comment = escapeJsonText(tags.Comment);
  for (const [key, value] of Object.entries(tags)) {
    if (/[^\x00-\xff]/.test(value)) delete tags[key];
  }
  return tags;
}

export function registerEditedImageMetadata(
  getDataRoot: () => string,
  exiftool: ExifWriter,
  sharp: typeof import('sharp'),
): void {
  const tools: MetadataTools = {
    writeExif: async (source, target) => {
      const result = await exiftool.write(target, {}, [
        '-overwrite_original',
        '-tagsFromFile',
        source,
        '-EXIF:all',
        '--Orientation',
        '--ExifImageWidth',
        '--ExifImageHeight',
        '--ThumbnailImage',
      ]);
      return result.updated > 0;
    },
    readGenerationTags: async (source) => {
      try {
        const tags = ExifReader.load(source);
        const raw = tags.Comment?.value ?? tags.ImageDescription?.value;
        const comment = Array.isArray(raw) ? raw.join('') : raw;
        if (typeof comment === 'string' && comment.trim().startsWith('{')) {
          const origin = tags.Source?.description;
          return {
            Comment: escapeJsonText(comment),
            ...(origin && !/[^\x00-\xff]/.test(origin)
              ? { Source: origin }
              : {}),
          };
        }
      } catch {
        // Fall back to the original image's alpha metadata when readable tags are unavailable.
      }
      return readStealthGenerationTags(source, sharp).catch(() => ({}));
    },
  };
  ipcMain.handle(
    'restore-edited-image-metadata',
    async (event, inputPath: string) => {
      const root = getDataRoot();
      const sourcePath = path.resolve(root, inputPath);
      const relative = path.relative(root, sourcePath);
      if (
        !relative ||
        relative.startsWith('..' + path.sep) ||
        relative === '..' ||
        path.isAbsolute(relative)
      ) {
        throw new Error('원본 이미지 경로가 올바르지 않습니다.');
      }
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) return false;
      const selected = await dialog.showOpenDialog(parent, {
        title: '내보낸 편집본 PNG 선택',
        defaultPath: path.dirname(sourcePath),
        properties: ['openFile'],
        filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
      });
      const [editedPath] = selected.filePaths;
      if (selected.canceled || !editedPath) return false;

      const output = await dialog.showSaveDialog(parent, {
        title: '생성 정보를 복원한 PNG 저장',
        defaultPath: path.join(
          path.dirname(editedPath),
          path.parse(editedPath).name + '-메타복원.png',
        ),
        filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
      });
      if (output.canceled || !output.filePath) return false;
      await restoreEditedPng(sourcePath, editedPath, output.filePath, tools);
      return true;
    },
  );
}
