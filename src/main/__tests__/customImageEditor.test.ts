import { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import { stat } from 'fs/promises';
import { launchCustomImageEditor } from '../customImageEditor';

jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
}));
jest.mock('fs/promises', () => ({ stat: jest.fn() }));

const mockSpawn = jest.mocked(spawn);
const mockStat = jest.mocked(stat);

beforeEach(() => {
  jest.resetAllMocks();
});

it('passes a path with spaces and shell characters as a single argument', async () => {
  const editor = 'C:\\Program Files\\CELSYS\\CLIPStudioPaint.EXE';
  const image = 'E:\\그림 & 작업\\image.png';
  const child = Object.assign(new ChildProcess(), { unref: jest.fn() });
  mockStat.mockResolvedValue({ isFile: () => true } as Awaited<
    ReturnType<typeof stat>
  >);
  mockSpawn.mockImplementation(() => {
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });

  await launchCustomImageEditor(editor, image);

  expect(mockSpawn).toHaveBeenCalledWith(editor, [image], {
    detached: true,
    shell: false,
    stdio: 'ignore',
  });
  expect(child.unref).toHaveBeenCalledTimes(1);
});

it.each([undefined, 'clip.exe', 'C:\\editor.cmd', 'C:\\missing.exe'])(
  'rejects an unusable editor path (%s)',
  async (editor) => {
    mockStat.mockRejectedValue(new Error('ENOENT'));
    await expect(
      launchCustomImageEditor(editor, 'E:\\image.png'),
    ).rejects.toThrow('.exe');
    expect(mockSpawn).not.toHaveBeenCalled();
  },
);
