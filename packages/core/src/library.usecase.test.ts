import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibrary, DomainError, templateOf, type Library } from './index.js';

const root = join(tmpdir(), `was-lib-usecase-${process.pid}`);
const srcDir = join(root, 'src');

const graph = {
  '1': { class_type: 'CLIPTextEncode', inputs: { text: 'lib prompt' } },
  '2': { class_type: 'KSampler', inputs: { seed: 42, steps: 20 } },
};

let lib: Library;

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });
  lib = createLibrary({ dataDir: join(root, 'data') });
});

afterAll(() => {
  lib.close();
  rmSync(root, { recursive: true, force: true });
});

describe('createLibrary({dataDir})：库自持存储与文件目录', () => {
  it('数据目录自动创建，DB 落在其中', () => {
    expect(lib.dataDir).toBe(join(root, 'data'));
    expect(readFileSync(join(root, 'data', 'asset-store.db'), 'utf8').length).toBeGreaterThan(0);
  });

  it('uploadStaging 落盘在数据目录内，返回绝对路径', () => {
    const p = lib.uploadStaging('up .json', Buffer.from('{"a":1}'));
    expect(p.startsWith(join(root, 'data'))).toBe(true);
    expect(readFileSync(p, 'utf8')).toBe('{"a":1}');
  });
});

describe('lib.ingest：入库用例下沉，调用方不再自己接线 storage', () => {
  it('sources 为绝对路径也能入库；显式字段用 IngestExplicit 类型（无 as never）', () => {
    const file = join(srcDir, 'plain.png');
    writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('fake')]));
    const res = lib.ingest({ sources: [file], explicit: { tool: 'comfyui', prompt: 'filled' } });
    expect(res).toHaveLength(1);
    const rec = lib.records.get(res[0]!.recordId)!;
    expect(rec.tool).toBe('comfyui');
    expect(rec.prompt).toBe('filled');
    expect(rec.artifacts[0]!.path.startsWith(join(root, 'data'))).toBe(true);
  });

  it('mode=reference：不复制文件，指回原路径', () => {
    const file = join(srcDir, 'ref.png');
    writeFileSync(file, Buffer.from('ref-bytes'));
    const res = lib.ingest({ sources: [file], mode: 'reference', explicit: { tool: 'x', prompt: 'p' } });
    expect(lib.records.get(res[0]!.recordId)!.artifacts[0]).toMatchObject({ path: file, storageMode: 'reference' });
  });
});

describe('配方用例：先建后挂 + 导出', () => {
  it('createRecipeWithFile：一步建档挂模板，配方文件内容是剥离运行值后的模板', () => {
    const src = join(srcDir, 'wf.json');
    writeFileSync(src, JSON.stringify(graph));
    const { recipe } = lib.createRecipeWithFile({ name: '带文件配方', tool: 'comfyui', filePath: src });
    expect(recipe.kind).toBe('workflow-file');
    expect(recipe.contentHash).toBe(templateOf(graph).contentHash);
    expect(templateOf(JSON.parse(readFileSync(recipe.workflowFilePath!, 'utf8'))).contentHash).toBe(recipe.contentHash);
    expect(lib.exportWorkflow(recipe.id)).not.toBeNull();
  });

  it('attachWorkflowFile 归并语义：同模板挂到别的配方时返回已有配方', () => {
    const bytes = Buffer.from(JSON.stringify({ ...graph, '1': { class_type: 'CLIPTextEncode', inputs: { text: 'changed' } } }));
    const draft = lib.recipes.create({ kind: 'workflow-file', name: '草稿', tool: 'comfyui' });
    const first = lib.createRecipeWithFile({ name: '原件', tool: 'comfyui', filePath: join(srcDir, 'wf.json') });
    const out = lib.attachWorkflowFile(draft.id, bytes);
    expect(out.recipe.id).toBe(first.recipe.id);
    expect(out.mergedInto).toBe(first.recipe.id);
  });

  it('exportWorkflow：带 run 回填提示词与 seed', () => {
    const src = join(srcDir, 'wf2.json');
    writeFileSync(src, JSON.stringify({ ...graph, '1': { class_type: 'CLIPTextEncode', inputs: { text: 'base' } }, '9': { class_type: 'VAEDecode', inputs: {} } }));
    const { recipe } = lib.createRecipeWithFile({ name: '导出', tool: 'comfyui', filePath: src });
    const out = lib.exportWorkflow(recipe.id, { prompt: 'run prompt', params: { seed: 99 } })!;
    const json = JSON.parse(out.text) as Record<string, { inputs: { text?: string; seed?: number } }>;
    expect(json['1']!.inputs.text).toBe('run prompt');
    expect(json['2']!.inputs.seed).toBe(99);
    expect(out.filename).toBe('导出.json');
  });

  it('配方不存在时 exportWorkflow/attach 抛 recipe_not_found', () => {
    expect(() => lib.exportWorkflow('nope')).toThrow(DomainError);
    expect(() => lib.attachWorkflowFile('nope', Buffer.from('{}'))).toThrow(DomainError);
  });
});

