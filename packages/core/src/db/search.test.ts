import { beforeEach, describe, expect, it } from 'vitest';
import { createLibrary, type Library, type NewGenerationRecord } from '../index.js';

let lib: Library;

beforeEach(() => {
  lib = createLibrary({ sqlite: ':memory:' });
});

describe('records.update 编辑与待补录清除', () => {
  it('更新字段并按字段名清除 needs_manual 项', () => {
    const id = addRecord({ tool: 'comfyui', needsManual: [{ field: 'prompt', reason: '缺' }, { field: 'recipe', reason: '缺' }] });
    const recipe = lib.recipes.create({ kind: 'workflow-file', name: 'wf', workflowFilePath: 'wf.json' });
    const updated = lib.records.update(id, { prompt: '补录的提示词', recipeId: recipe.id, resolveManual: ['prompt', 'recipe'] });
    expect(updated.prompt).toBe('补录的提示词');
    expect(updated.recipeId).toBe(recipe.id);
    expect(updated.needsManual).toEqual([]);
    expect(lib.records.get(id)!.needsManual).toEqual([]);
  });

  it('空 resolve 列表是空操作（不误清全部标记）', () => {
    const id = addRecord({ tool: 'x', needsManual: [{ field: 'prompt', reason: '缺' }] });
    const u = lib.records.update(id, { prompt: 'p', resolveManual: [] });
    expect(u.needsManual).toEqual([{ field: 'prompt', reason: '缺' }]);
  });

  it('只清除已补字段，其余保留', () => {
    const id = addRecord({ tool: 'x', needsManual: [{ field: 'prompt', reason: '缺' }, { field: 'tool', reason: '缺' }] });
    const u = lib.records.update(id, { prompt: 'p', resolveManual: ['prompt'] });
    expect(u.needsManual).toEqual([{ field: 'tool', reason: '缺' }]);
  });

  it('更新不存在的记录抛 DomainError', async () => {
    const { DomainError } = await import('../index.js');
    expect(() => lib.records.update('ghost', { prompt: 'x' })).toThrow(DomainError);
  });
});

function addRecord(over: Partial<NewGenerationRecord> & { tool: string }): string {
  return lib.records.create({
    artifacts: [{ path: 'x.png', mediaType: 'image' }],
    ...over,
  }).id;
}

describe('records.search 检索', () => {
  beforeEach(() => {
    const comfy = lib.recipes.create({ kind: 'workflow-file', name: '人像工作流', tool: 'comfyui', workflowFilePath: 'wf.json' });
    addRecord({ tool: 'comfyui', recipeId: comfy.id, prompt: 'a cat astronaut, cinematic light', params: { seed: 1 }, artifacts: [{ path: 'a.png', mediaType: 'image' }] });
    addRecord({ tool: 'kling', prompt: '无人机俯瞰海岸线', note: 'Runway 备选未用', artifacts: [{ path: 'b.mp4', mediaType: 'video' }] });
    addRecord({ tool: 'comfyui', prompt: 'a dog wizard', needsManual: [{ field: 'recipe', reason: '缺工作流' }], artifacts: [{ path: 'c.png', mediaType: 'image' }] });
  });

  it('全文命中提示词、备注、配方名与参数值', () => {
    expect(lib.records.search({ query: 'astronaut' }).map((r) => r.prompt)).toEqual(['a cat astronaut, cinematic light']);
    expect(lib.records.search({ query: '海岸线' })).toHaveLength(1);
    expect(lib.records.search({ query: '人像工作流' })).toHaveLength(1);
    expect(lib.records.search({ query: '备选' })).toHaveLength(1);
    expect(lib.records.search({ query: 'seed' })).toHaveLength(1);
    expect(lib.records.search({ query: '1' })).toHaveLength(1);
    expect(lib.records.search({ query: 'no-such-word' })).toHaveLength(0);
  });

  it('按工具与媒体类型过滤', () => {
    expect(lib.records.search({ tool: 'comfyui' })).toHaveLength(2);
    expect(lib.records.search({ tool: 'kling' })).toHaveLength(1);
    expect(lib.records.search({ mediaType: 'video' })).toHaveLength(1);
    expect(lib.records.search({ mediaType: 'image', tool: 'comfyui' })).toHaveLength(2);
  });

  it('有无配方 / 待补录状态过滤', () => {
    expect(lib.records.search({ hasRecipe: true })).toHaveLength(1);
    expect(lib.records.search({ hasRecipe: false })).toHaveLength(2);
    expect(lib.records.search({ needsManual: true })).toHaveLength(1);
    expect(lib.records.search({ needsManual: false })).toHaveLength(2);
  });

  it('时间范围与排序（默认新→旧，可 oldest-first）', () => {
    const all = lib.records.search({});
    expect(all.map((r) => r.createdAt)).toEqual([...all.map((r) => r.createdAt)].sort((a, b) => b - a));
    expect(lib.records.search({ sort: 'oldest-first' })[0]?.createdAt).toBeLessThanOrEqual(all[all.length - 1]!.createdAt);
    const cutoff = Date.now() + 1000;
    expect(lib.records.search({ since: cutoff })).toHaveLength(0);
    expect(lib.records.search({ until: 0 })).toHaveLength(0);
  });

  it('limit 生效', () => {
    expect(lib.records.search({ limit: 2 })).toHaveLength(2);
  });

  it('recipes.search 按名称/提示词命中', () => {
    lib.recipes.create({ kind: 'prompt-template', name: '电影感模板', prompt: 'cinematic light, 8k' });
    expect(lib.recipes.search({ query: '电影感' })).toHaveLength(1);
    expect(lib.recipes.search({ query: 'cinematic' })).toHaveLength(1);
    expect(lib.recipes.search({ kind: 'workflow-file' })).toHaveLength(1);
    expect(lib.recipes.search({ query: '工作流', kind: 'prompt-template' })).toHaveLength(0);
  });
});

describe('records.stats 使用统计', () => {
  it('返回配方使用次数与最近使用时间', () => {
    const recipe = lib.recipes.create({ kind: 'workflow-file', name: 'wf', workflowFilePath: 'wf.json' });
    addRecord({ tool: 'comfyui', recipeId: recipe.id });
    addRecord({ tool: 'comfyui', recipeId: recipe.id });
    expect(lib.records.stats(recipe.id)).toMatchObject({ uses: 2, lastUsedAt: expect.any(Number) });
  });

  it('无使用的配方 uses 为 0', () => {
    const recipe = lib.recipes.create({ kind: 'prompt-template', name: '纯收藏', prompt: 'p' });
    expect(lib.records.stats(recipe.id)).toEqual({ uses: 0, lastUsedAt: null });
  });
});
