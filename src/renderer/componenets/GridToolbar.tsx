import React, { ReactNode, useRef } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';
import { observer } from 'mobx-react-lite';
import { isMobile } from '../models';
import { appState } from '../models/AppService';
import Tooltip from './Tooltip';

export function GridSearchBar({ label, query, onChange }: {
  label: string; query: string; onChange: (query: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div role="search" aria-label={label} className="flex flex-none items-center gap-2 pb-2 px-1">
      <FaSearch className="text-faint flex-none" aria-hidden="true" />
      <input
        ref={input}
        data-esc-cancel
        type="text"
        aria-label={label}
        className="min-w-0 flex-1 px-2 py-1 border line-color rounded bg-[var(--c-input-bg)] text-default outline-none focus:border-sky-500"
        placeholder={label + '...'}
        value={query}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
          onChange('');
          e.currentTarget.blur();
        }}
      />
      <button type="button" className="round-button icon-only back-gray" aria-label="검색어 지우기"
        disabled={!query} onClick={() => { onChange(''); input.current?.focus(); }}>
        <FaTimes />
      </button>
    </div>
  );
}

export const GridToolbarGroup = observer(function GridToolbarGroup({ caption, id, separate, children }: {
  caption: string; id?: string; separate?: boolean; children: ReactNode;
}) {
  if (isMobile || appState.uiToolbar?.classic) return <>{children}</>;
  return (
    <div role="group" aria-label={caption} data-toolbar-group={id}
      className={separate ? 'toolbar-group toolbar-group-sep' : 'toolbar-group'}>
      <div className="toolbar-group-caption text-muted" aria-hidden="true">{caption}</div>
      <div className="toolbar-group-buttons">{children}</div>
    </div>
  );
});

export const LibraryToolbar = observer(function LibraryToolbar({ children, view }: {
  children: ReactNode; view: ReactNode;
}) {
  const grouped = !isMobile && !appState.uiToolbar?.classic;
  return (
    <div className="flex flex-none flex-wrap items-end pb-1.5 gap-y-2">
      <div className={'scene-toolbar-row flex flex-wrap max-w-full ' +
        (grouped ? 'scene-toolbar-grouped' : 'gap-1 md:gap-2 items-center')}>
        {children}
      </div>
      <div className="ml-auto mr-2 flex items-center gap-2">{view}</div>
    </div>
  );
});

export const LibraryAction = observer(function LibraryAction({ label, hint, icon, tone = 'gray', pressed, disabled, onClick }: {
  label: string; hint?: string; icon: ReactNode; tone?: 'sky' | 'gray' | 'orange' | 'red';
  pressed?: boolean; disabled?: boolean; onClick: () => void;
}) {
  const icons = !appState.uiToolbar?.classic && (isMobile || !appState.sceneToolbarLegacyText);
  const color = { sky: 'back-sky', gray: 'back-gray', orange: 'back-orange', red: 'back-red' }[tone];
  return (
    <Tooltip content={hint ?? label}>
      <button type="button" aria-label={label} aria-pressed={pressed} disabled={disabled}
        className={'round-button ' + color + (icons ? ' icon-only' : '')} onClick={onClick}>
        {icons ? icon : label}
      </button>
    </Tooltip>
  );
});
