import React, { useRef } from 'react';
import { act, fireEvent, render } from '@testing-library/react';

const layers: Array<{ close: () => void; opts: any }> = [];
jest.mock('../AppService', () => ({ appState: { dialogs: [], modalOverlayCount: 0 } }));
jest.mock('../../componenets/contextMenuBack', () => ({ hasOpenContextMenu: () => false }));
jest.mock('../BackStackService', () => {
  const push = (close: () => void, opts: any) => {
    const entry = { close, opts }; layers.push(entry);
    return { remove: () => { const at = layers.indexOf(entry); if (at >= 0) layers.splice(at, 1); } };
  };
  return { backStackService: { push }, useBackLayer: (active: boolean, close: () => void, opts: any) => {
    require('react').useEffect(() => active ? push(close, opts).remove : undefined, [active]);
  } };
});
import { useLibraryGridSelection } from '../../componenets/LibraryGridSelection';
import { ReorderDragPreview, useGridReorder } from '../../componenets/GridReorder';
import { decide } from '../escapeGate';
import { appState } from '../AppService';

const ids = ['a', 'b', 'c', 'd'];
function Fixture({ active = true, scope = '', order = ids, open = jest.fn(), action = jest.fn(), commit = jest.fn() }: {
  active?: boolean; scope?: string; order?: string[]; open?: jest.Mock; action?: jest.Mock; commit?: jest.Mock;
}) {
  const viewport = useRef<HTMLDivElement>(null), suppressClick = useRef(false);
  const selection = useLibraryGridSelection({ desktop: true, active, scope, ids: order, viewport, suppressClick,
    cardSelector: '[data-card]', idOf: card => card.dataset.card });
  const reorder = useGridReorder({ enabled: active, scope, viewport, suppressClick, cardSelector: '[data-card]',
    resolve: card => card.dataset.card, selected: id => selection.selectedIds.has(id) ? [...selection.selectedIds] : [id], commit });
  return <div ref={viewport} data-testid="viewport" tabIndex={0}
    onKeyDownCapture={selection.onKeyDownCapture}
    onMouseDownCapture={e => { if (!selection.onMouseDownCapture(e)) reorder.start(e); }}
    onClickCapture={selection.onClickCapture}>
    {order.map(id => <div key={id} data-card={id} data-selected={selection.selectedIds.has(id)} onClick={() => open(id)}>
      <span data-library-card-activate="">{id}</span><button onClick={event => { event.stopPropagation(); action(id); }}>action</button>
    </div>)}
    {selection.overlay}
    {reorder.drag && <ReorderDragPreview type="library-test" drag={reorder.drag} />}
  </div>;
}
const selected = (root: Element) => Array.from(root.querySelectorAll('[data-selected=true]')).map(card => card.getAttribute('data-card'));
const escape = () => {
  const result = decide(layers.map((layer, id) => ({ id, onClose: layer.close, opts: layer.opts })), 'escape');
  if (result.kind === 'run') result.run();
};

test('keyboard movement, range selection, toggling, select all and Enter share one focus', () => {
  const open = jest.fn(), ui = render(<Fixture open={open} />), view = ui.getByTestId('viewport');
  fireEvent.keyDown(view, { key: 'ArrowRight' });
  expect(ui.container.querySelector('[data-card=a]')?.getAttribute('data-library-focused')).toBe('true');
  fireEvent.keyDown(view, { key: ' ', ctrlKey: true });
  expect(selected(ui.container)).toEqual(['a']);
  fireEvent.keyDown(view, { key: 'ArrowDown', shiftKey: true });
  expect(selected(ui.container)).toEqual(['a', 'b']);
  fireEvent.keyDown(view, { key: 'ArrowDown', shiftKey: true });
  expect(selected(ui.container)).toEqual(['a', 'b', 'c']);
  fireEvent.keyDown(view, { key: 'ArrowUp' });
  expect(selected(ui.container)).toEqual([]);
  fireEvent.keyDown(view, { key: 'Enter' });
  expect(open).toHaveBeenCalledWith('b');
  fireEvent.keyDown(view, { key: 'a', ctrlKey: true });
  expect(selected(ui.container)).toEqual(ids);
});
beforeEach(() => {
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = ids.indexOf(this.dataset.card ?? '');
    const top = index < 0 ? 0 : 20 + index * 100;
    const left = index < 0 ? 0 : 20;
    const width = index < 0 ? 400 : 100, height = index < 0 ? 450 : 80;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height } as DOMRect;
  });
  jest.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); });

