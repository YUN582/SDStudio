const files = new Map<string, string>();
const buildExportPng = jest.fn(async (id: string) => 'png:' + id);
const write = jest.fn(async (path: string, value: string) => { files.set(path.toLowerCase(), value); });
jest.mock('..', () => ({ backend: {
  existFileAbsolute: async (path: string) => files.has(path.toLowerCase()),
  writeDataFileAbsolute: (path: string, value: string) => write(path, value),
}, globalPresetService: { buildExportPng: (id: string) => buildExportPng(id) } }));
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../ImageService', () => ({ cropMirrorResultFromDataUri: jest.fn(), dataUriToBase64: jest.fn() }));
jest.mock('../types', () => ({}));
import { exportGlobalPresetPngs } from '../globalPresetPngExport';

beforeEach(() => { files.clear(); jest.clearAllMocks(); });

test('writes each selected preset with safe distinct filenames and preserves existing files', async () => {
  files.set('e:/chosen/a_b.png', 'existing');
  const progress = jest.fn();
  const result = await exportGlobalPresetPngs([
    { id: 'one', name: 'a/b' }, { id: 'two', name: 'a:b' }, { id: 'three', name: 'CON' },
  ], 'E:/chosen', progress);
  expect(result).toEqual({ saved: 3, failed: [] });
  expect([...files.keys()]).toEqual(['e:/chosen/a_b.png', 'e:/chosen/a_b_1.png', 'e:/chosen/a_b_2.png', 'e:/chosen/_con.png']);
  expect(files.get('e:/chosen/a_b.png')).toBe('existing');
  expect(write.mock.calls.map(([, png]) => png)).toEqual(['png:one', 'png:two', 'png:three']);
  expect(progress.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
});

test('continues after one failure and reports the failed preset name', async () => {
  buildExportPng.mockRejectedValueOnce(new Error('missing image'));
  expect(await exportGlobalPresetPngs([{ id: 'bad', name: 'Bad' }, { id: 'good', name: 'Good' }], 'E:/chosen'))
    .toEqual({ saved: 1, failed: ['Bad'] });
  expect(files.get('e:/chosen/good.png')).toBe('png:good');
});
