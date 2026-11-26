import { useEffect, useState } from 'react';
import ConfigScreen from './ConfigScreen';
import SessionSelect from './SessionSelect';
import {
  loginService,
  backend,
  taskQueueService,
  imageService,
  isMobile,
  opusUsageService,
  sessionService,
} from '../models';
import { VscChromeMinimize, VscChromeMaximize, VscChromeRestore, VscChromeClose } from 'react-icons/vsc';
import { FaCog, FaCoins } from 'react-icons/fa';
import { appState } from '../models/AppService';
import { resolveLayout } from '../models/layoutTemplates';
import { observer } from 'mobx-react-lite';
import OpusUsageBadge from './OpusUsageBadge';
import { normalizeTokenRotateWarning } from '../models/tokenAutoRotation';
import ModelFamilySwitch from './ModelFamilySwitch';
import Tooltip from './Tooltip';
import { useGlobalModelVersion } from './useGlobalModelVersion';
import { NAI_REFERENCE_ANLAS_PER_IMAGE, referenceAnlasPerImage } from '../backends/genVendors/naiReference';

export const AppToolbarControls = observer(() => {
  const modelVersion = useGlobalModelVersion();
  const costSession = appState.curSession;
  const costWorkflow = costSession?.selectedWorkflow?.workflowType;
  const costReferences = costWorkflow ? costSession?.presetShareds.get(costWorkflow)?.characterReferences : undefined;
  const referenceSpend = loginService.loggedIn ? referenceAnlasPerImage(costReferences, modelVersion) : 0;
  const referenceSpendTitle = referenceSpend ? `캐릭터 레퍼런스 ${referenceSpend / NAI_REFERENCE_ANLAS_PER_IMAGE}장 사용 중 · 이미지 1장마다 ${referenceSpend} Anlas` : undefined;
  // Desktop uses the project command row; mobile keeps the title-row controls.
  const resolved = resolveLayout(appState.uiLayoutTemplate, isMobile);
  // 'sidebar' 템플릿이면 프로젝트 선택기는 좌측 사이드 바가 담당 → 상단바엔 미렌더.
  // 'modern' 템플릿(projectStrip)은 프로젝트 툴바 완전 제거 — 좌측 스트립+드로어가 담당.
  const projectSidebar = resolved.projectSidebar || resolved.projectStrip;
  const [loggedIn, setLoggedIn] = useState(false);
  const [credits, setCredits] = useState(0);
  const [warningPercent, setWarningPercent] = useState(10);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      backend.getConfig().then((config) => {
        if (!cancelled) {
          setWarningPercent(normalizeTokenRotateWarning(config.multiTokenRotateWarningPercent));
        }
      }).catch(() => {});
    };
    load();
    sessionService.addEventListener('config-changed', load);
    return () => { cancelled = true; sessionService.removeEventListener('config-changed', load); };
  }, []);

  // NAI 모델 퀵 전환은 ModelFamilySwitch(모바일 V2 시트 손잡이 줄과 공용, 2026-09-26)

  useEffect(() => {
    let accountRevision = 0;
    const onChange = () => {
      const revision = accountRevision;
      setLoggedIn(loginService.loggedIn);
      if (!loginService.loggedIn) {
        setCredits(0);
        opusUsageService.clear();
        return;
      }
      (async () => {
        try {
          const credits = await backend.getRemainCredits();
          if (revision !== accountRevision) return;
          setCredits(credits);
          opusUsageService.refresh().catch(() => {});
        } catch (e) {
          // 로그인 표기는 ON인데 크레딧 조회가 실패 → 토큰 만료 의심 → 재검증
          // (만료면 OFF로 전환, 네트워크 일시 오류면 상태 유지)
          if (revision === accountRevision) loginService.refresh();
        }
      })();
    };
    const onLoginChange = () => {
      accountRevision++;
      opusUsageService.invalidateAccount();
      onChange();
    };
    onChange();
    loginService.addEventListener('change', onLoginChange);
    taskQueueService.addEventListener('complete', onChange);
    imageService.addEventListener('encode-vibe', onChange);
    return () => {
      accountRevision++;
      loginService.removeEventListener('change', onLoginChange);
      taskQueueService.removeEventListener('complete', onChange);
      imageService.removeEventListener('encode-vibe', onChange);
    };
  }, []);

  const [settings, setSettings] = useState(false);

  // 단축키에서 환경설정 열기 이벤트 수신
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (action === 'open-config') {
        setSettings(true);
      }
    };
    window.addEventListener('shortcut-action', handler);
    return () => window.removeEventListener('shortcut-action', handler);
  }, []);

  // 모바일 기본 툴바의 환경설정 버튼·계정 표기. 모바일은 SessionSelect 의 2줄 배치 슬롯
  // (1줄째 맨 앞=환경설정·계정 표기, 그 뒤 프로젝트 선택)으로, 좁은 PC 창은 기존 인라인 묶음으로 렌더.
  const mobileSettingsButton = (
    <Tooltip content="환경설정">
      <button
        className="icon-button flex-none"
        aria-label="환경설정"
        onClick={() => {
          setSettings(true);
        }}
      >
        <FaCog size={18} />
      </button>
    </Tooltip>
  );
  const mobileAccountBadge = !loggedIn ? (
    <span className="round-tag back-red text-sm !px-2 !py-1">로그인필요</span>
  ) : (
    <OpusUsageBadge credits={credits} warningPercent={warningPercent} inline spend={referenceSpend} />
  );

  return (
    <>
      {!isMobile && <div data-app-toolbar-controls="" className="flex items-center gap-2 flex-none titlebar-no-drag">
        <ModelFamilySwitch />
        <div className="flex items-center gap-2" role="group" aria-label="계정 상태 및 환경설정">
        {!loggedIn ? (
          <span className="account-status-control back-red text-sm">
            {/* 좁은 창(<lg)에서는 모바일과 같은 축약 문구 */}
            <span className="lg:hidden">로그인필요</span>
            <span className="hidden lg:inline">환경설정에서 로그인하세요</span>
          </span>
        ) : (
          <>
            {/* tabular-nums: 잔량이 줄어도 자릿수 폭이 고정돼 출렁이지 않게 */}
            <span className="account-status-control back-yellow tabular-nums text-sm gap-1.5" aria-label={`Anlas ${credits}` + (referenceSpendTitle ? `, ${referenceSpendTitle}` : '')} title={referenceSpendTitle}>
              <FaCoins size={15} aria-hidden="true" />
              <span>{credits}</span>
              {referenceSpend > 0 && <span className="opacity-80" data-reference-spend="">-{referenceSpend}</span>}
            </span>
            <OpusUsageBadge warningPercent={warningPercent} />
          </>
        )}
        <button
          className="round-button icon-only back-sky h-8 w-8 flex-none"
          aria-label="환경설정"
          title="환경설정"
          onClick={() => {
            setSettings(true);
          }}
        >
          <FaCog size={16} />
        </button>
        </div>
      </div>}
      {/* Mobile: 기본 = ⚙ 아이콘+크레딧 인라인(1줄 다이어트) / 클래식 툴바 = 기존 세로 배치 */}
      {isMobile && appState.uiToolbar.classic && (
        <div className="md:hidden flex flex-col items-center gap-1 titlebar-no-drag flex-none">
          <button
            className="round-button back-sky text-sm px-3 py-1 min-w-0 min-h-0"
            onClick={() => {
              setSettings(true);
            }}
          >
            환경설정
          </button>
          {!loggedIn ? (
            <span className="round-tag back-red text-sm !px-3 !py-1">로그인필요</span>
          ) : (
            <OpusUsageBadge credits={credits} warningPercent={warningPercent} spend={referenceSpend} />
          )}
        </div>
      )}
      {/* Mobile keeps its project selector beside the title-row controls. */}
      {/* 통짜 no-drag 를 주지 않는다 — SessionSelect 내부의 상호작용 요소만 no-drag 라,
          채워지지 않은 여백·버튼 사이 빈 공간은 drag 로 남아 창 이동 핸들이 된다. */}
      {isMobile && !projectSidebar && (
        <div
          className="ml-auto flex-1 min-w-0 block md:hidden"
        >
          <SessionSelect
            mobileLead={
              <>
                {mobileSettingsButton}
                <span className="flex-none">{mobileAccountBadge}</span>
              </>
            }
          />
        </div>
      )}

      {settings && (
        <ConfigScreen
          onSave={() => {
            setSettings(false);
          }}
          onClose={() => {
            setSettings(false);
          }}
        />
      )}
    </>
  );
});

