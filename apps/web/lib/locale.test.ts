import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES, NEEDS_MANUAL_CODES } from '@was/core';
import { en, zh, makeT, reasonText, errorText, type TKey } from './locale';

describe('locale dictionaries', () => {
  it('英中两份字典的 key 完全一致', () => {
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    const missing = zhKeys.filter((k) => !(k in en));
    const extra = enKeys.filter((k) => !(k in zh));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    expect(zhKeys.length).toBeGreaterThan(0);
  });

  it('英文未翻时立刻报错（除专有名词外两份值不能相同）', () => {
    // 语言名按惯例在两份字典里都用该语言自身书写，便于跨语言识别
    const SAME_OK = new Set(['nav.brand', 'meta.title', 'upload.toolPlaceholder', 'settings.lang.zh', 'settings.lang.en']);
    const untranslated = Object.keys(zh).filter((k) => zh[k as TKey] === en[k as TKey] && !SAME_OK.has(k));
    expect(untranslated).toEqual([]);
  });

  it('占位符 {n} 在两份字典中数量一致', () => {
    const holes = (s: string) => s.split('{n}').length - 1;
    const mismatched = Object.keys(zh).filter((k) => holes(zh[k as TKey]) !== holes(en[k as TKey]));
    expect(mismatched).toEqual([]);
  });

  it('makeT 按语言取词并填充 {n}', () => {
    expect(makeT('zh')('nav.records')).toBe('生成记录');
    expect(makeT('en')('nav.records')).toBe('Generation Records');
    expect(makeT('zh')('common.count', 12)).toBe('12 条');
    expect(makeT('en')('common.count', 12)).toBe('12 items');
  });

  it('英文按数量加复数后缀，中文不受影响', () => {
    expect(makeT('en')('common.count', 1)).toBe('1 item');
    expect(makeT('en')('common.count', 3)).toBe('3 items');
    expect(makeT('zh')('common.count', 3)).toBe('3 条');
  });

  it('核心层的每个 code 都有中英词条（reason.* / err.*）', () => {
    const codes = [...NEEDS_MANUAL_CODES.map((c) => `reason.${c}`), ...ERROR_CODES.map((c) => `err.${c}`)];
    expect(codes.length).toBeGreaterThan(0);
    const missing = codes.filter((k) => !(k in zh) || !(k in en));
    expect(missing).toEqual([]);
  });

  it('待补录原因按 code 取词；老数据无 code 时回落到原文', () => {
    expect(makeT('en')('reason.workflow_metadata_absent')).toBe('No parsable workflow metadata in the file — link a recipe or fill it in manually');
    expect(reasonText(makeT('en'), { reasonCode: 'tool_not_detected', reason: '未识别到生成工具' })).toBe('Generation tool not detected');
    expect(reasonText(makeT('zh'), { reasonCode: 'tool_not_detected', reason: '未识别到生成工具' })).toBe('未识别到生成工具');
    expect(reasonText(makeT('en'), { reason: '历史中文原因' })).toBe('历史中文原因');
  });

  it('领域错误按 code 翻译，无 code / 未知 code 回落原文', () => {
    expect(errorText(makeT('en'), new DomainError('配方不存在: b30ba', 'recipe_not_found'))).toBe('Recipe not found');
    expect(errorText(makeT('zh'), new DomainError('配方不存在: b30ba', 'recipe_not_found'))).toBe('配方不存在');
    expect(errorText(makeT('en'), new Error('boom'))).toBe('boom');
    expect(errorText(makeT('en'), new DomainError('没登记过的码', 'brand_new_code' as never))).toBe('没登记过的码');
  });

  it('未知 key 原样返回，便于排查', () => {
    expect(makeT('en')('nope.missing' as never)).toBe('nope.missing');
  });

  it('时间格式化跟随语言', () => {
    const ts = Date.parse('2026-03-05T08:09:10Z');
    const zhTime = makeT('zh').time(ts);
    const enTime = makeT('en').time(ts);
    // 中文以年份开头（2026/3/5…），英文以月日开头（3/5/2026…）
    expect(/^\d{4}/.test(zhTime)).toBe(true);
    expect(/^\d{1,2}\/\d{1,2}\//.test(enTime)).toBe(true);
    expect(zhTime).not.toBe(enTime);
  });
});
