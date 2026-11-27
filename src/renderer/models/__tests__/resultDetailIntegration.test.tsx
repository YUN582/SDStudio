import React from 'react';
import { observable, configure } from 'mobx';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

configure({ enforceActions: 'never' });
const mockImageEvents = Object.assign(new EventTarget(), {
  fetchImage: jest.fn(), invalidateCache: jest.fn(async () => {}), refresh: jest.fn(async () => {}),
});
const mockGameEvents = Object.assign(new EventTarget(), { getOutputs: () => [] });
const mockSessionEvents = Object.assign(new EventTarget(), { isImageBookmarked: () => false });
const mockBackend = { openImageEditor: jest.fn(), watchImage: jest.fn(), showFile: jest.fn(), copyToDownloads: jest.fn() };
const mockFavorite = jest.fn();
const mockBookmark = jest.fn();
const mockDelete = jest.fn(async (..._args: any[]) => {});
const mockVariant = jest.fn(async (..._args: any[]) => {});
const mockParse = jest.fn();
const mockDimensions = jest.fn();
let mockV2 = false;
const mockState = observable({
  curSession: { name: 'project', inpaints: new Map() }, dialogs: [] as any[], modalOverlayCount: 0,
  floatViewCount: 0, undoFloatViewCount: 0, genControlOverlayCount: 0,
  resultViewerOpen: false, imageDetailInfoOpen: false, uiFloatViewMode: 'center',
  skipImageDeleteConfirm: false,
  getAppliedCharacterPreset: () => undefined,
  pushMessage: jest.fn(), pushDialog: jest.fn(), openExternalImage: jest.fn(), copyImagesToClipboard: jest.fn(),
  setImageDetailInfoOpen(open: boolean) { this.imageDetailInfoOpen = open; },
  incrementModalOverlay() { this.modalOverlayCount++; }, decrementModalOverlay() { this.modalOverlayCount--; },
  incrementFloatView() { this.floatViewCount++; }, decrementFloatView() { this.floatViewCount--; },
  incrementUndoFloatView() { this.undoFloatViewCount++; }, decrementUndoFloatView() { this.undoFloatViewCount--; },
  incrementGenControlOverlay() { this.genControlOverlayCount++; }, decrementGenControlOverlay() { this.genControlOverlayCount--; },
}, { pushMessage: false, pushDialog: false, openExternalImage: false, copyImagesToClipboard: false });
const mockFlows = ['SDInpaint', 'SDI2I', 'SDMirror', 'Augment'].map((type) => ({ getType: () => type, def: { title: type } }));
jest.mock('..', () => ({
  imageService: mockImageEvents, gameService: mockGameEvents, sessionService: mockSessionEvents,
  backend: mockBackend, isMobile: false,
  workFlowService: { i2iFlows: mockFlows, getDef: () => undefined },
  imageDownloadService: { downloadSingleImage: jest.fn() },
}));
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (data: string) => data.split(',')[1] }));
jest.mock('../util', () => ({ extractPromptDataFromBase64: (...args: any[]) => mockParse(...args) }));
jest.mock('../sourceVariant', () => ({ openSourceVariant: (...args: any[]) => mockVariant(...args) }));
jest.mock('../sceneImageVariants', () => ({ linkedImageVariants: () => [] }));
jest.mock('../imageStateUndo', () => ({ toggleImageFavorite: (...args: any[]) => mockFavorite(...args), toggleImageBookmarkRecorded: (...args: any[]) => mockBookmark(...args) }));
jest.mock('../deleteUndo', () => ({ deleteImageFilesRecorded: (...args: any[]) => mockDelete(...args) }));
jest.mock('../TaskQueueService', () => ({}));
jest.mock('../sceneQueueActions', () => ({}));
jest.mock('../workflows/NaiUpscaleFlow', () => ({ queueNaiUpscale: jest.fn(async () => {}) }));
jest.mock('../workflows/OneTimeFlows', () => ({ oneTimeFlows: [{ text: '배경제거', handler: jest.fn() }], oneTimeFlowMap: new Map() }));
jest.mock('../SessionService', () => ({}));
jest.mock('../deleteInpaintWork', () => ({}));
jest.mock('../mobileV2', () => ({ isV2: () => mockV2, V2_SHEET_PEEK_PX: 32 }));
jest.mock('../BackStackService', () => ({ backStackService: { init() {}, push: () => ({ remove() {} }) }, useBackLayer() {} }));
jest.mock('react-contexify', () => ({ useContextMenu: () => ({ show() {}, hideAll() {} }) }));
jest.mock('react-dnd', () => ({ useDrag: jest.fn(), useDrop: jest.fn() }));
jest.mock('react-dnd-html5-backend', () => ({ getEmptyImage: () => null }));
jest.mock('../../componenets/GridReorder', () => ({}));
jest.mock('../../componenets/SceneEditor', () => ({ PromptHighlighter: ({ text }: any) => <pre>{text}</pre> }));
jest.mock('../../componenets/BrushTool', () => ({ getImageDimensions: (...args: any[]) => mockDimensions(...args) }));
jest.mock('../../componenets/InPaintEditor', () => () => null);
jest.mock('../../componenets/Tournament', () => () => null);
jest.mock('../../componenets/ShortcutCheatsheet', () => () => null);
jest.mock('../../componenets/SceneQueueControl', () => () => null);
jest.mock('../../componenets/TrashViews', () => ({}));
jest.mock('../../componenets/DownloadDialog', () => ({}));
jest.mock('../../componenets/Tooltip', () => ({ children }: any) => children);
jest.mock('../../componenets/backdropClose', () => ({ confirmDiscardChanges: async () => true, useGuardedClose: (_dirty: any, close: any) => close }));
jest.mock('../../componenets/MobileV2Bars', () => ({
  V2MainRow: ({ slots }: any) => <div>{slots.map((slot: any) => <button key={slot.key} disabled={slot.disabled} onClick={slot.onTap}>{slot.name}</button>)}</div>,
  V2TierRows: ({ open, items }: any) => open ? <div>{items.map((item: any) => <div key={item.id}>{item.node}</div>)}</div> : null,
}));

