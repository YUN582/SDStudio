let deferred = new Set<string>();
export function setAuxiliaryLayout(entries: readonly { dir: string; legacyAuxiliary?: boolean }[]) {
  deferred = new Set(entries.filter(entry => entry.legacyAuxiliary).map(entry => entry.dir));
}

/** Project-local auxiliary storage on workspace desktops. Legacy and mobile stores keep their own layout. */
export function projectAuxiliaryDir(owner: string, kind: 'fastcache' | '.unused' | 'images' | 'scenes', leaf?: string) {
  const [workspace, project, ...relative] = owner.split('/');
  const desktop = typeof window !== 'undefined' && !!window.electron;
  const base = desktop && workspace === 'workspace' && project && !deferred.has(project) && relative.length
    ? [workspace, project, kind === 'fastcache' || kind === '.unused' ? kind : '.trash/' + kind, ...relative].join('/')
    : owner + (kind === 'fastcache' || kind === '.unused' ? '/' + kind : '/.trash');
  if (leaf === undefined) return base;
  if (!leaf || leaf === '.' || leaf === '..' || /[\\/]/.test(leaf)) throw new Error('잘못된 휴지통 항목 이름');
  return base + '/' + leaf;
}

export function isThumbnailPath(filename: string) {
  const parts = filename.split('/');
  return parts[0] === 'workspace' && !deferred.has(parts[1]) && typeof window !== 'undefined' && !!window.electron
    ? parts[2] === 'fastcache' : parts[parts.length - 2] === 'fastcache' && /^\d+_/.test(parts[parts.length - 1]);
}