const TobBar = observer(() => {
  const [isMaximized, setIsMaximized] = useState(false);
  useEffect(() => {
    if (isMobile || !window.electron) return;
    const checkMaximized = async () => {
      try { setIsMaximized(await window.electron.ipcRenderer.invoke('window-is-maximized')); } catch {}
    };
    checkMaximized();
    window.addEventListener('resize', checkMaximized);
    return () => window.removeEventListener('resize', checkMaximized);
  }, []);

  return (
    <div data-app-titlebar="" className={'zone-bar titlebar-drag flex border-b line-color px-3 items-center select-none gap-2 ' + (isMobile ? 'py-2' : 'h-8 flex-none')}>
      <div className="titlebar-no-drag hidden lg:flex text-sm text-sky-500 font-bold dark:text-white">SDStudio</div>
      {isMobile && <AppToolbarControls />}
      {!isMobile && <div className="titlebar-no-drag flex items-center ml-auto -mr-1">
        <button className="window-control-btn" aria-label="최소화" onClick={() => window.electron?.ipcRenderer.invoke('window-minimize')}><VscChromeMinimize size={16} /></button>
        <button className="window-control-btn" aria-label={isMaximized ? '이전 크기로' : '최대화'} onClick={async () => {
          await window.electron?.ipcRenderer.invoke('window-maximize');
          setIsMaximized(await window.electron?.ipcRenderer.invoke('window-is-maximized'));
        }}>{isMaximized ? <VscChromeRestore size={16} /> : <VscChromeMaximize size={16} />}</button>
        <button className="window-control-btn window-control-close" aria-label="창 닫기" onClick={() => window.electron?.ipcRenderer.invoke('window-close')}><VscChromeClose size={16} /></button>
      </div>}
    </div>
  );
});

export default TobBar;