import { FloatView, FloatViewProvider } from '../../componenets/FloatView';
import { ResultDetailView } from '../../componenets/ResultViewer';

const paths = ['outs/alpha/a.png', 'outs/alpha/b.png'];
const scene: any = { name: 'alpha', type: 'scene', mains: [], imageAccounts: {} };
const job = (prompt: string) => ({ prompt, uc: 'negative', seed: 123, steps: 28, promptGuidance: 5,
  sampling: 'k_euler_ancestral', noiseSchedule: 'karras', characterPrompts: [], vibes: [],
  characterReferences: [], backend: { type: 'NAI' }, resolution: { width: 832, height: 1216 } });
const dataFor = (path: string) => `data:image/png;base64,${btoa(path)}`;
const getPaths = () => paths;
function mount(extra: Record<string, any> = {}) {
  return render(<FloatViewProvider><FloatView priority={1} headerSlot>
    <ResultDetailView session={mockState.curSession as any} scene={scene} getPaths={getPaths}
      initialSelectedIndex={0} buttons={[]} onClose={jest.fn()} {...extra} />
  </FloatView></FloatViewProvider>);
}
async function loaded(path = paths[0]) {
  await screen.findByText(`prompt:${path}`);
}
beforeEach(() => {
  jest.clearAllMocks();
  mockV2 = false;
  mockState.imageDetailInfoOpen = false;
  mockState.modalOverlayCount = 0;
  mockState.dialogs = [];
  mockBackend.openImageEditor.mockResolvedValue(undefined);
  mockBackend.watchImage.mockResolvedValue(undefined);
  mockImageEvents.fetchImage.mockImplementation(async (path: string) => dataFor(path));
  mockParse.mockImplementation(async (data: string) => job(`prompt:${atob(data)}`));
  mockDimensions.mockResolvedValue({ width: 832, height: 1216 });
});

