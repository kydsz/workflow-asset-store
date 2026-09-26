import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibrary, createStorage, ingestFiles } from '@was/core';
import { errorText, makeT, reasonText } from './locale';

const root = join(tmpdir(), `was-i18n-${process.pid}`);

const expectThrows = (run: () => void): unknown => {
  try {
    run();
  } catch (e) {
    return e;
  }
  throw new Error('expected a DomainError, nothing was thrown');
};

describe('核心层 code → 界面文案（端到端）', () => {
  beforeAll(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
  });

  it('入库解析不到的字段，界面按 reasonCode 取词，中英各自正确', () => {
    const src = join(root, 'src', 'plain.json');
    writeFileSync(src, JSON.stringify({ note: '不是 comfy 工作流' }));
    const lib = createLibrary({ sqlite: ':memory:' });
    const storage = createStorage({ dataDir: join(root, 'data'), mode: 'copy' });
    const res = ingestFiles({ lib, storage, sources: [src] });
    const flags = lib.records.get(res[0]!.recordId)!.needsManual ?? [];
    expect(flags.length).toBeGreaterThan(0);

    const en = makeT('en');
    const zh = makeT('zh');
    expect(reasonText(en, flags.find((f) => f.field === 'recipe')!)).toBe(
      'No parsable workflow metadata in the file — link a recipe or fill it in manually',
    );
    expect(reasonText(zh, flags.find((f) => f.field === 'recipe')!)).toBe('文件不含可解析的工作流元数据，需手动关联或补录');
    lib.close();
  });

  it('核心层抛出的 DomainError 在英文界面不再吐中文', () => {
    const lib = createLibrary({ sqlite: ':memory:' });
    const en = makeT('en');
    const zh = makeT('zh');
    expect(errorText(en, expectThrows(() => lib.recipes.backfill('missing', {})))).toBe('Recipe not found');
    expect(errorText(zh, expectThrows(() => lib.recipes.backfill('missing', {})))).toBe('配方不存在');
    expect(errorText(en, expectThrows(() => lib.records.update('missing', {})))).toBe('Generation record not found');
    lib.close();
  });

  it('无 code 的普通错误回落原文，不被字典吞掉', () => {
    expect(errorText(makeT('en'), new Error('boom'))).toBe('boom');
  });
});
