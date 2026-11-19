import { useState } from 'react';
import { FaCheck, FaChevronDown, FaRandom } from 'react-icons/fa';
import { Resolution, resolutionMap } from '../backends/imageGen';
import { appState } from '../models/AppService';
import { useBackLayer } from '../models/BackStackService';
import { quickResolutionKey, type QuickResolutionSettings } from '../models/quickResolution';
import {
  customResolutionAdjustedText,
  parseCustomResolution,
} from '../models/deleteFlowRules';

// 해상도 표시 + 위로 열리는 드롭다운 피커 (2026-07-18, 퀵 생성 도입분을 공용 추출)
//  - 프리셋 목록: 씬 편집기와 동일하게 small 계열 제외, custom 은 직접 입력칸이 대신
//  - large/wallpaper 선택 시 Anlas 소모 confirm (씬 편집기 관례)
//  - 직접 입력은 64px 배수로 올림 보정
// 사용처: 퀵 생성 하단(QuickModeTab) / 프리셋 패널 새 씬 해상도 행(PreSetEdtior)

export interface ResolutionValue {
  resolution: string;
  width?: number;
  height?: number;
}

// 표시용 크기 계산 — 값이 없으면 portrait 기본값
export const resolutionValueToSize = (
  value: ResolutionValue | undefined,
): { width: number; height: number } => {
  if (!value) return resolutionMap.portrait;
  if (value.resolution === 'custom')
    return { width: value.width ?? 0, height: value.height ?? 0 };
  return (
    resolutionMap[value.resolution as Resolution] ?? resolutionMap.portrait
  );
};

interface ResolutionPickerProps {
  value: ResolutionValue | undefined;
  disabled?: boolean;
  // 확정된 변경만 전달한다 (Anlas confirm·64px 보정을 통과한 값)
  onApply: (v: ResolutionValue) => void;
  className?: string; // relative 래퍼에 추가 (예: flex-none)
  triggerClassName?: string; // 트리거 버튼에 추가 (예: h-full)
  random?: QuickResolutionSettings & { onChange: (settings: QuickResolutionSettings) => void };
}

