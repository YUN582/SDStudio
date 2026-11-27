import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const extract = jest.fn();
const appendImage = jest.fn(async (..._args: any[]) => {});
const createI2I = jest.fn(async (..._args: any[]): Promise<any> => undefined);
jest.mock('../importedImageActions', () => ({ appendImportedImage: (...args: any[]) => appendImage(...args), createImportedI2I: (...args: any[]) => createI2I(...args) }));
jest.mock('../referenceDefaults', () => ({ referenceDefaultsFor: () => ({ strength: 0.6, fidelity: 1, referenceType: 'character' }) }));
jest.mock('../../componenets/useGlobalModelVersion', () => ({ useGlobalModelVersion: () => 'v4.5' }));
jest.mock('../../componenets/FloatView', () => ({ FloatView: ({ children }: any) => <div>{children}</div> }));
jest.mock('../../componenets/InPaintEditor', () => ({ __esModule: true, default: ({ onConfirm }: any) => <div><span>I2I editor fixture</span><button onClick={onConfirm}>편집 마치기</button></div> }));

const close = jest.fn();
const record = { preset: jest.fn(), shared: jest.fn(), scene: jest.fn(), presetAdded: jest.fn(), commit: jest.fn() };
const confirmAsync = jest.fn(async () => true);
const state: any = { curSession: undefined, confirmAsync, incrementModalOverlay: jest.fn(), decrementModalOverlay: jest.fn(), pushMessage: jest.fn(), pushDialog: jest.fn() };
jest.mock('../AppService', () => ({ appState: state }));
jest.mock('..', () => ({ isMobile: false, backend: {}, sessionService: {}, workFlowService: {}, imageService: {}, globalPresetService: {} }));
jest.mock('../util', () => ({ extractPromptDataFromBase64: (...args: any[]) => extract(...args) }));
jest.mock('../../componenets/BrushTool', () => ({ base64ToDataUri: (s: string) => 'data:image/png;base64,' + s }));
jest.mock('../../componenets/SceneEditor', () => ({ PromptHighlighter: ({ text }: { text: string }) => <div>{text}</div> }));
jest.mock('../BackStackService', () => ({ backStackService: { push: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock('../imageStateUndo', () => ({ beginMetaApplyRecord: () => record }));
jest.mock('../undoService', () => ({ undoService: { canRecord: () => false }, UNDO_TEXT: {} }));
import { ExternalImageView } from '../../componenets/ExternalImageView';
import { planSelectedPromptImport } from '../sdstudioPromptImport';
import { globalPresetService, workFlowService } from '..';

const source: any = { schemaVersion: 1, workflowType: 'SDImageGen', frontPrompt: 'new front', extraPrompt: 'new extra', middlePrompt: 'new middle', backPrompt: 'new back' };
let preset: any, session: any, scene: any, theme: HTMLElement;
beforeEach(() => {
  jest.clearAllMocks();
  preset = { name: 'keep', frontPrompt: 'old front', backPrompt: 'old back', uc: 'old uc' };
  scene = { name: 'test', type: 'scene', slots: [[{ prompt: 'old middle', enabled: true }]] };
  session = { selectedWorkflow: { workflowType: 'SDImageGen', presetName: 'keep' }, presets: new Map([['SDImageGen', [preset]]]), presetShareds: new Map(), extraPrompt: 'old extra', addPreset: jest.fn() };
  workFlowService.buildPreset = jest.fn((type: string) => ({ type, frontPrompt: '', backPrompt: '', uc: '' })) as any;
  globalPresetService.addFromPresetAndImage = jest.fn(async () => ({ name: 'saved global' })) as any;
  state.curSession = session;
  extract.mockResolvedValue({ prompt: 'merged prompt', uc: 'new uc', characterPrompts: [], vibes: [], characterReferences: [], seed: 123,
    sdstudioMetadata: { promptSource: source }, resolution: { width: 832, height: 1216 } });
  theme = document.createElement('div');theme.setAttribute('data-app-theme-root', '');document.body.appendChild(theme);
});
afterEach(() => theme.remove());

async function open() {
  const clipped = document.createElement('div');clipped.style.transform = 'translateX(0)';clipped.style.overflow = 'hidden';theme.appendChild(clipped);
  render(<ExternalImageView image="fixture" onClose={close} scene={scene} />, { container: clipped });
  await screen.findByLabelText('적용할 프리셋');
  fireEvent.change(screen.getByLabelText('적용할 프리셋'), { target: { value: 'current' } });
  return clipped;
}
function selectOnly(name: string) {
  document.querySelectorAll<HTMLInputElement>('[data-metadata-options] input[type=checkbox]').forEach(input => {
    const desired = input.closest('label')!.textContent!.trim() === name;
    if (!input.disabled && input.checked !== desired) fireEvent.click(input);
  });
}

test('portals above the clipped main region with the shared full-screen blurred backdrop and top-only checkboxes', async () => {
  const clipped = await open();
  expect(clipped.querySelector('[data-metadata-import]')).toBeNull();
  expect(theme.querySelector('[data-metadata-import]')).toBeTruthy();
  const frame = document.querySelector('[data-modal-size=xl]')!;
  expect((frame as HTMLElement).style.height).toBe('92vh');
  expect((frame.parentElement as HTMLElement).style.backdropFilter).toBe('blur(8px)');
  expect(frame.parentElement!.className).toContain('fixed inset-0');
  expect(document.querySelectorAll('[data-metadata-options] input[type=checkbox]').length).toBe(11);
  expect(screen.queryByLabelText('추가(프로젝트) 프롬프트')).toBeNull();
  expect(document.querySelector('[data-metadata-preview] input[type=checkbox]')).toBeNull();
  fireEvent.click(screen.getByLabelText('닫기'));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

test.each(['상위 프롬프트', '하위 프롬프트', '중간 프롬프트'])('applies only %s and leaves other sections untouched', async name => {
  await open();selectOnly(name);
  fireEvent.click(screen.getByRole('button', { name: '적용' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(preset.frontPrompt).toBe(name === '상위 프롬프트' ? 'new front' : 'old front');
  expect(preset.backPrompt).toBe(name === '하위 프롬프트' ? 'new back' : 'old back');
  expect(scene.slots[0][0].prompt).toBe(name === '중간 프롬프트' ? 'new middle' : 'old middle');
  expect(session.extraPrompt).toBe(name === '중간 프롬프트' ? 'new extra' : 'old extra');expect(preset.uc).toBe('old uc');
  expect(record.commit).toHaveBeenCalledTimes(1);
  expect(confirmAsync).not.toHaveBeenCalled();
});

test('allows copying the metadata body and groups seed and resolution with parameters', async () => {
  await open();
  const preview = document.querySelector('[data-metadata-preview]')!;
  expect(preview.hasAttribute('data-selectable-text')).toBe(true);
  expect(preview.getAttribute('tabindex')).toBe('0');
  const parameters = document.querySelector('[data-metadata-parameters]')!;
  expect(parameters.contains(screen.getByText('123'))).toBe(true);
  expect(parameters.contains(screen.getByText('832 × 1216'))).toBe(true);
  expect(document.querySelectorAll('[data-metadata-resolution]')).toHaveLength(1);
});

test('external merged prompts do not pretend to have separate source sections', async () => {
  extract.mockResolvedValue({ prompt: 'merged prompt', uc: '', characterPrompts: [], vibes: [], characterReferences: [] });
  await open();
  expect((screen.getByLabelText('중간 프롬프트') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('하위 프롬프트') as HTMLInputElement).disabled).toBe(true);
  selectOnly('통합 프롬프트');fireEvent.click(screen.getByRole('button', { name: '적용' }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(preset.frontPrompt).toBe('merged prompt');expect(preset.backPrompt).toBe('old back');
});

test('closing without applying leaves all prompt sections intact', async () => {
  await open();selectOnly('중간 프롬프트');fireEvent.click(screen.getByLabelText('닫기'));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(record.commit).not.toHaveBeenCalled();expect(confirmAsync).not.toHaveBeenCalled();
  expect(preset.frontPrompt).toBe('old front');expect(preset.backPrompt).toBe('old back');expect(scene.slots[0][0].prompt).toBe('old middle');
});

test('imports to a new project preset directly without overwriting the existing preset', async () => {
  await open();
  fireEvent.change(screen.getByLabelText('적용할 프리셋'), { target: { value: 'new-normal' } });
  selectOnly('중간 프롬프트');fireEvent.click(screen.getByRole('button', { name: '적용' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(session.addPreset).toHaveBeenCalledTimes(1);
  expect(session.selectedWorkflow).toEqual({ workflowType: 'SDImageGen', presetName: 'external image' });
  expect(session.extraPrompt).toBe('new extra');expect(scene.slots[0][0].prompt).toBe('new middle');
  expect(preset.frontPrompt).toBe('old front');expect(preset.backPrompt).toBe('old back');
  expect(confirmAsync).not.toHaveBeenCalled();expect(record.commit).toHaveBeenCalledTimes(1);
});

test('imports a global preset without a blocking confirmation or success dialog', async () => {
  await open();
  fireEvent.change(screen.getByLabelText('적용할 프리셋'), { target: { value: 'new-global' } });
  selectOnly('상위 프롬프트');fireEvent.click(screen.getByRole('button', { name: '적용' }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(globalPresetService.addFromPresetAndImage).toHaveBeenCalledWith(
    expect.objectContaining({ frontPrompt: 'new front' }), 'fixture', 'external image',
  );
  expect(state.pushMessage).toHaveBeenCalledWith('"saved global" 프리셋을 글로벌로 복사했습니다.');
  expect(state.pushDialog).not.toHaveBeenCalled();expect(confirmAsync).not.toHaveBeenCalled();
  expect(session.addPreset).not.toHaveBeenCalled();expect(session.extraPrompt).toBe('old extra');
  expect(scene.slots[0][0].prompt).toBe('old middle');expect(preset.frontPrompt).toBe('old front');
});

test('section masks preserve source text and handle folded destinations and selected empty fields', () => {
  const selected = { front: false, extra: false, middle: true, back: false };
  const opts = { targetType: 'SDImageGen', placeExtra: true, middle: 'fold' } as const;
  expect(planSelectedPromptImport('merged', source, opts, selected)).toEqual({ split: true, backPrompt: 'new middle' });
  expect(planSelectedPromptImport('merged', source, { ...opts, placeExtra: false }, { ...selected, middle: false, extra: true }))
    .toEqual({ split: true, frontPrompt: 'new extra' });
  expect(planSelectedPromptImport('merged', { ...source, backPrompt: '' }, opts, { ...selected, middle: false, back: true }))
    .toEqual({ split: true, backPrompt: '' });
  expect(source.frontPrompt).toBe('new front');expect(source.middlePrompt).toBe('new middle');
});

test('finishes loading when the image has no generation metadata', async () => {
  extract.mockResolvedValue(undefined);
  render(<ExternalImageView image="plain-image" onClose={close} />);
  await screen.findByText('이 이미지에는 불러올 생성 정보가 없습니다.');
  expect(screen.queryByText('메타데이터를 추출하는 중...')).toBeNull();
  expect((screen.getByRole('button', { name: '적용' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector('[data-metadata-image] img')).toBeTruthy();
  expect(document.querySelector('[data-metadata-generation]')).toBeNull();
});

test('places a full-width image before import options and merges generation facts beside prompts', async () => {
  extract.mockResolvedValue({
    prompt: 'positive prompt', uc: 'negative prompt', characterPrompts: [], vibes: [], characterReferences: [],
    seed: 321, steps: 20, promptGuidance: 5, cfgRescale: 0.6, sampling: 'k_euler_ancestral', noiseSchedule: 'karras',
    naiDiagnostics: { model: 'V5 Full', modelHash: 'MODEL_HASH', requestType: 'PromptGenerateRequest', metadataVersion: 1, transparentBackground: true },
    resolution: { width: 1024, height: 1024 },
  });
  await open();
  const image = document.querySelector('[data-metadata-image]')!;
  const options = document.querySelector('[data-metadata-options]')!;
  const details = document.querySelector('[data-metadata-preview]')!;
  expect(image.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(options.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const info = screen.getByRole('complementary', { name: '생성 정보' });
  expect(details.contains(info)).toBe(true);
  expect(within(info).getByText('V5 Full')).toBeTruthy();
  expect(within(info).getByText('MODEL_HASH')).toBeTruthy();
  expect(within(info).getByText('스텝')).toBeTruthy();
  expect(within(info).getByText('20')).toBeTruthy();
  expect(within(info).getByText('321')).toBeTruthy();
  expect(within(info).getByText('1024 × 1024')).toBeTruthy();
  expect(within(info).getAllByText('노이즈 스케줄')).toHaveLength(1);
  expect(screen.queryByText('NAI 생성 정보')).toBeNull();
  expect(document.querySelector('[data-metadata-prompts] [data-metadata-parameters]')).toBeNull();
});

test('ignores late metadata from the previous image', async () => {
  let finishOld!: (value: any) => void;
  extract.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const view = render(<ExternalImageView image="old-image" onClose={close} />);
  extract.mockResolvedValueOnce(undefined);
  view.rerender(<ExternalImageView image="new-image" onClose={close} />);
  await screen.findByText('이 이미지에는 불러올 생성 정보가 없습니다.');
  finishOld({ prompt: 'stale prompt', uc: '', characterPrompts: [] });
  await waitFor(() => expect(screen.queryByText('stale prompt')).toBeNull());
  expect(screen.queryByLabelText('적용할 프리셋')).toBeNull();
});

test('shows a terminal failure instead of an endless loading message', async () => {
  extract.mockRejectedValue(new Error('broken image'));
  render(<ExternalImageView image="broken-image" onClose={close} />);
  await screen.findByRole('alert');
  expect(screen.queryByText('메타데이터를 추출하는 중...')).toBeNull();
});

test('uses the image pixels as a vibe without requiring or applying metadata', async () => {
  extract.mockResolvedValue(undefined);
  render(<ExternalImageView image="plain-image" onClose={close} />);
  await screen.findByText('이 이미지에는 불러올 생성 정보가 없습니다.');
  fireEvent.click(screen.getByRole('button', { name: '바이브로 추가' }));
  await waitFor(() => expect(appendImage).toHaveBeenCalledWith(session, 'plain-image', 'vibe', 'v4.5', expect.any(Object)));
  expect((screen.getByRole('button', { name: '바이브 추가됨' }) as HTMLButtonElement).disabled).toBe(true);
  expect(preset.frontPrompt).toBe('old front');
  expect(close).not.toHaveBeenCalled();
});

test('adds a reference and opens I2I while metadata is absent', async () => {
  extract.mockResolvedValue(undefined);
  createI2I.mockResolvedValueOnce({ name: 'imported' });
  render(<ExternalImageView image="plain-image" onClose={close} />);
  await screen.findByText('이 이미지에는 불러올 생성 정보가 없습니다.');
  fireEvent.click(screen.getByRole('button', { name: '레퍼런스로 추가' }));
  await waitFor(() => expect(appendImage).toHaveBeenCalledWith(session, 'plain-image', 'reference', 'v4.5', expect.any(Object)));
  await waitFor(() => expect((screen.getByRole('button', { name: 'I2I 편집' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'I2I 편집' }));
  await screen.findByText('I2I editor fixture');
  expect(createI2I).toHaveBeenCalledWith(session, 'plain-image', undefined, { scene: undefined, path: undefined });
  fireEvent.click(screen.getByRole('button', { name: '편집 마치기' }));
  await screen.findByText('이 이미지에는 불러올 생성 정보가 없습니다.');
  expect(close).not.toHaveBeenCalled();
});
