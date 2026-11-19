import type { ReactNode } from 'react';
import { FaCheckSquare, FaSquare } from 'react-icons/fa';

export const LIBRARY_CARD_SELECTED = 'border-sky-500 ring-2 ring-inset ring-sky-500';

export function LibraryCardSelection({ selected, onToggle }: { selected: boolean; onToggle: () => void }) {
  return <button type="button" aria-label={selected ? '선택 해제' : '선택'}
    data-library-card-selection="" aria-pressed={selected}
    className="absolute top-2 right-2 z-30 w-6 h-6 rounded bg-[var(--c-surface-2)] flex items-center justify-center"
    onClick={event => { event.stopPropagation(); onToggle(); }}>
    {selected ? <FaCheckSquare className="text-sky-500" size={22} /> : <FaSquare className="text-faint" size={22} />}
  </button>;
}

/** Image effects sit below captions, hints, and action buttons. */
export function LibraryCardHover({ hint }: { hint: string }) {
  return <>
    <div data-library-card-shade="" aria-hidden="true" className="absolute inset-0 z-[1] pointer-events-none md:group-hover:bg-black/40 md:group-hover:backdrop-blur-sm md:group-focus-within:bg-black/40 md:group-focus-within:backdrop-blur-sm transition-[background-color,backdrop-filter] duration-200 motion-reduce:transition-none" />
    <div data-library-card-hint="" aria-hidden="true" className="absolute inset-0 z-[2] pointer-events-none hidden md:flex items-center justify-center px-4 text-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 motion-reduce:transition-none">
      <span className="text-sm font-semibold text-white drop-shadow">{hint}</span>
    </div>
  </>;
}

export function LibraryCardCaption({ name, children }: { name: string; children?: ReactNode }) {
  return <div data-library-card-caption="" className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2 pointer-events-none">
    <div className="text-sm text-white font-medium drop-shadow truncate">{name}</div>
    {children != null && <div className="text-xs text-white/70 drop-shadow truncate">{children}</div>}
  </div>;
}