export const ResolutionPicker = ({
  value,
  disabled,
  onApply,
  className,
  triggerClassName,
  random,
}: ResolutionPickerProps) => {
  const [open, setOpen] = useState(false);
  // Esc·Android 뒤로 가기로 목록만 닫기(닫기 관문, 2026-10-03 U1·X6)
  useBackLayer(open, () => setOpen(false));
  const [wText, setWText] = useState('');
  const [hText, setHText] = useState('');
  const cur = resolutionValueToSize(value);

  const openPanel = () => {
    // 패널을 열 때 직접 입력칸을 현재 값으로 채운다
    setWText(String(cur.width || ''));
    setHText(String(cur.height || ''));
    setOpen(true);
  };

  const selectPreset = (key: Resolution) => {
    if (!random?.enabled) setOpen(false);
    const apply = () => random?.enabled ? toggleChoice({ resolution: key }) : onApply({ resolution: key });
    const selected = random?.choices.some(choice => quickResolutionKey(choice) === quickResolutionKey({ resolution: key }));
    // Anlas 소모 해상도는 씬 편집기와 동일하게 확인을 거친다
    if ((!random?.enabled || !selected) && (key.startsWith('large') || key.startsWith('wallpaper'))) {
      appState.pushDialog({
        type: 'confirm',
        text: '해당 해상도는 Anlas를 소모합니다 (유료임) 계속하시겠습니까?',
        callback: apply,
      });
    } else {
      apply();
    }
  };

  const toggleChoice = (choice: ResolutionValue) => {
    if (!random) return;
    const key = quickResolutionKey(choice);
    const selected = random.choices.some(value => quickResolutionKey(value) === key);
    if (selected && random.choices.length === 1) {
      appState.pushMessage('랜덤 크기는 하나 이상 선택해주세요.');
      return;
    }
    random.onChange({ enabled: true, choices: selected
      ? random.choices.filter(value => quickResolutionKey(value) !== key)
      : [...random.choices, choice] });
  };

  const applyCustom = () => {
    // 검증·64px 배수 올림 보정은 공용 규칙(씬 편집기·변형 씬·대량 작업 커스텀 해상도와 같음, X15c)
    const parsed = parseCustomResolution(wText, hText);
    if (!parsed.ok) {
      appState.pushMessage(parsed.message);
      return;
    }
    const custom = { resolution: 'custom', width: parsed.width, height: parsed.height };
    if (random?.enabled) {
      if (!random.choices.some(value => quickResolutionKey(value) === quickResolutionKey(custom))) {
        random.onChange({ enabled: true, choices: [...random.choices, custom] });
      }
    } else {
      setOpen(false);
      onApply(custom);
    }
    if (parsed.adjusted) {
      appState.pushMessage(customResolutionAdjustedText(parsed.width, parsed.height));
    }
  };

  // 프리셋 목록: 씬 편집기와 동일하게 small 계열 제외, custom 은 입력칸이 대신한다
  const presetOptions = Object.entries(resolutionMap).filter(
    ([key]) => !key.startsWith('small') && key !== 'custom',
  ) as [Resolution, { width: number; height: number }][];

  return (
    <div className={'relative ' + (className ?? '')}>
      <button
        className={
          'flex items-center gap-1.5 px-3 rounded-lg border line-color bg-[var(--c-input-bg)] text-body text-sm whitespace-nowrap select-none hover:brightness-95 ' +
          (triggerClassName ?? 'py-1.5')
        }
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
      >
        {random?.enabled ? <><FaRandom size={12} />랜덤 {random.choices.length}개</> : `${cur.width}x${cur.height}`}
        <FaChevronDown
          size={10}
          className={
            'text-faint transition-transform' + (open ? ' rotate-180' : '')
          }
        />
      </button>
      {open && (
        <>
          {/* 투명 백드롭 — 바깥 클릭 닫기 (퀵 메뉴 PC 팝오버 관례) */}
          <div
            className="fixed inset-0 z-[var(--z-widget)]"
            onClick={() => setOpen(false)}
          />
          <div className={'absolute bottom-full right-0 mb-2 z-[var(--z-widget)] max-w-[calc(100vw-1.5rem)] max-h-[70vh] overflow-y-auto rounded-lg border line-color bg-[var(--c-surface-2)] shadow-xl p-1.5 ' + (random ? 'w-64' : 'w-56')}>
            {random && <div className="px-2.5 py-2 mb-1">
              <label className="flex items-center justify-between gap-3 text-sm text-default cursor-pointer">
                랜덤 크기
                <input type="checkbox" checked={random.enabled} onChange={event => random.onChange({ enabled: event.target.checked, choices: random.choices })} />
              </label>
              <p className="text-xs text-muted mt-1 mb-0">{random.enabled ? '이미지마다 크기를 새로 뽑습니다.' : '선택한 크기로 계속 생성합니다.'}</p>
            </div>}
            {presetOptions.map(([key, size]) => {
              const active = random?.enabled
                ? random.choices.some(choice => quickResolutionKey(choice) === quickResolutionKey({ resolution: key }))
                : value?.resolution === key || (!value && key === 'portrait');
              return (
                <button
                  key={key}
                  aria-pressed={active}
                  className={
                    'btn-ghost w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-sm text-left ' +
                    (active ? 'font-semibold text-sky-500' : 'text-default')
                  }
                  onClick={() => selectPreset(key)}
                >
                  <span className="flex items-center gap-2">
                    {random?.enabled && <FaCheck size={12} className={active ? '' : 'invisible'} />}
                    {size.width}x{size.height}
                  </span>
                  {(key.startsWith('large') || key.startsWith('wallpaper')) && (
                    <span className="text-[11px] text-amber-700 dark:text-amber-500">Anlas</span>
                  )}
                </button>
              );
            })}
            {random?.enabled && random.choices.filter(choice => choice.resolution === 'custom').map(choice => (
              <button key={quickResolutionKey(choice)} aria-pressed="true" className="btn-ghost w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-semibold text-sky-500" onClick={() => toggleChoice(choice)}>
                <FaCheck size={12} />{choice.width}x{choice.height}<span className="ml-auto text-xs text-muted">직접 입력</span>
              </button>
            ))}
            {/* 직접 입력 (64px 배수 자동 보정) */}
            <div className="border-t line-color mt-1.5 pt-1.5 px-1 pb-0.5">
              <div className="flex items-center gap-1.5">
                <input
                  className="w-0 flex-1 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  inputMode="numeric"
                  placeholder="너비"
                  aria-label="이미지 너비"
                  value={wText}
                  onChange={(e) => setWText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
                />
                <span className="text-faint text-xs">x</span>
                <input
                  className="w-0 flex-1 px-2 py-1 rounded border line-color bg-[var(--c-input-bg)] text-default text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                  inputMode="numeric"
                  placeholder="높이"
                  aria-label="이미지 높이"
                  value={hText}
                  onChange={(e) => setHText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyCustom()}
                />
                <button
                  className="round-button back-sky text-sm py-1 px-2.5 flex-none"
                  onClick={applyCustom}
                >
                  {random?.enabled ? '추가' : '적용'}
                </button>
              </div>
              <div className="text-[11px] text-muted mt-1 px-0.5">
                직접 입력 — 64px 배수로 자동 보정
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
