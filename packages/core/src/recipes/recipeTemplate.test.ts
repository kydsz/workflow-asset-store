import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibrary, DomainError, sha256hex, type Library, type Recipe } from '../index.js';
import { createStorage, type Storage } from '../storage/storage.js';
import { attachWorkflowTemplate, exportRecipeWorkflow, templateOf } from './recipeTemplate.js';

const root = join(tmpdir(), `was-recipe-tpl-${process.pid}`);
const srcDir = join(root, 'src');

let lib: Library;
let storage: Storage;

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });
  lib = createLibrary({ sqlite: ':memory:' });
  storage = createStorage({ dataDir: join(root, 'data'), mode: 'copy' });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const apiGraph = {
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat astronaut' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, worst quality' } },
  '3': { class_type: 'KSampler', inputs: { seed: 12345, steps: 30, cfg: 4.5, sampler_name: 'dpmpp_2m', scheduler: 'karras' } },
};

const apiGraphV2 = {
  ...apiGraph,
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'totally other prompt' } },
  '3': { class_type: 'KSampler', inputs: { ...apiGraph['3'].inputs, seed: 777 } },
};

const uiGraph = {
  last_node_id: 9,
  last_link_id: 3,
  nodes: [
    { id: 6, type: 'CLIPTextEncode', pos: [10, 20], size: [300, 100], flags: {}, order: 1, mode: 0, widgets_values: ['a cat astronaut'] },
    { id: 3, type: 'KSampler', pos: [400, 50], size: [280, 260], flags: {}, order: 5, mode: 0, widgets_values: [12345, 'auto', 30, 4.5, 'dpmpp_2m', 'karras', 1] },
  ],
  links: [],
  groups: [],
  config: {},
  extra: { ds: { scale: 1, offset: [0, 0] } },
  version: 0.4,
};

const uiGraphV2 = {
  ...uiGraph,
  nodes: [
    { ...uiGraph.nodes[0], pos: [999, 999], widgets_values: ['another prompt entirely'] },
    { ...uiGraph.nodes[1], size: [1, 2], widgets_values: [424242, 'auto', 30, 4.5, 'dpmpp_2m', 'karras', 1] },
  ],
};

/** 打乱键序：JSON 解析/序列化顺序不应影响模板哈希 */
function shuffled(obj: unknown): unknown {
  const raw = JSON.stringify(obj);
  const keys = Object.keys(JSON.parse(raw) as Record<string, unknown>);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = (i * 7 + 3) % (i + 1);
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }
  const out: Record<string, unknown> = {};
  for (const k of keys.sort().reverse()) out[k] = (JSON.parse(raw) as Record<string, unknown>)[k];
  return out;
}

const parse = (text: string) => JSON.parse(text) as Record<string, unknown>;
const digest = (v: unknown) => templateOf(v).contentHash;

describe('templateOf：配方身份 = 剥离运行值后的模板哈希', () => {
  it('API 图：改提示词/seed 哈希不变，键序无关；改 steps 视为换模板', () => {
    expect(digest(apiGraphV2)).toBe(digest(apiGraph));
    expect(digest(shuffled(apiGraph))).toBe(digest(apiGraph));
    expect(digest({ ...apiGraph, '3': { class_type: 'KSampler', inputs: { ...apiGraph['3'].inputs, steps: 99 } } })).not.toBe(digest(apiGraph));
  });

  it('UI 图：画布噪音（坐标/尺寸/flags/extra/config/view 状态）不参与哈希', () => {
    expect(digest(uiGraphV2)).toBe(digest(uiGraph));
  });
});

const write = (name: string, data: Buffer | string): string => {
  const p = join(srcDir, name);
  writeFileSync(p, data);
  return p;
};

const filesDir = () => readdirSync(join(root, 'data', 'files'));

