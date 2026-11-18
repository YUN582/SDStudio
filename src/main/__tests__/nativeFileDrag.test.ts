import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveNativeFileDragPath } from '../nativeFileDrag';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-native-drag-'));
  fs.mkdirSync(path.join(root, 'workspace', 'project', 'outs'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(root, 'workspace', 'project', 'outs', 'image.png'),
    'png',
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('accepts an existing image file inside the data root', () => {
  const resolved = resolveNativeFileDragPath(
    root,
    'workspace/project/outs/image.png',
  );
  expect(resolved).toBe(
    fs.realpathSync(path.join(root, 'workspace', 'project', 'outs', 'image.png')),
  );
});

test('rejects traversal, directories, and missing files', () => {
  const outside = path.join(path.dirname(root), 'outside.png');
  fs.writeFileSync(outside, 'png');
  try {
    expect(() =>
      resolveNativeFileDragPath(root, '../outside.png'),
    ).toThrow('데이터 저장소 밖');
    expect(() =>
      resolveNativeFileDragPath(root, 'workspace/project/outs'),
    ).toThrow('데이터 저장소 밖');
    expect(() =>
      resolveNativeFileDragPath(root, 'workspace/project/outs/missing.png'),
    ).toThrow();
  } finally {
    fs.rmSync(outside, { force: true });
  }
});
