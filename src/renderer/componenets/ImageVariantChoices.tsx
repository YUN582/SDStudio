import { workFlowService } from '../models';
import { oneTimeFlows } from '../models/workflows/OneTimeFlows';
export type QuickVariantFlow = (typeof oneTimeFlows)[number];
interface Props {
  path: string;
  busy: boolean;
  onWork: (type: string) => void;
  onQuick: (flow: QuickVariantFlow) => void;
  onClose: () => void;
}
export function ImageVariantChoices({
  path,
  busy,
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
  return (
    <section
      className="sds-variant-choices"
      aria-label="이미지 변형 방법"
      aria-busy={busy}
    >
      <div className="sds-variant-heading">
        <div className="sds-variant-title">
          <h3>이미지 변형</h3>
          <p className="text-sub sds-variant-source" title={path}>
            {path.split('/').pop()}
          </p>
        </div>
        <button
          type="button"
          className="round-button back-gray btn-sm"
          onClick={onClose}
        >
          닫기
        </button>
      </div>
      <div className="sds-variant-section">
        <h4>편집 작업</h4>
        <p className="text-sub">설정을 조절하며 작업합니다.</p>
        <div className="sds-variant-options sds-variant-workflows">
          {workFlowService.i2iFlows.map((flow) => (
            <button
              type="button"
              key={flow.getType()}
              data-variant-workflow={flow.getType()}
              className="sds-variant-work"
              disabled={busy}
              onClick={() => onWork(flow.getType())}
            >
              <span className="sds-variant-work-title">
                {flow.getType() === 'SDInpaint'
                  ? '인페인트 · I2I'
                  : flow.def.title}
              </span>
              <span className="text-sub sds-variant-description">
                {descriptions[flow.getType()] || '설정을 열어 이미지 변형'}
              </span>
            </button>
          ))}
        </div>
      </div>
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
    </section>
  );
}
