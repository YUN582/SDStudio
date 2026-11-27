import React, { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
const images: any = new EventTarget();
const queue = new EventTarget();
const state: any = { dialogs: [], modalOverlayCount: 0, configScreenOpen: false };
let menuOpen = false;
jest.mock('..', () => ({ imageService: images, taskQueueService: queue }));
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('../../componenets/contextMenuBack', () => ({ hasOpenContextMenu: () => menuOpen }));
import InpaintResultPreview from '../../componenets/InpaintResultPreview';

const session: any = { id: 'project-a', name: 'project' };
const scene: any = { name: 'edit', type: 'inpaint', preset: { image: 'original', mask: 'mask-file' } };
const mounts = jest.fn(), unmounts = jest.fn(), mode = jest.fn();
let names: string[];
function Canvas() {
  const [drawing, setDrawing] = useState('kept drawing');
  useEffect(() => { mounts(); return () => { unmounts(); }; }, []);
  return <input aria-label="drawing fixture" value={drawing} onChange={event => setDrawing(event.target.value)} />;
}
function View({ active = true }: { active?: boolean }) {
  return <InpaintResultPreview session={session} scene={scene} inputImage="original-pixels" active={active} onModeChange={mode}><Canvas /></InpaintResultPreview>;
}
const result = () => document.querySelector('[data-inpaint-results] img') as HTMLImageElement;
async function added(name: string, owner = scene, project = session) {
  if (owner === scene && project === session) names.push(name);
  await act(async () => {
    images.dispatchEvent(new CustomEvent('image-added', { detail: { session: project, sceneType: 'inpaint', sceneName: owner.name } }));
  });
}
beforeEach(() => {
  jest.clearAllMocks(); menuOpen = false;
  state.dialogs = []; state.modalOverlayCount = 0;
  names = ['200.png', '100.png'];
  images.getOutputs = jest.fn(() => names);
  images.getOutputDir = jest.fn(() => '/outputs/edit');
  images.refresh = jest.fn(async () => {});
  images.fetchImage = jest.fn(async path => 'pixels:' + path);
});

test('new results open on the right; returning to the original preserves the mounted canvas and drawing', async () => {
  render(<View />);
  await screen.findByRole('button', { name: '생성 결과 보기' });
  expect(document.querySelector('[data-inpaint-results]')).toBeNull();
  const canvas = screen.getByLabelText('drawing fixture');
  fireEvent.change(canvas, { target: { value: 'new brush stroke' } });
  canvas.blur();
  await added('300.png');
  await waitFor(() => expect(result()?.src).toContain('300.png'));
  expect(mode).toHaveBeenLastCalledWith(true);
  expect(document.querySelector('[data-result-hidden]')).not.toBeNull();
  expect(screen.getByRole('button', { name: '원본 이미지 편집' }).querySelector('img')?.getAttribute('src')).toBe('original-pixels');
  fireEvent.click(screen.getByRole('button', { name: '원본 이미지 편집' }));
  expect(document.querySelector('[data-inpaint-results]')).toBeNull();
  expect(screen.getByLabelText('drawing fixture')).toBe(canvas);
  expect((canvas as HTMLInputElement).value).toBe('new brush stroke');
  expect(mounts).toHaveBeenCalledTimes(1); expect(unmounts).not.toHaveBeenCalled();
  // Finishing more queued images must not interrupt resumed editing.
  await added('400.png');
  expect(document.querySelector('[data-inpaint-results]')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '생성 결과 보기' }));
  await waitFor(() => expect(result()?.src).toContain('400.png'));
  expect(scene.preset).toEqual({ image: 'original', mask: 'mask-file' });
});

test('arrow buttons and keys browse chronologically, with newer results to the right', async () => {
  const view = render(<View />);
  await added('300.png');
  await waitFor(() => expect(result()?.src).toContain('300.png'));
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  await waitFor(() => expect(result()?.src).toContain('200.png'));
  fireEvent.click(screen.getByRole('button', { name: '이전 결과 이미지' }));
  await waitFor(() => expect(result()?.src).toContain('100.png'));
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  await waitFor(() => expect(result()?.src).toContain('200.png'));
  view.rerender(<View active={false} />);
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  expect(result().src).toContain('200.png');
});

test('does not intercept arrows in text fields, dialogs, context menus or metadata windows', async () => {
  render(<View />); await added('300.png');
  await waitFor(() => expect(result()?.src).toContain('300.png'));
  const input = document.createElement('input'); document.body.appendChild(input); input.focus();
  fireEvent.keyDown(window, { key: 'ArrowLeft' });
  expect(result().src).toContain('300.png'); input.remove();
  for (const block of ['dialog', 'menu', 'overlay']) {
    state.dialogs = block === 'dialog' ? [{}] : [];
    menuOpen = block === 'menu'; state.modalOverlayCount = block === 'overlay' ? 1 : 0;
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(result().src).toContain('300.png');
  }
});

test('ignores generations in other works and projects', async () => {
  render(<View />);
  await act(async () => {});
  await added('300.png', { name: 'different' });
  await added('400.png', scene, { id: 'other-project', name: session.name });
  expect(document.querySelector('[data-inpaint-results]')).toBeNull();
});

test('rescans delegated completions and refreshes deleted result choices', async () => {
  render(<View />); await act(async () => {});
  names.push('300.png');
  await act(async () => { queue.dispatchEvent(new Event('complete')); });
  await waitFor(() => expect(result()?.src).toContain('300.png'));
  names = names.filter(name => name !== '300.png');
  await act(async () => { images.dispatchEvent(new CustomEvent('updated', { detail: { session, scene } })); });
  await waitFor(() => expect(result()?.src).toContain('200.png'));
  names = [];
  await act(async () => { images.dispatchEvent(new CustomEvent('updated', { detail: { session, scene } })); });
  expect(document.querySelector('[data-inpaint-results]')).toBeNull();
});

test('late image reads cannot replace the most recent result', async () => {
  render(<View />); await act(async () => {});
  let resolveOld!: (image: string) => void;
  images.fetchImage.mockImplementation((path: string) => path.endsWith('300.png')
    ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve('pixels:' + path));
  await added('300.png'); await added('400.png');
  await waitFor(() => expect(result()?.src).toContain('400.png'));
  await act(async () => { resolveOld('old-result'); });
  expect(result().src).toContain('400.png');
});

test('image read failures end loading and can be retried', async () => {
  render(<View />); await act(async () => {});
  images.fetchImage.mockRejectedValueOnce(new Error('locked'));
  await added('300.png');
  await screen.findByText('결과 이미지를 불러오지 못했습니다.');
  expect(document.querySelector('[data-inpaint-results]')?.getAttribute('aria-busy')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
  await waitFor(() => expect(result()?.src).toContain('300.png'));
});