test('header owns compact favorite/copy/bookmark actions; toolbar groups file actions and preserves extra plugins', async () => {
  const plugin = jest.fn();
  const view = mount({ buttons: [{ text: '추가 동작', className: 'back-gray', onClick: plugin }] });
  await loaded();
  const header = within(view.container.querySelector('[data-detail-header-actions]') as HTMLElement);
  fireEvent.click(header.getByRole('button', { name: '이미지 복사' }));
  expect(mockState.copyImagesToClipboard).toHaveBeenCalledWith([paths[0]]);
  expect(header.getByRole('button', { name: '즐겨찾기 지정' })).toBeDefined();
  expect(header.getByRole('button', { name: '북마크' })).toBeDefined();
  const toolbar = screen.getByRole('navigation', { name: '이미지 작업' });
  expect(within(toolbar).queryByRole('button', { name: /즐겨찾기|북마크|이미지 복사|업스케일|인페인트/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /생성 정보 복원/ })).toBeNull();
  fireEvent.click(within(toolbar).getByRole('button', { name: '추가 동작' }));
  expect(plugin).toHaveBeenCalledWith(scene, paths[0], expect.any(Function));
});

test('wide detail pane always shows generation settings and real pixel size without toggle or prompt parts', async () => {
  const view = mount(); await loaded();
  expect(screen.queryByRole('button', { name: '상세 정보' })).toBeNull();
  expect(view.container.querySelector('[data-detail-side-pane]')).toBeNull();
  expect(view.container.querySelector('[data-detail-group="prompt-parts"]')).toBeNull();
  expect(view.container.querySelector('[data-detail-chips]')).toBeNull();
  const pane = view.container.querySelector('[data-detail-info-pane]') as HTMLElement;
  await waitFor(() => expect(pane.textContent).toContain('832 × 1216'));
  const groups = Array.from(pane.querySelectorAll('[data-detail-group]')).map((el) => el.getAttribute('data-detail-group'));
  expect(groups.indexOf('settings')).toBeLessThan(groups.indexOf('prompt'));
  expect(view.container.querySelector('[data-image-detail-text]')?.hasAttribute('data-selectable-text')).toBe(true);
});

test('favorite, bookmark and deletion use the actual owner of a nested result', async () => {
  const owner = { ...scene, name: 'paintA', type: 'inpaint', sceneRef: 'alpha' };
  mount({ imageOwners: new Map([[paths[0], owner]]) }); await loaded();
  fireEvent.click(screen.getByRole('button', { name: '즐겨찾기 지정' }));
  expect(mockFavorite).toHaveBeenCalledWith(mockState.curSession, owner, 'a.png');
  fireEvent.click(screen.getByRole('button', { name: '북마크' }));
  expect(mockBookmark).toHaveBeenCalledWith(mockState.curSession, owner, 'a.png');
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  await act(async () => mockState.pushDialog.mock.calls[0][0].callback());
  expect(mockDelete).toHaveBeenCalledWith(mockState.curSession, [paths[0]], owner);
});

test('variant modal retains every workflow and live upscale cost, and blocks background navigation/deletion', async () => {
  const view = mount(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: '이미지 변형' }));
  const modal = screen.getByLabelText('이미지 변형 방법');
  expect(modal.querySelectorAll('[data-variant-workflow]')).toHaveLength(4);
  await waitFor(() => expect(modal.querySelector('[data-variant-upscale]')?.textContent).toContain('업스케일 비용: 1장당 1 Anlas'));
  expect(mockState.modalOverlayCount).toBe(1);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  fireEvent.keyDown(window, { key: 'Delete' });
  fireEvent(window, new CustomEvent('shortcut-action', { detail: { action: 'toggle-favorite' } }));
  expect(view.container.querySelector('[data-detail-index]')?.textContent).toContain('1 / 2');
  expect(mockState.pushDialog).not.toHaveBeenCalled();
  expect(mockFavorite).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(mockState.modalOverlayCount).toBe(0);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await loaded(paths[1]);
});

