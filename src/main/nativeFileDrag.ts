import fs from 'fs';
import path from 'path';
import { isSameOrInside } from './installDirGuard';

/**
 * Resolve a renderer-supplied data path for an OS-native file drag.
 * realpath closes junction/symlink escapes before the containment check.
 */
export function resolveNativeFileDragPath(
  dataRoot: string,
  requestedPath: unknown,
): string {
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) {
    throw new Error('드래그할 이미지 경로가 올바르지 않습니다.');
  }
  const root = fs.realpathSync(dataRoot);
  const file = fs.realpathSync(path.resolve(dataRoot, requestedPath));
  if (!isSameOrInside(file, root) || !fs.statSync(file).isFile()) {
    throw new Error('데이터 저장소 밖의 파일은 드래그할 수 없습니다.');
  }
  return file;
}