test('Ctrl toggles, Shift uses visible order, and a plain click opens with selection cleared', () => {
  const open = jest.fn(), ui = render(<Fixture open={open} />);
  const card = (id: string) => ui.container.querySelector(`[data-card=${id}]`)!;
  fireEvent.click(card('b'), { ctrlKey: true });
  fireEvent.click(card('d'), { shiftKey: true });
  expect(selected(ui.container)).toEqual(['b', 'c', 'd']);
  fireEvent.click(card('c'), { ctrlKey: true });
  expect(selected(ui.container)).toEqual(['b', 'd']);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(card('a'));
  expect(selected(ui.container)).toEqual([]);
  expect(open).toHaveBeenCalledWith('a');
});

test('modifier clicks on card actions select instead of executing them; plain actions still work', () => {
  const action = jest.fn(), ui = render(<Fixture action={action} />);
  const button = ui.container.querySelector('[data-card=a] button')!;
  fireEvent.click(button, { ctrlKey: true });
  expect(selected(ui.container)).toEqual(['a']);
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(action).toHaveBeenCalledWith('a');
});

test('blank drag selects intersecting cards, suppresses its click, and Ctrl drag adds to selection', () => {
  const open = jest.fn(), ui = render(<Fixture open={open} />), view = ui.getByTestId('viewport');
  const drag = (ctrlKey = false) => {
    fireEvent.mouseDown(view, { button: 0, clientX: 5, clientY: 5, ctrlKey });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 130, clientY: 205 });
    expect(ui.container.querySelector('[data-library-selection-box]')).not.toBeNull();
    fireEvent.mouseUp(window);
    fireEvent.click(ui.container.querySelector('[data-card=a]')!);
  };
  drag();
  expect(selected(ui.container)).toEqual(['a', 'b']);
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(view);
  fireEvent.click(ui.container.querySelector('[data-card=d]')!, { ctrlKey: true });
  drag(true);
  expect(selected(ui.container)).toEqual(['a', 'b', 'd']);
});

test('Escape cancels the box and clears selection; filtering and tab changes also clear it', () => {
  const ui = render(<Fixture />), view = ui.getByTestId('viewport');
  fireEvent.click(ui.container.querySelector('[data-card=a]')!, { ctrlKey: true });
  expect(layers.at(-1)!.opts.escape).toBe('close');
  appState.dialogs.push({} as any);
  expect(layers.at(-1)!.opts.escape).toBe('skip');
  act(escape);
  expect(selected(ui.container)).toEqual(['a']);
  appState.dialogs.length = 0;
  act(escape);
  expect(selected(ui.container)).toEqual([]);
  fireEvent.mouseDown(view, { button: 0, clientX: 5, clientY: 5 });
  fireEvent.mouseMove(window, { buttons: 1, clientX: 130, clientY: 205 });
  act(escape);
  fireEvent.mouseUp(window);
  expect(ui.container.querySelector('[data-library-selection-box]')).toBeNull();
  expect(selected(ui.container)).toEqual([]);
  fireEvent.click(ui.container.querySelector('[data-card=a]')!, { ctrlKey: true });
  fireEvent.click(ui.container.querySelector('[data-card=a]')!, { ctrlKey: true });
  ui.rerender(<Fixture scope="filtered" order={['c', 'd']} />);
  expect(selected(ui.container)).toEqual([]);
  fireEvent.click(ui.container.querySelector('[data-card=c]')!, { ctrlKey: true });
  ui.rerender(<Fixture active={false} />);
  expect(selected(ui.container)).toEqual([]);
});

test('dragging selected cards still uses the shared group reorder preview', () => {
  const commit = jest.fn(), ui = render(<Fixture commit={commit} />);
  const a = ui.container.querySelector('[data-card=a]')!, b = ui.container.querySelector('[data-card=b]')!, d = ui.container.querySelector('[data-card=d]')!;
  fireEvent.click(a, { ctrlKey: true }); fireEvent.click(b, { ctrlKey: true });
  const previous = document.elementFromPoint; document.elementFromPoint = () => d;
  try {
    fireEvent.mouseDown(a, { button: 0, clientX: 30, clientY: 30 });
    fireEvent.mouseMove(window, { buttons: 1, clientX: 30, clientY: 330 });
    expect(document.querySelector('[data-reorder-count]')?.textContent).toBe('2');
    expect(ui.container.querySelector('[data-library-selection-box]')).toBeNull();
    fireEvent.mouseUp(window, { clientX: 30, clientY: 330 });
    expect(commit).toHaveBeenCalledWith('a', 'd', ['a', 'b']);
  } finally { document.elementFromPoint = previous; }
});