test('new inpaint receives the selected file and its owner', async () => {
  mount(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: '이미지 변형' }));
  fireEvent.click(screen.getByRole('button', { name: /인페인트 · I2I/ }));
  await waitFor(() => expect(mockVariant).toHaveBeenCalledWith(mockState.curSession, scene, 'SDInpaint', paths[0], expect.any(Function)));
});

test('an image too large for upscale still displays its actual dimensions', async () => {
  mockDimensions.mockResolvedValue({ width: 4096, height: 4096 });
  const view = mount(); await loaded();
  await waitFor(() => expect(view.container.querySelector('[data-detail-info-pane]')?.textContent).toContain('4096 × 4096'));
  fireEvent.click(screen.getByRole('button', { name: '이미지 변형' }));
  expect((view.container.querySelector('[data-variant-upscale]') as HTMLButtonElement).disabled).toBe(true);
});

test('a 2 Anlas estimate belongs only to the selected upscale action, not I2I generation', async () => {
  mockDimensions.mockResolvedValue({ width: 1536, height: 1024 });
  mount(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: '이미지 변형' }));
  const modal = screen.getByLabelText('이미지 변형 방법');
  const upscale = modal.querySelector('[data-variant-upscale]') as HTMLButtonElement;
  await waitFor(() => expect(upscale.textContent).toContain('업스케일 비용: 1장당 2 Anlas'));
  expect(upscale.querySelector('.sds-variant-work-title')?.textContent).toBe('업스케일 ×2');
  expect(upscale.title).toContain('업스케일 비용: 1장당 2 Anlas');
  expect(within(modal).getByRole('button', { name: /인페인트 · I2I/ }).textContent).not.toContain('Anlas');
});

test('a late old image request cannot replace the newly selected image or metadata', async () => {
  let finishOld!: (value: string) => void;
  mockImageEvents.fetchImage.mockImplementation((path: string) => path === paths[0]
    ? new Promise<string>((resolve) => { finishOld = resolve; }) : Promise.resolve(dataFor(path)));
  mount();
  fireEvent.keyDown(window, { key: 'ArrowRight' }); await loaded(paths[1]);
  await act(async () => finishOld(dataFor(paths[0])));
  expect(screen.queryByText(`prompt:${paths[0]}`)).toBeNull();
  expect(document.querySelector('.sds-detail-image > img')?.getAttribute('src')).toBe(dataFor(paths[1]));
});

test('a late old metadata parse cannot overwrite the current prompt', async () => {
  let finishOld!: (value: any) => void;
  mockParse.mockImplementation((data: string) => atob(data) === paths[0]
    ? new Promise((resolve) => { finishOld = resolve; }) : Promise.resolve(job(`prompt:${atob(data)}`)));
  mount(); await waitFor(() => expect(finishOld).toBeDefined());
  fireEvent.keyDown(window, { key: 'ArrowRight' }); await loaded(paths[1]);
  await act(async () => finishOld(job('obsolete prompt')));
  expect(screen.queryByText('obsolete prompt')).toBeNull();
  expect(screen.getByText(`prompt:${paths[1]}`)).toBeDefined();
});

test('failed external editor launch leaves no file watcher', async () => {
  mockBackend.openImageEditor.mockRejectedValue(new Error('launch failed'));
  mount(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: '이미지 편집' }));
  await waitFor(() => expect(mockState.pushMessage).toHaveBeenCalledWith(expect.any(String), 'error'));
  expect(mockBackend.watchImage).not.toHaveBeenCalled();
});

test('foreign history settings never attach the foreign scene to the current project', async () => {
  mount({ session: { name: 'other', inpaints: new Map() }, historyEntry: { path: paths[0] } }); await loaded();
  fireEvent.click(screen.getByRole('button', { name: '생성 설정 적용' }));
  expect(mockState.openExternalImage).toHaveBeenCalledWith(btoa(paths[0]), undefined, undefined);
});

