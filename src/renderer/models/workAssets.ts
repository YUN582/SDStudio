/** A work ID in each auxiliary filename lets references survive a rename or a trip to trash. */
export const WORK_ASSET_META = 'sdstudio.workAssets.v1';
export const WORK_ASSET_PREFIX = 'works/';
export type WorkAssetRole = 'input' | 'mask' | 'drawing' | 'extra';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const managed = new RegExp(
  '^works/(' +
    UUID +
    ')/((?:input|mask|drawing|extra)-[a-zA-Z0-9_-]+\\.(?:png|webp))$',
  'i',
);
export function workAssetId(value: unknown): value is string {
  return (
    typeof value === 'string' && new RegExp('^' + UUID + '$', 'i').test(value)
  );
}
const localFilename = new RegExp('^(input|mask|drawing|extra)-(' + UUID + ')_([a-z0-9-]+)\\.(png|webp)$', 'i');
export function sceneAssetOwner(filename: string): string | undefined {
  return localFilename.exec(filename)?.[2];
}
export function sceneAssetName(owner: string, role: WorkAssetRole, revision: string, ext: string) {
  return role + '-' + owner + '_' + revision + '.' + ext;
}
export function managedWorkAsset(value: string): boolean {
  return managed.test(value);
}
/** Older callers may pass a complete project path; never accept traversal. */
export function vibeAssetToken(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.split('/').some((part) => part === '..' || part === '.'))
    throw new Error('이미지 경로에 잘못된 상위 경로가 있습니다.');
  const marker = normalized.lastIndexOf('/vibes/');
  const token =
    marker >= 0
      ? normalized.slice(marker + 7)
      : normalized.startsWith('vibes/works/')
        ? normalized.slice(6)
        : normalized;
  if (token.startsWith(WORK_ASSET_PREFIX)) {
    if (!managedWorkAsset(token))
      throw new Error('작업 이미지 경로를 확인해 주세요.');
    return token;
  }
  const leaf = token.split('/').pop()!;
  if (!leaf || /[<>:"|?*\x00-\x1f]/.test(leaf))
    throw new Error('이미지 파일명을 확인해 주세요.');
  return leaf;
}
/** Conservative reference collection also protects future/unknown metadata fields. */
export function collectAssetReferences(value: unknown): Set<string> {
  const refs = new Set<string>();
  const seen = new Set<object>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 64) throw new Error('이미지 참조 구조가 너무 깊습니다.');
    if (typeof item === 'string') {
      if (item.length > 2048) return;
      try {
        const token = vibeAssetToken(item);
        if (/\.(png|webp)$/i.test(token)) refs.add(token);
      } catch {}
    } else if (item && typeof item === 'object' && !seen.has(item)) {
      seen.add(item);
      if (item instanceof Map)
        for (const v of item.values()) visit(v, depth + 1);
      else for (const v of Object.values(item)) visit(v, depth + 1);
    }
  };
  visit(value, 0);
  return refs;
}

export function replaceAssetReferences(
  value: any,
  replacements: ReadonlyMap<string, string>,
): any {
  if (typeof value === 'string') {
    if (value.length > 2048) return value;
    try {
      return replacements.get(vibeAssetToken(value)) ?? value;
    } catch {
      return value;
    }
  }
  if (Array.isArray(value))
    return value.map((item) => replaceAssetReferences(item, replacements));
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value))
      value[key] = replaceAssetReferences(value[key], replacements);
  }
  return value;
}
