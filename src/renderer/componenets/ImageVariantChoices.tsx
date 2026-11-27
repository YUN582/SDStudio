import { FaSearchPlus } from 'react-icons/fa';
import { workFlowService } from '../models';
import { oneTimeFlows } from '../models/workflows/OneTimeFlows';
import { ActionIcon } from './ActionIcon';
import ModalOverlay, { DIALOG_SECONDARY_BTN } from './ModalOverlay';

export type QuickVariantFlow = (typeof oneTimeFlows)[number];

export interface VariantUpscaleOption {
  label: string;
  title: string;
  disabled: boolean;
  onRun: () => void;
}

interface Props {
  isOpen: boolean;
  path: string;
  busy: boolean;
  upscale?: VariantUpscaleOption;
  onWork: (type: string) => void;
  onQuick: (flow: QuickVariantFlow) => void;
  onClose: () => void;
}

export function ImageVariantChoices({
  isOpen,
  path,
  busy,
  upscale,
  onWork,
  onQuick,
  onClose,
}: Props) {
  const descriptions: Record<string, string> = {
    SDInpaint: '마스크가 없으면 I2I로 생성',
    SDI2I: '강도·노이즈를 직접 설정',
    SDMirror: '좌우 확장·복제 설정',
    Augment: '감정·색칠 등 변형 설정',
  };
  const filename = path.split('/').pop() ?? '';

  return (
    <ModalOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="이미지 변형"
      size="m"
      footer={
        <button
          type="button"
          className={DIALOG_SECONDARY_BTN}
          onClick={onClose}
        >
          취소
        </button>
      }
    >
      <div
        className="sds-variant-choices"
        aria-label="이미지 변형 방법"
        aria-busy={busy}
      >
        {filename && (
          <p className="text-sub sds-variant-source" title={path}>
            {filename}
          </p>
        )}
        <div className="sds-variant-section">
          <h4>편집 작업</h4>
          <p className="text-sub">설정을 조절하며 작업합니다.</p>
          <div className="sds-variant-options sds-variant-workflows">
            {workFlowService.i2iFlows.map((flow) => {
              const isInpaint = flow.getType() === 'SDInpaint';
              return (
                <button
                  type="button"
                  key={flow.getType()}
                  data-variant-workflow={flow.getType()}
                  className={
                    'sds-variant-work' +
                    (isInpaint ? ' sds-variant-work-primary' : '')
                  }
                  disabled={busy}
                  onClick={() => onWork(flow.getType())}
                >
                  <span className="sds-variant-work-title">
                    {isInpaint && <ActionIcon id="inpaint" size={13} />}
                    {isInpaint ? '인페인트 · I2I' : flow.def.title}
                  </span>
                  <span className="text-sub sds-variant-description">
                    {descriptions[flow.getType()] || '설정을 열어 이미지 변형'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {upscale && (
          <div className="sds-variant-section">
            <h4>업스케일</h4>
            <p className="text-sub">가로·세로 2배 · 원본 유지</p>
            <button
              type="button"
              data-variant-upscale=""
              className="sds-variant-work sds-variant-upscale"
              title={upscale.title}
              disabled={busy || upscale.disabled}
              onClick={upscale.onRun}
            >
              <span className="sds-variant-work-title">
                <FaSearchPlus size={13} />
                {upscale.label}
              </span>
              <span className="text-sub sds-variant-description">
                {upscale.title}
              </span>
            </button>
          </div>
        )}
        <div className="sds-variant-section">
          <h4>빠른 변형</h4>
          <p className="text-sub">선택한 변형을 생성 대기열에 추가합니다.</p>
          <div className="sds-variant-options sds-variant-quick">
            {oneTimeFlows.map((flow) => (
              <button
                type="button"
                key={flow.text}
                className="round-button back-gray"
                disabled={busy}
                onClick={() => onQuick(flow)}
              >
                {flow.text}
              </button>
            ))}
          </div>
        </div>
        {busy && (
          <p role="status" className="text-sub">
            처리 중…
          </p>
        )}
      </div>
    </ModalOverlay>
  );
}