test('mobile V2 keeps favorite and inpaint actions even without inherited plugin buttons', async () => {
  mockV2 = true;
  mount();
  await waitFor(() => expect(mockImageEvents.fetchImage).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: '즐겨찾기' }));
  expect(mockFavorite).toHaveBeenCalledWith(mockState.curSession, scene, 'a.png');
  fireEvent.click(screen.getByRole('button', { name: '인페인트' }));
  await waitFor(() => expect(mockVariant).toHaveBeenCalledWith(mockState.curSession, scene, 'SDInpaint', paths[0], expect.any(Function)));
});

test('missing generation metadata still shows file facts instead of stale prompt text', async () => {
  mockParse.mockResolvedValue(undefined);
  const view = mount();
  await screen.findByText('이 이미지에는 생성 정보가 없습니다');
  expect(view.container.querySelector('[data-detail-info-pane]')?.textContent).toContain('a.png');
  expect(screen.queryByText(`prompt:${paths[0]}`)).toBeNull();
});

test('file load failure is distinct from absent metadata and retry reloads the same image', async () => {
  mockImageEvents.fetchImage.mockRejectedValueOnce(new Error('file not found'));
  mount();
  await screen.findByText('이미지를 불러오지 못했습니다.');
  expect(screen.queryByText('이 이미지에는 생성 정보가 없습니다')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await loaded();
  expect(mockImageEvents.invalidateCache).toHaveBeenCalledWith(paths[0]);
});

test('cache invalidation reloads only the displayed image', async () => {
  mount(); await loaded();
  const initialCalls = mockImageEvents.fetchImage.mock.calls.length;
  await act(async () => mockImageEvents.dispatchEvent(new CustomEvent('image-cache-invalidated', { detail: { path: 'elsewhere.png' } })));
  expect(mockImageEvents.fetchImage).toHaveBeenCalledTimes(initialCalls);
  await act(async () => mockImageEvents.dispatchEvent(new CustomEvent('image-cache-invalidated', { detail: { path: paths[0] } })));
  await waitFor(() => expect(mockImageEvents.fetchImage).toHaveBeenCalledTimes(initialCalls + 1));
});

test('refreshing the gallery list without changing the selected file does not reload its data', async () => {
  let outputs = [...paths];
  mount({ getPaths: () => outputs }); await loaded();
  const initialCalls = mockImageEvents.fetchImage.mock.calls.length;
  outputs = [...outputs];
  await act(async () => mockGameEvents.dispatchEvent(new Event('updated')));
  expect(mockImageEvents.fetchImage).toHaveBeenCalledTimes(initialCalls);
  expect(screen.getByText(`prompt:${paths[0]}`)).toBeDefined();
});

test('switching images keeps previous detail info and apply button stable until next image finishes loading, and action bar has no separator', async () => {
  let finishNext!: (value: string) => void;
  mockImageEvents.fetchImage.mockImplementation((path: string) => path === paths[1]
    ? new Promise<string>((resolve) => { finishNext = resolve; }) : Promise.resolve(dataFor(path)));
  const view = mount(); await loaded(paths[0]);
  const toolbar = screen.getByRole('navigation', { name: '이미지 작업' });
  expect(toolbar.querySelector('.sds-detail-sep')).toBeNull();
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await waitFor(() => expect(finishNext).toBeDefined());
  // 전환 로딩 중에도 이전 생성 설정이 유지되어 파일 항목이 상단으로 튀지 않고, 생성 설정 적용 버튼도 비활성화되지 않는다.
  const pane = view.container.querySelector('[data-detail-info-pane]') as HTMLElement;
  expect(pane.querySelector('[data-detail-group="settings"]')).not.toBeNull();
  expect((within(toolbar).getByRole('button', { name: '생성 설정 적용' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => finishNext(dataFor(paths[1])));
  await loaded(paths[1]);
});
