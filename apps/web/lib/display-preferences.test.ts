import { describe, expect, it } from 'vitest';
import { normalizeColumns, normalizeThumbH, thumbCss } from './display-preferences';

describe('display-preferences', () => {
  it('列数只接受白名单值，其余回落默认 4', () => {
    expect(normalizeColumns('3')).toBe(3);
    expect(normalizeColumns('999')).toBe(4);
    expect(normalizeColumns('abc')).toBe(4);
    expect(normalizeColumns(null)).toBe(4);
  });

  it('缩略图高度保留选项值，0 即不限，非法值回落 384', () => {
    expect(normalizeThumbH('512')).toBe(512);
    expect(normalizeThumbH('0')).toBe(0);
    expect(normalizeThumbH('-5')).toBe(384);
    expect(normalizeThumbH('abc')).toBe(384);
    expect(normalizeThumbH(null)).toBe(384);
    expect(normalizeThumbH('')).toBe(384);
  });

  it('不限落成足够大的高度，其余按像素', () => {
    expect(thumbCss(0)).toBe('100000px');
    expect(thumbCss('256')).toBe('256px');
    expect(thumbCss('garbage')).toBe('384px');
  });
});
