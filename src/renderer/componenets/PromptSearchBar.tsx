import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { FaChevronDown, FaChevronUp, FaSearch } from 'react-icons/fa';

export interface PromptSearchEditor {
  selectRange(start: number, end: number): Promise<void>;
  replaceRange(start: number, end: number, text: string): Promise<void>;
}
export interface PromptSearchHandle { focus(replace?: boolean): void }

export const PromptSearchBar = forwardRef<PromptSearchHandle, {
  value: string; editor: React.RefObject<PromptSearchEditor>; disabled?: boolean;
}>(({ value, editor, disabled }, ref) => {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [selected, setSelected] = useState(-1);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null), replace = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: (toReplace = false) => {
    const field = toReplace ? replace.current : search.current;
    field?.focus(); field?.select();
  } }));
  const text = caseSensitive ? value : value.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: number[] = [];
  if (needle) for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) matches.push(at);
  const current = matches.indexOf(selected);
  const find = async (direction: number) => {
    if (!matches.length) return;
    const next = current < 0 ? (direction > 0 ? 0 : matches.length - 1)
      : (current + direction + matches.length) % matches.length;
    const at = matches[next];
    setSelected(at);
    await editor.current?.selectRange(at, at + query.length);
  };
  const change = async (all: boolean) => {
    if (!matches.length || busy || disabled) return;
    setBusy(true);
    try {
      if (all) {
        let next = value;
        for (const at of [...matches].reverse()) next = next.slice(0, at) + replacement + next.slice(at + query.length);
        await editor.current?.replaceRange(0, value.length, next);
        setSelected(-1);
      } else {
        const at = current < 0 ? matches[0] : selected;
        await editor.current?.replaceRange(at, at + query.length, replacement);
        setSelected(-1);
      }
    } finally { setBusy(false); }
  };
  return <div data-prompt-search className="flex-none flex flex-col gap-2 px-4 py-3 border-b line-color bg-[var(--c-zone)]">
    <div className="flex items-center gap-2 min-w-0">
      <FaSearch size={14} className="text-muted flex-none" aria-hidden />
      <input ref={search} aria-label="프롬프트 검색" className="gray-input flex-1 min-w-0 px-3 h-8 text-sm" placeholder="검색 (Ctrl+F)"
        value={query} onChange={e => { setQuery(e.target.value); setSelected(-1); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void find(e.shiftKey ? -1 : 1); } }} />
      <span className="text-xs text-muted tabular-nums whitespace-nowrap" role="status">{current < 0 ? 0 : current + 1} / {matches.length}</span>
      <button type="button" aria-label="이전 검색 결과" title="이전 결과 (Shift+Enter)" className="icon-button h-8 w-8" disabled={!matches.length} onClick={() => void find(-1)}><FaChevronUp size={13} /></button>
      <button type="button" aria-label="다음 검색 결과" title="다음 결과 (Enter)" className="icon-button h-8 w-8" disabled={!matches.length} onClick={() => void find(1)}><FaChevronDown size={13} /></button>
      <label className="flex items-center gap-1.5 text-xs text-muted whitespace-nowrap cursor-pointer"><input type="checkbox" checked={caseSensitive} onChange={e => { setCaseSensitive(e.target.checked); setSelected(-1); }} />대소문자</label>
    </div>
    {!disabled && <div className="flex items-center gap-2 pl-[22px]">
      <input ref={replace} aria-label="프롬프트 바꿀 내용" className="gray-input flex-1 min-w-0 px-3 h-8 text-sm" placeholder="바꿀 내용 (Ctrl+H)" value={replacement} onChange={e => setReplacement(e.target.value)} />
      <button type="button" className="round-button back-gray px-3 h-8 text-sm whitespace-nowrap disabled:opacity-40" disabled={busy || !matches.length} onClick={() => void change(false)}>바꾸기</button>
      <button type="button" className="round-button back-sky px-3 h-8 text-sm whitespace-nowrap disabled:opacity-40" disabled={busy || !matches.length} onClick={() => void change(true)}>모두 바꾸기</button>
    </div>}
  </div>;
});