describe('attachWorkflowTemplate：先建后挂的统一入口（与自动入库同口径）', () => {
  const draft = (): Recipe => lib.recipes.create({ kind: 'workflow-file', name: '我的配方', tool: 'comfyui' });

  it('空配方补挂：模板内容落盘、带 contentHash，源字节直接 export 得到同一哈希', () => {
    const r = draft();
    const bytes = Buffer.from(JSON.stringify(apiGraph), 'utf8');
    const out = attachWorkflowTemplate({ lib, storage }, { recipeId: r.id, bytes });
    expect(out.recipe.contentHash).toBe(digest(apiGraph));
    expect(out.recipe.workflowFilePath).toBeTruthy();
    expect(digest(parse(readFileSync(out.recipe.workflowFilePath!, 'utf8')))).toBe(out.recipe.contentHash);
    expect(filesDir().every((f) => f.endsWith('.json'))).toBe(true);
  });

  it('同模板第二次补挂：幂等，不新增落盘文件', () => {
    const r = draft();
    attachWorkflowTemplate({ lib, storage }, { recipeId: r.id, bytes: Buffer.from(JSON.stringify(apiGraph)) });
    const n = filesDir().length;
    const out = attachWorkflowTemplate({ lib, storage }, { recipeId: r.id, bytes: Buffer.from(JSON.stringify(apiGraphV2)) });
    expect(out.recipe.id).toBe(r.id);
    expect(filesDir().length).toBe(n);
  });

  it('内容与库内旧口径配方（原始内容落盘）模板相同：自愈归并，不产生第二份配方', () => {
    const rawFile = storage.place('legacy-src', Buffer.from(JSON.stringify(apiGraph)), '.json').path;
    const other = lib.recipes.create({
      kind: 'workflow-file',
      name: '旧口径配方',
      tool: 'comfyui',
      workflowFilePath: rawFile,
      contentHash: sha256hex(Buffer.from(JSON.stringify(apiGraph))),
    });
    const target = draft();
    const out = attachWorkflowTemplate({ lib, storage }, { recipeId: target.id, bytes: Buffer.from(JSON.stringify(apiGraphV2)) });
    expect(out.recipe.id).toBe(other.id);
    expect(lib.recipes.get(target.id)!.workflowFilePath).toBeFalsy();
  });

  it('目标配方已挂不同模板：报 recipe_template_conflict，原配方不被覆盖', () => {
    const r = attachWorkflowTemplate({ lib, storage }, { recipeId: draft().id, bytes: Buffer.from(JSON.stringify(apiGraph)) }).recipe;
    const before = r.contentHash;
    let err: unknown;
    try {
      attachWorkflowTemplate({ lib, storage }, { recipeId: r.id, bytes: Buffer.from(JSON.stringify({ '1': { class_type: 'VAEEncode', inputs: {} } })) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('recipe_template_conflict');
    expect(lib.recipes.get(r.id)!.contentHash).toBe(before);
  });

  it('非 workflow-file 配方报 workflow_kind_mismatch；非法 JSON 报 workflow_json_invalid；配方不存在报 recipe_not_found', () => {
    const txt = lib.recipes.create({ kind: 'prompt-template', name: '纯文本', prompt: 'p' });
    expect(() => attachWorkflowTemplate({ lib, storage }, { recipeId: txt.id, bytes: Buffer.from('{}') })).toThrow(DomainError);
    try {
      attachWorkflowTemplate({ lib, storage }, { recipeId: txt.id, bytes: Buffer.from('{}') });
    } catch (e) {
      expect((e as DomainError).code).toBe('workflow_kind_mismatch');
    }
    const r = draft();
    try {
      attachWorkflowTemplate({ lib, storage }, { recipeId: r.id, bytes: Buffer.from('not-json') });
    } catch (e) {
      expect((e as DomainError).code).toBe('workflow_json_invalid');
    }
    try {
      attachWorkflowTemplate({ lib, storage }, { recipeId: 'nope', bytes: Buffer.from('{}') });
    } catch (e) {
      expect((e as DomainError).code).toBe('recipe_not_found');
    }
  });
});

describe('exportRecipeWorkflow：导出即回填，源文件不动', () => {
  const attach = (obj: unknown): Recipe =>
    attachWorkflowTemplate({ lib, storage }, { recipeId: lib.recipes.create({ kind: 'workflow-file', name: '导出用 配方', tool: 'comfyui' }).id, bytes: Buffer.from(JSON.stringify(obj)) }).recipe;

  it('无文件或配方形态不对：返回 null', () => {
    expect(exportRecipeWorkflow(lib, { recipe: lib.recipes.create({ kind: 'workflow-file', name: '空', tool: 'comfyui' }) })).toBeNull();
    expect(exportRecipeWorkflow(lib, { recipe: lib.recipes.create({ kind: 'prompt-template', name: 't', prompt: 'p' }) })).toBeNull();
  });

  it('模板导出：注入提示词与 seed，负向提示词原样保留', () => {
    const r = attach(apiGraph);
    const out = exportRecipeWorkflow(lib, { recipe: r, run: { prompt: 'run prompt', seed: 555 } })!;
    const json = parse(out.text);
    const promptNode = json['6'] as { inputs: { text: string } };
    const negative = json['7'] as { inputs: { text: string } };
    const ks = json['3'] as { inputs: { seed: number } };
    expect(promptNode.inputs.text).toBe('run prompt');
    expect(negative.inputs.text).toBe('blurry, worst quality');
    expect(ks.inputs.seed).toBe(555);
    expect(out.filename).toBe('导出用_配方.json');
  });

  it('模板导出缺 seed：兜底为可运行随机 seed，缺提示词回空串（产物始终可直接运行）', () => {
    const r = attach(apiGraph);
    const json = parse(exportRecipeWorkflow(lib, { recipe: r, run: { prompt: 'p' } })!.text);
    expect(typeof (json['3'] as { inputs: { seed: number } }).inputs.seed).toBe('number');
    const bare = parse(exportRecipeWorkflow(lib, { recipe: r })!.text);
    expect((bare['6'] as { inputs: { text: string } }).inputs.text).toBe('');
    expect(typeof (bare['3'] as { inputs: { seed: number } }).inputs.seed).toBe('number');
  });

  it('未模板化的历史工作流：按节点位置注入当次值', () => {
    const file = write('raw.json', JSON.stringify(apiGraphV2));
    const r = lib.recipes.create({ kind: 'workflow-file', name: 'raw', tool: 'comfyui', workflowFilePath: file });
    const json = parse(exportRecipeWorkflow(lib, { recipe: r, run: { prompt: 'injected', seed: 99 } })!.text);
    expect((json['6'] as { inputs: { text: string } }).inputs.text).toBe('injected');
    expect((json['3'] as { inputs: { seed: number } }).inputs.seed).toBe(99);
    expect(readFileSync(file, 'utf8')).toBe(JSON.stringify(apiGraphV2));
  });

  it('UI 图模板导出：widgets_values 数组槽位回填', () => {
    const r = attach(uiGraph);
    const json = parse(exportRecipeWorkflow(lib, { recipe: r, run: { prompt: 'ui prompt', seed: 888 } })!.text);
    const nodes = (json['nodes'] as { type: string; widgets_values: unknown[] }[]).filter((n) => n.type === 'CLIPTextEncode' || n.type === 'KSampler');
    expect((nodes.find((n) => n.type === 'CLIPTextEncode')!.widgets_values[0])).toBe('ui prompt');
    expect((nodes.find((n) => n.type === 'KSampler')!.widgets_values[0])).toBe(888);
  });

  it('非法 JSON 原样导出；文件缺失返回 null', () => {
    const file = write('broken.json', '{oops');
    const r = lib.recipes.create({ kind: 'workflow-file', name: 'broken', workflowFilePath: file });
    const out = exportRecipeWorkflow(lib, { recipe: r });
    expect(out).toEqual({ text: '{oops', filename: 'broken.json' });
    const missing = lib.recipes.create({ kind: 'workflow-file', name: 'ghost', workflowFilePath: join(srcDir, 'gone.json') });
    expect(exportRecipeWorkflow(lib, { recipe: missing })).toBeNull();
    expect(existsSync(file)).toBe(true);
  });
});
