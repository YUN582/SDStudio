import React, { useRef } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
const escapeCallbacks: Array<() => void> = [];
jest.mock('../AppService', () => ({ appState: { dialogs: [] } }));
jest.mock('../../componenets/contextMenuBack', () => ({ hasOpenContextMenu: () => false }));
jest.mock('../BackStackService', () => ({ backStackService: { push: (close: () => void) => {
  escapeCallbacks.push(close); return { remove: () => escapeCallbacks.splice(escapeCallbacks.indexOf(close), 1) };
} } }));
jest.mock('..', () => ({ imageService: {}, gameService: {}, sessionService: {} }));
jest.mock('../imageStateUndo', () => ({ recordImageOrder: jest.fn() }));
jest.mock('../undoService', () => ({}));
import { gridClickSelection } from '../gridSelection';
import { reorderGalleryPaths } from '../galleryReorder';
import { ReorderDragPreview, useGridReorder } from '../../componenets/GridReorder';

test('Ctrl toggles membership; Shift selects the visible range from the surviving anchor', () => {
  const order = ['a', 'b', 'c', 'd'];
  const first = gridClickSelection(order, new Set(), undefined, 'b', { ctrlKey: true });
  expect([...first.keys]).toEqual(['b']);
  const range = gridClickSelection(order, first.keys, first.anchor, 'd', { shiftKey: true });
  expect([...range.keys]).toEqual(['b', 'c', 'd']);
  const removed = gridClickSelection(order, range.keys, range.anchor, 'b', { ctrlKey: true });
  expect(removed.anchor).toBe('d');
  expect([...gridClickSelection(order, removed.keys, removed.anchor, 'a', { shiftKey: true }).keys]).toEqual(order);
});

test('combined reorder moves filtered selected results together and preserves hidden entries', () => {
  const all = ['original/a', 'edit/a', 'original/b', 'edit/b'];
  expect(reorderGalleryPaths(all, 'edit/b', 'original/a', ['original/a', 'edit/a', 'edit/b'], ['edit/a', 'edit/b']))
    .toEqual(['edit/a', 'edit/b', 'original/a', 'original/b']);
  expect(reorderGalleryPaths(all, 'edit/a', 'edit/b', all, ['edit/a', 'edit/b'])).toBe(all);
});

function Fixture({ commit, open }: { commit: jest.Mock; open: jest.Mock }) {
  const viewport = useRef<HTMLDivElement>(null), suppressed = useRef(false);
  const reorder = useGridReorder<string>({
    enabled: true, scope: 'gallery', viewport, cardSelector: '[data-card]',
    resolve: card => card.dataset.card, selected: () => ['a', 'b'], commit, suppressClick: suppressed,
  });
  return <div ref={viewport} data-testid="viewport" onMouseDownCapture={reorder.start}
    onClickCapture={event => { if (suppressed.current) { suppressed.current = false; event.stopPropagation(); } }}>
    {['a', 'b', 'c'].map(key => <div data-card={key} key={key} onClick={() => open(key)}>{key}</div>)}
    {reorder.drag && <ReorderDragPreview type="image" drag={reorder.drag} />}
  </div>;
}

test('drag shows a stack, leaves wheel scrolling native, commits the group and suppresses opening', () => {
  const rect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } as DOMRect);
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const commit = jest.fn(), open = jest.fn();
  const ui = render(<Fixture commit={commit} open={open} />);
  const a = ui.container.querySelector('[data-card=a]')!, c = ui.container.querySelector('[data-card=c]')!;
  const previous = document.elementFromPoint;
  document.elementFromPoint = () => c;
  try {
    fireEvent.mouseDown(a, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 50, clientY: 50 });
    expect(document.querySelector('[data-reorder-count]')?.textContent).toBe('2');
    expect(document.querySelector('[data-reorder-stack-card]')).not.toBeNull();
    expect((document.querySelector('[data-reorder-drag-preview]') as HTMLElement).style.overflow).toBe('hidden');
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    ui.getByTestId('viewport').dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });
    expect(commit).toHaveBeenCalledWith('a', 'c', ['a', 'b']);
    fireEvent.click(a);
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('[data-reorder-drag-preview]')).toBeNull();
    fireEvent.mouseDown(a, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 50, clientY: 50 });
    act(() => escapeCallbacks[0]());
    fireEvent.mouseUp(window, { clientX: 50, clientY: 50 });
    expect(commit).toHaveBeenCalledTimes(1);
  } finally {
    ui.unmount(); document.elementFromPoint = previous; rect.mockRestore(); raf.mockRestore(); cancel.mockRestore();
  }
});


test('floating card pixels share the shadow origin instead of retaining virtual grid offsets', () => {
  const rect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 620, top: 180, right: 720, bottom: 280, width: 100, height: 100 } as DOMRect);
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  const cancel = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const ui = render(<Fixture commit={jest.fn()} open={jest.fn()} />);
  const card = ui.container.querySelector<HTMLElement>('[data-card=b]')!;
  Object.assign(card.style, { position: 'absolute', left: '600px', top: '200px', transform: 'translate(0px, 10px)' });
  card.innerHTML = '<img class="image-anime" src="fixture.png" />';
  const previous = document.elementFromPoint;
  document.elementFromPoint = () => card;
  try {
    fireEvent.mouseDown(card, { button: 0, clientX: 645, clientY: 200 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 400, clientY: 300 });
    const overlay = document.querySelector('[data-reorder-drag-preview]')!;
    const position = overlay.firstElementChild as HTMLElement;
    const clone = overlay.querySelector<HTMLElement>('[data-card=b]')!;
    expect(position.style.left).toBe('375px');
    expect(position.style.top).toBe('280px');
    expect(clone.style.position).toBe('relative');
    expect(clone.style.left).toBe('0px');
    expect(clone.style.top).toBe('0px');
    expect(clone.style.transform).toBe('none');
    expect(clone.querySelector('img')!.style.animation).toBe('none');
    expect(card.style.left).toBe('600px');
    expect(card.style.top).toBe('200px');
    fireEvent.mouseMove(window, { buttons: 1, clientX: 450, clientY: 320 });
    expect(position.style.left).toBe('425px');
    expect(overlay.querySelector('[data-card=b]')).toBe(clone);
    fireEvent.mouseUp(window, { clientX: 450, clientY: 320 });
  } finally {
    ui.unmount(); document.elementFromPoint = previous; rect.mockRestore(); raf.mockRestore(); cancel.mockRestore();
  }
});
