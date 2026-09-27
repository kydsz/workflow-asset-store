export const COLUMN_OPTIONS = [2, 3, 4, 5, 6] as const;
/** 0 表示不限；其余为最大高度像素值 */
export const THUMB_OPTIONS = [256, 384, 512, 640, 0] as const;

export const GALLERY_COLUMNS_KEY = 'was-gallery-columns';
export const GALLERY_THUMB_H_KEY = 'was-gallery-thumb-h';

export const DEFAULT_COLUMNS = 4;
export const DEFAULT_THUMB_H = 384;
// 「不限」取足够大的高度，瀑布流下卡片仍按原图比例自然排布
const UNLIMITED_THUMB_H = 100000;

export type DisplayPrefs = { columns: number; thumbHeightPx: number };
export type DisplayPrefKey = typeof GALLERY_COLUMNS_KEY | typeof GALLERY_THUMB_H_KEY;

export function normalizeColumns(v: unknown): number {
  const n = Number(v);
  return (COLUMN_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_COLUMNS;
}

export function normalizeThumbH(v: unknown): number {
  if (v == null || v === '') return DEFAULT_THUMB_H;
  const n = Number(v);
  return (THUMB_OPTIONS as readonly number[]).includes(n) ? n : DEFAULT_THUMB_H;
}

/** 选项值 → CSS 长度 */
export function thumbCss(v: unknown): string {
  const n = normalizeThumbH(v);
  return `${n === 0 ? UNLIMITED_THUMB_H : n}px`;
}

export function cssVarName(key: DisplayPrefKey): string {
  return key === GALLERY_COLUMNS_KEY ? '--was-gallery-columns' : '--was-gallery-thumb-h';
}

export function cssVarValue(key: DisplayPrefKey, stored: string): string {
  return key === GALLERY_COLUMNS_KEY ? String(normalizeColumns(stored)) : thumbCss(stored);
}

function read(key: DisplayPrefKey, fallback: number, clamp: (v: unknown) => number): number {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : clamp(raw);
  } catch {
    return fallback;
  }
}

export function readDisplayPrefs(): DisplayPrefs {
  return {
    columns: read(GALLERY_COLUMNS_KEY, DEFAULT_COLUMNS, normalizeColumns),
    thumbHeightPx: read(GALLERY_THUMB_H_KEY, DEFAULT_THUMB_H, normalizeThumbH),
  };
}

export function writeDisplayPref(key: DisplayPrefKey, value: number) {
  const normalized = key === GALLERY_COLUMNS_KEY ? normalizeColumns(value) : normalizeThumbH(value);
  try {
    localStorage.setItem(key, String(normalized));
  } catch {
    /* ignore */
  }
  document.documentElement.style.setProperty(cssVarName(key), cssVarValue(key, String(normalized)));
}

