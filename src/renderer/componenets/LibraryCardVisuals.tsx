import type { ReactNode } from 'react';

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
