import React from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react';

const mockContexts: Record<string, any> = {};
const mockBackend = { openImageEditor: jest.fn(), watchImage: jest.fn(), copyImageToClipboard: jest.fn() };
const mockImages = { fetchImage: jest.fn() };
const mockHistory = { resolve: jest.fn() };
const mockState = {
  curSession: {} as object,
  selectedSceneCount: () => 0,
  contextSceneType: 'scene',
  pushMessage: jest.fn(),
  openExternalImage: jest.fn(),
  saveImageAsGlobalPreset: jest.fn(),
};

// Substitute only the menu host. Render AppContextMenu and run its actual click handlers.
jest.mock('react-contexify', () => {
  const R = require('react');
  const Context = R.createContext(null);
  return {
    Menu: ({ id, children }: any) => R.createElement(Context.Provider, { value: id },
      R.createElement('section', { role: 'menu', 'aria-label': id }, children)),
    Item: ({ id, hidden, onClick, children }: any) => {
      const menu = R.useContext(Context);
      const props = { ctx: mockContexts[menu] };
      if (typeof hidden === 'function' ? hidden({ props }) : hidden) return null;
      return R.createElement('button', {
        role: 'menuitem', onClick: () => onClick({ id, props }),
      }, children);
    },
    Separator: () => R.createElement('hr'),
  };
});
jest.mock('..', () => ({
  backend: mockBackend, imageService: mockImages, imageHistoryService: mockHistory,
  isMobile: false,
}));
jest.mock('../AppService', () => ({ appState: mockState }));
jest.mock('../types', () => ({ ContextMenuType: {
  Scene: 'scene', GallaryImage: 'gallary_image', Image: 'image', HistoryImage: 'history_image', Style: 'style',
} }));
jest.mock('../inpaintInput', () => ({}));
jest.mock('../ImageService', () => ({ dataUriToBase64: () => 'metadata-base64' }));
jest.mock('../imageStateUndo', () => ({}));
jest.mock('../TrashService', () => ({}));
jest.mock('../deleteFlowRules', () => ({}));
jest.mock('../SessionService', () => ({}));
jest.mock('../workflows/OneTimeFlows', () => ({}));
jest.mock('../workflows/NaiUpscaleFlow', () => ({}));
jest.mock('../util', () => ({}));
jest.mock('../sceneQueueActions', () => ({}));
jest.mock('../sceneSeedGroups', () => ({}));
jest.mock('../i2iBatchFlow', () => ({}));
jest.mock('../variantBatchFlow', () => ({}));
jest.mock('../sceneSelectorHost', () => ({}));
jest.mock('../sceneOrderUndo', () => ({}));
jest.mock('../presetUndo', () => ({}));
jest.mock('../presetDeleteConfirm', () => ({}));
jest.mock('../sceneStructureUndo', () => ({}));
jest.mock('../deleteUndo', () => ({}));
jest.mock('../undoService', () => ({}));
jest.mock('../nameInput', () => ({}));
jest.mock('../sceneFieldUndo', () => ({}));
jest.mock('../sceneCopyFlow', () => ({}));
jest.mock('../../componenets/contextMenuBack', () => ({ contextMenuBackLayer: () => () => {} }));

import { AppContextMenu } from '../../componenets/AppContextMenu';

const imageMenus = ['gallary_image', 'image', 'history_image'];
const scene = { name: 'source', type: 'scene' };
const entry = { id: 'history-id', path: 'source.png' };
beforeEach(() => {
  jest.clearAllMocks();
  mockState.curSession = {};
  mockContexts.gallary_image = { path: ['source.png'], scene };
  mockContexts.image = { path: 'source.png', scene };
  mockContexts.history_image = { entry, onOpenImage: jest.fn() };
  mockBackend.openImageEditor.mockResolvedValue(undefined);
  mockBackend.watchImage.mockResolvedValue(undefined);
  mockImages.fetchImage.mockResolvedValue('data:image/png;base64,metadata-base64');
  mockHistory.resolve.mockResolvedValue({ session: mockState.curSession, scene });
});