describe('recipes.rename：只改显示名', () => {
  it('改名生效，模板身份 contentHash 不变', () => {
    const r = lib.recipes.create({ kind: 'prompt-template', name: '旧名', prompt: 'hello' });
    const renamed = lib.recipes.rename(r.id, '  新名字  ');
    expect(renamed.name).toBe('新名字');
    expect(renamed.id).toBe(r.id);
    expect(lib.recipes.get(r.id)!.name).toBe('新名字');
  });

  it('workflow-file 配方改名保留 contentHash', () => {
    const r = lib.recipes.create({ kind: 'workflow-file', name: '原', contentHash: 'abc123' });
    expect(lib.recipes.rename(r.id, '重命名后').contentHash).toBe('abc123');
  });

  it('空白名或缺失配方都拒绝', () => {
    const r = lib.recipes.create({ kind: 'prompt-template', name: 'x', prompt: 'p' });
    expect(() => lib.recipes.rename(r.id, '   ')).toThrow(DomainError);
    expect(() => lib.recipes.rename('nope', '名')).toThrow(DomainError);
  });

  it('回收站里的配方不可改名', () => {
    const r = lib.recipes.create({ kind: 'prompt-template', name: 'x', prompt: 'p' });
    lib.recipes.trash([r.id]);
    expect(() => lib.recipes.rename(r.id, '名')).toThrow(DomainError);
  });

  it('改名不影响自动归并：同模板再入库仍命中改名后的配方，不产生第二份', () => {
    const first = lib.createRecipeWithFile({ name: '原始文件名', tool: 'comfyui', filePath: join(srcDir, 'wf.json') });
    lib.recipes.rename(first.recipe.id, '我的长城工作流');

    // 换提示词换 seed 仍属同一模板；文件名也不同
    const bytes = Buffer.from(JSON.stringify({ ...graph, '1': { class_type: 'CLIPTextEncode', inputs: { text: 'another run' } }, '2': { class_type: 'KSampler', inputs: { seed: 7, steps: 20 } } }));
    const draft = lib.recipes.create({ kind: 'workflow-file', name: '待挂', tool: 'comfyui' });
    const out = lib.attachWorkflowFile(draft.id, bytes);
    expect(out.recipe.id).toBe(first.recipe.id);
    expect(out.recipe.name).toBe('我的长城工作流');
    expect(lib.recipes.list().filter((r) => r.contentHash === first.recipe.contentHash)).toHaveLength(1);
  });

  it('改名后再拖入同模板资产：走完整入库管线仍归并到改名后的配方', () => {
    const first = lib.createRecipeWithFile({ name: '1790407794897_原始导出名', tool: 'comfyui', filePath: join(srcDir, 'wf.json') }).recipe;
    lib.recipes.rename(first.id, '我的长城工作流');

    const src = join(srcDir, '随手起的名字.json');
    writeFileSync(src, JSON.stringify({ ...graph, '1': { class_type: 'CLIPTextEncode', inputs: { text: 'new run' } }, '2': { class_type: 'KSampler', inputs: { seed: 99, steps: 20 } } }));
    const [res] = lib.ingest({ sources: [src] });
    expect(res!.status).toBe('collected');
    expect(res!.recipeId).toBe(first.id);
    expect(lib.recipes.get(first.id)!.name).toBe('我的长城工作流');
    expect(lib.recipes.list().filter((r) => r.contentHash === first.contentHash)).toHaveLength(1);
  });

  it('导出文件名跟随新名，非法字符被净化', () => {
    const r = lib.createRecipeWithFile({ name: '旧名', tool: 'comfyui', filePath: join(srcDir, 'wf.json') }).recipe;
    lib.recipes.rename(r.id, '  山海关 / 第①版  ' );
    const out = lib.exportWorkflow(r.id)!;
    expect(out.filename).toBe('山海关___第_版.json');
  });
});

describe('lib.readLibraryFile：数据目录读文件的安全收口', () => {
  it('data 内相对路径可读；越界、绝对路径、db 文件拒绝', () => {
    writeFileSync(join(root, 'data', 'note.txt'), 'hello');
    const ok = lib.readLibraryFile('note.txt');
    expect(ok?.bytes.toString()).toBe('hello');
    expect(lib.readLibraryFile('../outside.txt')).toBeNull();
    expect(lib.readLibraryFile(join(srcDir, 'plain.png'))).toBeNull();
    expect(lib.readLibraryFile('asset-store.db')).toBeNull();
  });

  it('绝对路径仅在指向 data 目录内时可读（copy 模式产物登记校验用）', () => {
    const inside = join(root, 'data', 'files', 'x.txt');
    writeFileSync(inside, 'in');
    expect(lib.readLibraryFile(inside)?.bytes.toString()).toBe('in');
    expect(lib.readLibraryFile(join(srcDir, 'plain.png'))).toBeNull();
  });
});
