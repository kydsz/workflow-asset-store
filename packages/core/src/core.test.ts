import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLibrary,
  DomainError,
  type GenerationRecord,
  type Library,
  type NewGenerationRecord,
  type NewRecipe,
} from './index.js';

beforeEach(() => {
  lib = createLibrary({ sqlite: ':memory:' });
});

let lib: Library;

const workflowRecipe: NewRecipe = {
  kind: 'workflow-file',
  name: '写实人像 SDXL 工作流',
  tool: 'comfyui',
  workflowFilePath: 'data/workflows/portrait.json',
};

const promptRecipe: NewRecipe = {
  kind: 'prompt-template',
  name: '电影感提示词模板',
  prompt: 'a cat astronaut, {style} light',
};

const twoArtifacts: NewGenerationRecord = {
  tool: 'comfyui',
  prompt: 'a cat astronaut, cinematic light',
  artifacts: [
    { path: 'data/media/out-1.png', mediaType: 'image' },
    { path: 'data/media/out-2.png', mediaType: 'image' },
  ],
};

describe('生成配方 Recipe', () => {
  it('创建后可按 id 取回，字段与 owner 完整', () => {
    const created = lib.recipes.create(workflowRecipe);
    const loaded = lib.recipes.get(created.id);
    expect(loaded).toEqual({
      ...created,
      kind: 'workflow-file',
      name: '写实人像 SDXL 工作流',
      tool: 'comfyui',
      workflowFilePath: 'data/workflows/portrait.json',
      owner: 'local',
    });
    expect(loaded.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(loaded.createdAt).toBeTypeOf('number');
  });

  it('纯收藏：只有提示词模板、尚无生成记录，是合法状态且可列出', () => {
    const saved = lib.recipes.create(promptRecipe);
    expect(lib.recipes.list()).toHaveLength(1);
    expect(lib.records.listByRecipe(saved.id)).toEqual([]);
  });

  it('参数预设可携带 params', () => {
    const r = lib.recipes.create({ kind: 'param-preset', name: 'SDXL 30步', params: { steps: 30 } });
    expect(lib.recipes.get(r.id).params).toEqual({ steps: 30 });
  });

  it('prompt-template / param-preset 缺必填内容时报 DomainError', () => {
    expect(() => lib.recipes.create({ kind: 'prompt-template', name: 'x' } as NewRecipe)).toThrow(DomainError);
    expect(() => lib.recipes.create({ kind: 'param-preset', name: 'x' } as NewRecipe)).toThrow(DomainError);
  });

  it('workflow-file 配方可先建后补文件，backfill 补上路径与哈希', () => {
    const r = lib.recipes.create({ kind: 'workflow-file', name: '还没拿到文件的工作流', tool: 'comfyui' });
    expect(r.workflowFilePath).toBe('');
    const filled = lib.recipes.backfill(r.id, { workflowFilePath: 'data/files/abc.json', contentHash: 'abc' });
    expect(filled.workflowFilePath).toBe('data/files/abc.json');
    expect(filled.contentHash).toBe('abc');
    expect(lib.recipes.findByContentHash('abc')?.id).toBe(r.id);
  });

  it('未知道具类型拒绝创建', () => {
    expect(() => lib.recipes.create({ kind: 'unknown' as NewRecipe['kind'], name: 'x' })).toThrow(DomainError);
  });
});

describe('生成记录 GenerationRecord', () => {
  it('一条记录可携带 N 个产物（ComfyUI 批跑一批算一条）', () => {
    const rec = lib.records.create(twoArtifacts);
    expect(lib.records.get(rec.id)?.artifacts).toHaveLength(2);
  });

  it('关联配方：按 recipeId 查询命中，未关联的记录不混入', () => {
    const recipe = lib.recipes.create(workflowRecipe);
    const linked = lib.records.create({ ...twoArtifacts, recipeId: recipe.id });
    lib.records.create(twoArtifacts);
    const hits = lib.records.listByRecipe(recipe.id);
    expect(hits.map((r: GenerationRecord) => r.id)).toEqual([linked.id]);
    expect(hits[0]?.recipeId).toBe(recipe.id);
  });

  it('云端工具无配方也合法', () => {
    const rec = lib.records.create({
      tool: 'kling',
      artifacts: [{ path: 'data/media/video.mp4', mediaType: 'video' }],
    });
    expect(lib.records.get(rec.id)?.recipeId).toBeUndefined();
  });

  it('sourceTool 必填', () => {
    expect(() => lib.records.create({ ...twoArtifacts, tool: '' })).toThrow(DomainError);
  });

  it('产物不能为空，且 path/mediaType 必填', () => {
    expect(() => lib.records.create({ tool: 'comfyui', artifacts: [] })).toThrow(DomainError);
    expect(() =>
      lib.records.create({ tool: 'comfyui', artifacts: [{ mediaType: 'image' } as never] }),
    ).toThrow(DomainError);
    expect(() =>
      lib.records.create({ tool: 'comfyui', artifacts: [{ path: 'a.png' } as never] }),
    ).toThrow(DomainError);
  });

  it('关联不存在的配方报 DomainError', () => {
    expect(() => lib.records.create({ ...twoArtifacts, recipeId: 'no-such-recipe' })).toThrow(DomainError);
  });

  it('查询不存在的记录返回 undefined', () => {
    expect(lib.records.get('no-such-id')).toBeUndefined();
    expect(lib.recipes.get('no-such-id')).toBeUndefined();
  });

  it('contentHash / needsManual / ingestSource / fileHash 往返存取', () => {
    const recipe = lib.recipes.create({ ...workflowRecipe, contentHash: 'ab12' });
    expect(lib.recipes.get(recipe.id)!.contentHash).toBe('ab12');
    expect(lib.recipes.findByContentHash('ab12')?.id).toBe(recipe.id);
    expect(lib.recipes.findByContentHash('no-such-hash')).toBeUndefined();

    const rec = lib.records.create({
      ...twoArtifacts,
      needsManual: [{ field: 'prompt', reason: '未解析到提示词' }],
      ingestSource: 'auto-extract',
      artifacts: [{ path: 'x.png', mediaType: 'image', storageMode: 'copy', fileHash: 'f00d' }],
    });
    const loaded = lib.records.get(rec.id)!;
    expect(loaded.needsManual).toEqual([{ field: 'prompt', reason: '未解析到提示词' }]);
    expect(loaded.ingestSource).toBe('auto-extract');
    expect(loaded.artifacts[0]).toMatchObject({ storageMode: 'copy', fileHash: 'f00d' });
    expect(lib.records.findByFileHash('f00d')?.id).toBe(rec.id);
    expect(lib.records.findByFileHash('nope')).toBeUndefined();
  });
});