function mountMenu(name: string) {
  const view = render(<AppContextMenu />);
  return within(view.getByRole('menu', { name }));
}

test.each(imageMenus)('%s has one editor, one metadata entry and one global-preset entry', (name) => {
  const menu = mountMenu(name);
  expect(menu.getAllByRole('menuitem', { name: '이미지 편집' })).toHaveLength(1);
  expect(menu.getAllByRole('menuitem', { name: '메타 정보 보기' })).toHaveLength(1);
  expect(menu.getAllByRole('menuitem', { name: '글로벌 프리셋 추가' })).toHaveLength(1);
});

test.each(imageMenus)('%s opens the editor before watching the file', async (name) => {
  const menu = mountMenu(name);
  fireEvent.click(menu.getByRole('menuitem', { name: '이미지 편집' }));
  await waitFor(() => expect(mockBackend.watchImage).toHaveBeenCalledWith('source.png'));
  expect(mockBackend.openImageEditor).toHaveBeenCalledWith('source.png');
  expect(mockBackend.openImageEditor.mock.invocationCallOrder[0])
    .toBeLessThan(mockBackend.watchImage.mock.invocationCallOrder[0]);
});

test.each(imageMenus)('%s does not leave a watcher after a failed editor launch', async (name) => {
  mockBackend.openImageEditor.mockRejectedValue(new Error('launch failed'));
  fireEvent.click(mountMenu(name).getByRole('menuitem', { name: '이미지 편집' }));
  await waitFor(() => expect(mockState.pushMessage).toHaveBeenCalledWith(expect.any(String), 'error'));
  expect(mockBackend.watchImage).not.toHaveBeenCalled();
});

test.each(imageMenus)('%s opens metadata for the selected image with its current-project scene', async (name) => {
  fireEvent.click(mountMenu(name).getByRole('menuitem', { name: '메타 정보 보기' }));
  await waitFor(() => expect(mockState.openExternalImage).toHaveBeenCalledWith('metadata-base64', scene, 'source.png'));
  expect(mockImages.fetchImage).toHaveBeenCalledWith('source.png');
});

test('history from another project never supplies that scene as the current apply target', async () => {
  mockHistory.resolve.mockResolvedValue({ session: {}, scene });
  fireEvent.click(mountMenu('history_image').getByRole('menuitem', { name: '메타 정보 보기' }));
  await waitFor(() => expect(mockState.openExternalImage).toHaveBeenCalledWith('metadata-base64', undefined, undefined));
});

test('batch gallery selection hides the single-file editor and metadata action', () => {
  mockContexts.gallary_image.path.push('other.png');
  const menu = mountMenu('gallary_image');
  expect(menu.queryByRole('menuitem', { name: '이미지 편집' })).toBeNull();
  expect(menu.queryByRole('menuitem', { name: '메타 정보 보기' })).toBeNull();
});

test.each(imageMenus)('%s adds a global preset once', async (name) => {
  fireEvent.click(mountMenu(name).getByRole('menuitem', { name: '글로벌 프리셋 추가' }));
  await waitFor(() => expect(mockState.saveImageAsGlobalPreset).toHaveBeenCalledTimes(1));
  expect(mockState.saveImageAsGlobalPreset).toHaveBeenCalledWith('source.png');
});

test('history image navigation reuses the card preview action', () => {
  fireEvent.click(mountMenu('history_image').getByRole('menuitem', { name: '이미지로 이동' }));
  expect(mockContexts.history_image.onOpenImage).toHaveBeenCalledTimes(1);
});

test('an already open history image does not offer a dead navigation action', () => {
  delete mockContexts.history_image.onOpenImage;
  expect(mountMenu('history_image').queryByRole('menuitem', { name: '이미지로 이동' })).toBeNull();
});

test.each(imageMenus)('%s copies image pixels to the OS clipboard', async (name) => {
  fireEvent.click(mountMenu(name).getByRole('menuitem', { name: '이미지 복사' }));
  await waitFor(() => expect(mockBackend.copyImageToClipboard).toHaveBeenCalledWith('source.png'));
  expect(mockBackend.copyImageToClipboard).toHaveBeenCalledTimes(1);
});
