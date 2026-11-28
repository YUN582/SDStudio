import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { observable, runInAction } from 'mobx';
import { observer } from 'mobx-react-lite';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const mockScene = { name: 'S', type: 'scene', mains: [] };
const mockSession = { name: 'P' };
const mockHistory = observable({ entries: [] as any[] });
const mockResolve = jest.fn(async () => ({ session: mockSession, scene: mockScene }) as any);
jest.mock('..', () => ({
  imageHistoryService: { get entries() { return mockHistory.entries; }, resolve: (...args: any[]) => (mockResolve as any)(...args) },
  imageService: { getOutputDir: () => 'outs/P/S', refresh: async () => {} },
  gameService: { getOutputs: () => ['1.png', '2.png'] },
  backend: { existFile: async () => true },
  isMobile: false,
}));
jest.mock('../AppService', () => ({ appState: { pushMessage: jest.fn() } }));
jest.mock('../imageStateUndo', () => ({ toggleImageFavorite: jest.fn() }));
jest.mock('../../componenets/HistoryImageDrag', () => ({ useHistoryImageDrag: () => ({}) }));
jest.mock('../../componenets/ToolbarDnd', () => ({ toolbarDragUi: { armed: null } }));
jest.mock('../../componenets/FloatView', () => ({ FloatView: ({ children }: any) => children }));
jest.mock('../../componenets/ResultViewer', () => ({ ResultDetailView: () => <div data-shared-detail="" /> }));
import { HistoryImagePreview, useHistoryImagePreview } from '../../componenets/ImageHistory';
import { openHistoryPreview, closeHistoryPreview, historyPreviewState, setHistoryViewerMode } from '../historyPreview';

const Fixture = observer(() => {
  const { preview, close } = useHistoryImagePreview();
  return preview ? <HistoryImagePreview preview={preview} onClose={close} /> : null;
});

test.each([false, true])('shared history preview releases its keyboard gate when the entry disappears or cannot resolve: %s', async missing => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    closeHistoryPreview(); setHistoryViewerMode('single');
    mockResolve.mockResolvedValue(missing ? null : { session: mockSession, scene: mockScene });
    runInAction(() => { mockHistory.entries = [{ id: 'outs/P/S/1.png', path: 'outs/P/S/1.png', filename: '1.png', sessionName: 'P', sceneName: 'S', sceneType: 'scene' }]; });
    await act(async () => { root.render(<Fixture />); });
    await act(async () => { openHistoryPreview('outs/P/S/1.png'); });
    if (!missing) {
      expect(host.querySelector('[data-shared-detail]')).not.toBeNull();
      // Another image remains in the scene; deleting this entry still closes history.
      await act(async () => { runInAction(() => { mockHistory.entries = []; }); });
    }
    expect(historyPreviewState.entryId).toBeNull();
    expect(host.querySelector('[data-shared-detail]')).toBeNull();
  } finally {
    await act(async () => { root.unmount(); }); host.remove(); closeHistoryPreview();
  }
});
