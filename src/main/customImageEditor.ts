import { spawn } from 'child_process';
import { stat } from 'fs/promises';
import { win32 } from 'path';

export async function launchCustomImageEditor(
  executable: string | undefined,
  imagePath: string,
): Promise<void> {
  if (
    typeof executable !== 'string' ||
    !/^[A-Za-z]:[\\/]/.test(executable) ||
    win32.extname(executable).toLowerCase() !== '.exe' ||
    !(await stat(executable).catch(() => null))?.isFile()
  ) {
    throw new Error('이미지 편집기의 실행 파일(.exe)을 확인해주세요.');
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [imagePath], {
      detached: true,
      shell: false,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
