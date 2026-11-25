// 프롬프트 칸(PC) 오른쪽 위 아이콘 세로 쌓기 — 순서 = 크게 편집 → 작가,
// 칸이 낮으면 그 칸만 종전 가로, 모바일 아이콘 줄은 그대로.
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import PromptEditTextArea from '../../componenets/PromptEditTextArea';
import { fitsPromptIconStack } from '../promptEditIcons';

jest.mock('../index', () => ({
  isMobile: false,
  backend: {},
  artistLibraryService: {},
}));
jest.mock('../AppService', () => ({ appState: {} }));
jest.mock('../sceneFieldUndo', () => ({
  holdSceneFieldEdit: jest.fn(() => () => {}),
}));
jest.mock('../promptWeightSpacingFlow', () => ({
  offerWeightSpacing: jest.fn(() => Promise.resolve()),
}));

const SRC = fs.readFileSync(
  path.join(__dirname, '../../componenets/PromptEditTextArea.tsx'),
  'utf8',
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('세로 쌓기 판정', () => {
  test('h-16(64px) 칸은 1em(14px) 아이콘 셋이 들어간다', () => {
    expect(fitsPromptIconStack(64, 14, 3)).toBe(true);
    expect(fitsPromptIconStack(64, 16, 3)).toBe(true);
  });
  test('한 줄 높이(20px) 칸은 둘도 못 쌓는다 → 가로', () => {
    expect(fitsPromptIconStack(20, 14, 2)).toBe(false);
    expect(fitsPromptIconStack(28, 14, 2)).toBe(false);
  });
  test('h-12(48px)는 둘은 들어가고 16px 셋은 넘친다', () => {
    expect(fitsPromptIconStack(48, 16, 2)).toBe(true);
    expect(fitsPromptIconStack(48, 16, 3)).toBe(false);
  });
  test('잴 수 없으면(숨김·측정 전) 기본 세로', () => {
    expect(fitsPromptIconStack(0, 14, 3)).toBe(true);
    expect(fitsPromptIconStack(64, 0, 3)).toBe(true);
  });
});

describe('PC 아이콘 띠', () => {
  test('기존 확대 아이콘만 보이고 중복 인라인 찾기 아이콘은 없다', () => {
    const { container } = render(
      <PromptEditTextArea value="very aesthetic, cat" onChange={jest.fn()} />,
    );
    const box = container.querySelector('[data-prompt-icon-column]')!;
    expect(box.getAttribute('data-prompt-icon-column')).toBe('stack');
    expect(box.className).toContain('flex-col');
    const buttons = Array.from(box.querySelectorAll('button'));
    expect(buttons[0].getAttribute('data-prompt-expand-toggle')).not.toBeNull();
    expect(buttons[0].getAttribute('aria-label')).toBe('크게 편집');
    expect(buttons).toHaveLength(1);
    expect(box.querySelector('[data-prompt-find-toggle]')).toBeNull();
  });

  test('작가 버튼은 확대 다음(세로 = 아이콘 하나, 가로 = 종전 이름 알약)', () => {
    const pc = SRC.slice(SRC.indexOf('ref={iconBoxRef}'));
    const iExpand = pc.indexOf('{expandButton}');
    const iFind = pc.indexOf('data-prompt-find-toggle');
    const iArtist = pc.indexOf('artistStackButton(caretArtist)');
    expect(iExpand).toBeGreaterThan(-1);
    expect(iFind).toBe(-1);
    expect(iArtist).toBeGreaterThan(iExpand);
    expect(pc.slice(iArtist)).toMatch(/: artistButton\(caretArtist, 'mt-1'\)\)\}/);
  });

  test('글자 금지 여백(pr)은 PC 편집기에만', () => {
    const emulated = SRC.slice(
      SRC.indexOf('const EmulatedEditTextArea'),
      SRC.indexOf('const NativeEditTextArea'),
    );
    const native = SRC.slice(
      SRC.indexOf('const NativeEditTextArea'),
      SRC.indexOf('const NativeEditTextArea') + 20000,
    );
    expect(emulated).toContain('pr-[calc(1em+0.5rem)]');
    expect(native).not.toContain('pr-[calc(1em+0.5rem)]');
  });
});

describe('모바일 아이콘 줄 불변', () => {
  test('모바일 분기 = 종전 가로 줄 [작가 알약][크게 편집], 돋보기 없음', () => {
    const m = SRC.match(
      /\{isMobile \? \(\s*\/\/[^\n]*\n\s*<div className="absolute right-0 top-0 z-10 flex items-center gap-1">\s*\{caretArtist && !accessorySlot && artistButton\(caretArtist, 'mt-1'\)\}\s*\{expandButton\}\s*<\/div>\s*\) : \(/,
    );
    expect(m).not.toBeNull();
    // 크게 편집 버튼 자체의 클래스는 종전 그대로(모바일·PC 공용)
    expect(SRC).toContain(
      'className="text-[var(--c-icon-text)] opacity-[0.85] hover:opacity-100 mr-1 mt-1"',
    );
  });
});
