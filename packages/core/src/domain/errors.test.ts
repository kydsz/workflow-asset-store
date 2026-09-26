import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES } from './errors.js';

describe('DomainError 携带稳定 code', () => {
  it('构造时可带 code，缺省为 unknown', () => {
    expect(new DomainError('中文兜底', 'recipe_not_found').code).toBe('recipe_not_found');
    expect(new DomainError('无码').code).toBe('unknown');
  });

  it('抛出的错误都能被捕获并读到 code', () => {
    try {
      throw new DomainError('配方必须有名称', 'recipe_name_required');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('recipe_name_required');
    }
  });

  it('ERROR_CODES 去重且全为蛇形命名', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const c of ERROR_CODES) expect(c).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
