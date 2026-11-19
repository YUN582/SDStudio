import { resolutionMap, type ImageSize } from '../backends/imageGen';

export const QUICK_RESOLUTION_META = 'sdstudio.quickResolution.v1';
export interface QuickResolutionValue { resolution: string; width?: number; height?: number }
export interface QuickResolutionSettings { enabled: boolean; choices: QuickResolutionValue[] }
export const quickResolutionSize = (value: QuickResolutionValue): ImageSize => value.resolution === 'custom'
  ? { width: value.width!, height: value.height! }
  : { ...resolutionMap[value.resolution as keyof typeof resolutionMap] };
export const quickResolutionKey = (value: QuickResolutionValue) => {
  const size = quickResolutionSize(value);
  return `${size.width}x${size.height}`;
};
export function readQuickResolutionSettings(raw: unknown): QuickResolutionSettings {
  const saved = raw as Partial<QuickResolutionSettings> | undefined;
  const choices: QuickResolutionValue[] = [];
  for (const value of Array.isArray(saved?.choices) ? saved.choices : []) {
    if (!value || typeof value.resolution !== 'string') continue;
    if (value.resolution === 'custom') {
      if (![value.width, value.height].every(n => Number.isSafeInteger(n) && n! > 0 && n! % 64 === 0)) continue;
    } else if (!Object.prototype.hasOwnProperty.call(resolutionMap, value.resolution)) continue;
    const clean = value.resolution === 'custom'
      ? { resolution: 'custom', width: value.width, height: value.height }
      : { resolution: value.resolution };
    if (!choices.some(choice => quickResolutionKey(choice) === quickResolutionKey(clean))) choices.push(clean);
  }
  return { enabled: saved?.enabled === true, choices: choices.length ? choices :
    ['portrait', 'landscape', 'square'].map(resolution => ({ resolution })) };
}
