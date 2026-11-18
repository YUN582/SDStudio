import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
const nativeDrag = jest.fn(async () => {}), move = jest.fn(async () => {}), metadata = jest.fn(), open = jest.fn();
const scene = { name: 'target' };
const session = { getScene: () => scene };
jest.mock('..', () => ({ backend: { startFileDrag: nativeDrag }, isMobile: false,
  imageService: { fetchImage: async () => 'data:image/png;base64,QUJD' } }));
jest.mock('../AppService', () => ({ appState: { curSession: session, openExternalImage: metadata, pushMessage: jest.fn() } }));
jest.mock('../historyImageDrop', () => ({ dropHistoryImage: move }));
jest.mock('../ImageService', () => ({ dataUriToBase64: (s: string) => s.split(',')[1] }));
jest.mock('../BackStackService', () => ({ backStackService: { push: () => ({ remove: () => {} }) } }));
import { useHistoryImageDrag } from '../../componenets/HistoryImageDrag';
const entry = { id: 'a', path: 'outs/source/a.png', sessionName: 'P', sceneType: 'scene' as const, sceneName: 'source', filename: 'a.png', createdAt: 1 };
function Fixture() {
  const drag = useHistoryImageDrag(entry, open);
  return <><div data-testid="history" data-history-image-cell onMouseDown={drag.start} onClick={drag.click}>image</div>{drag.preview}
    <div data-testid="target" data-history-drop-scene="target" data-history-drop-type="scene"><div data-testid="image" data-history-drop-path="outs/target/b.png" /></div>
    <div data-testid="metadata">metadata area</div></>;
}

test('reuses the grid card preview, moves onto a target, suppresses click, and opens metadata on a blank drop', async () => {
  const rect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const previous = document.elementFromPoint;
  const ui = render(<Fixture />);
  try {
    document.elementFromPoint = () => ui.getByTestId('image');
    fireEvent.mouseDown(ui.getByTestId('history'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 40, clientY: 40 });
    expect(document.querySelector('[data-reorder-drag-preview="history-image"]')).not.toBeNull();
    expect(ui.getByTestId('image').classList.contains('ring-sky-500')).toBe(true);
    await act(async () => fireEvent.mouseUp(window, { clientX: 40, clientY: 40 }));
    expect(move).toHaveBeenCalledWith(entry, session, scene, 'outs/target/b.png', false);
    fireEvent.click(ui.getByTestId('history'));
    expect(open).not.toHaveBeenCalled();
    expect(nativeDrag).not.toHaveBeenCalled();
    expect(ui.getByTestId('image').classList.contains('ring-sky-500')).toBe(false);
    document.elementFromPoint = () => ui.getByTestId('metadata');
    fireEvent.mouseDown(ui.getByTestId('history'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 40, clientY: 40 });
    await act(async () => fireEvent.mouseUp(window, { clientX: 40, clientY: 40 }));
    expect(metadata).toHaveBeenCalledWith('QUJD');
  } finally {
    ui.unmount(); document.elementFromPoint = previous; rect.mockRestore(); raf.mockRestore(); cancel.mockRestore();
  }
});
