import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, createLibrary, NEEDS_MANUAL_CODES, sha256hex, type Library } from '../index.js';
import { createStorage, type Storage } from '../storage/storage.js';
import { ingestFiles, type IngestResult } from './pipeline.js';

const root = join(tmpdir(), `was-ingest-${process.pid}`);
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

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  }
  return ~c;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
function textChunk(keyword: string, value: string): Buffer {
  return pngChunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]));
}
const IHDR = (() => {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(8, 0);
  b.writeUInt32BE(8, 4);
  b[8] = 8;
  b[9] = 2;
  return pngChunk('IHDR', b);
})();
const IEND = pngChunk('IEND', Buffer.alloc(0));

const apiPrompt = {
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat astronaut, cinematic light' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, worst quality' } },
  '3': { class_type: 'KSampler', inputs: { seed: 12345, steps: 30, cfg: 4.5, sampler_name: 'dpmpp_2m', scheduler: 'karras' } },
};

/** 造一个带唯一像素数据的 ComfyUI PNG（不同 tag → 文件哈希不同，工作流相同） */
function comfyPng(tag: string): Buffer {
  return Buffer.concat([PNG_SIG, IHDR, textChunk('prompt', JSON.stringify(apiPrompt)), pngChunk('IDAT', Buffer.from(tag)), IEND]);
}

function comfyPngWith(tag: string, prompt: unknown): Buffer {
  return Buffer.concat([PNG_SIG, IHDR, textChunk('prompt', JSON.stringify(prompt)), pngChunk('IDAT', Buffer.from(tag)), IEND]);
}

function plainPng(tag: string): Buffer {
  return Buffer.concat([PNG_SIG, IHDR, pngChunk('IDAT', Buffer.from(tag)), IEND]);
}

function write(name: string, data: Buffer | string): string {
  const p = join(srcDir, name);
  writeFileSync(p, data);
  return p;
}

describe('ingest 入库管线（路径 1a/1b 的 core 部分）', () => {
  it('ComfyUI PNG 自动解析入库：建配方、建记录、字段齐全', () => {
    const f = write('cat.png', comfyPng('px-1'));
    const res = ingestFiles({ lib, storage, sources: [f] });
    expect(res).toHaveLength(1);
    const [r] = res as [IngestResult];
    expect(r.status).toBe('created');
    const rec = lib.records.get(r.recordId)!;
    expect(rec.tool).toBe('comfyui');
    expect(rec.prompt).toBe('a cat astronaut, cinematic light');
    expect(rec.params).toMatchObject({ seed: 12345, steps: 30, negative: 'blurry, worst quality' });
    expect(rec.ingestSource).toBe('auto-extract');
    expect(rec.needsManual).toEqual([]);
    expect(rec.artifacts[0]).toMatchObject({ storageMode: 'copy' });
    expect(readFileSync(rec.artifacts[0]!.path, 'utf8').length).toBeGreaterThan(0);

    const recipe = lib.recipes.get(rec.recipeId!)!;
    expect(recipe.kind).toBe('workflow-file');
    expect(recipe.name).toBe('cat');
    expect(recipe.tool).toBe('comfyui');
  });

  it('同工作流第二次入库归并到同一配方，不产生重复', () => {
    const first = ingestFiles({ lib, storage, sources: [write('one.png', comfyPng('px-a'))] });
    const second = ingestFiles({ lib, storage, sources: [write('two.png', comfyPng('px-b'))] });
    expect(lib.recipes.list()).toHaveLength(1);
    expect(second[0]!.recipeId).toBe(first[0]!.recipeId);
  });

  it('同一工作流改提示词/换 seed 入库：归并同一配方，各成一条记录且保留当次值', () => {
    const v1 = {
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'cat v1' } },
      '3': { class_type: 'KSampler', inputs: { seed: 111, steps: 20 } },
    };
    const v2 = {
      '6': { class_type: 'CLIPTextEncode', inputs: { text: 'dog v2 different prompt' } },
      '3': { class_type: 'KSampler', inputs: { seed: 999, steps: 20 } },
    };
    const a = ingestFiles({ lib, storage, sources: [write('a.png', comfyPngWith('p1', v1))] });
    const b = ingestFiles({ lib, storage, sources: [write('b.png', comfyPngWith('p2', v2))] });
    expect(lib.recipes.list()).toHaveLength(1);
    expect(b[0]!.recipeId).toBe(a[0]!.recipeId);
    expect(b[0]!.recordId).not.toBe(a[0]!.recordId);
    expect(lib.records.get(b[0]!.recordId)!.prompt).toBe('dog v2 different prompt');
    expect(lib.records.get(b[0]!.recordId)!.params).toMatchObject({ seed: 999 });
  });

  it('旧库存量原始配方（带 contentHash 或不带）自愈归并：不重复建配方', () => {
    const v1 = { '6': { class_type: 'CLIPTextEncode', inputs: { text: 'cat legacy' } }, '3': { class_type: 'KSampler', inputs: { seed: 7, steps: 20 } } };
    const file = write('legacy.png', comfyPngWith('p-legacy', v1));
    // 模拟改造前的入库产物：文件存原始内容，哈希为原始内容哈希（经 JSON 往返，与当时管线一致）
    const rawJson = JSON.parse(JSON.stringify(v1)) as unknown;
    const rawFile = storage.place(file, Buffer.from(canonicalJson(rawJson)), '.json').path;
    const legacy = lib.recipes.create({
      kind: 'workflow-file',
      name: 'legacy',
      tool: 'comfyui',
      workflowFilePath: rawFile,
      contentHash: sha256hex(Buffer.from(canonicalJson(rawJson))),
    });
    const res = ingestFiles({ lib, storage, sources: [write('c.png', comfyPngWith('p-newer', { ...v1, '6': { class_type: 'CLIPTextEncode', inputs: { text: 'changed' } } }))] });
    expect(lib.recipes.list()).toHaveLength(1);
    expect(res[0]!.recipeId).toBe(legacy.id);
  });

  it('同一文件重复入库：去重返回已存在记录，不新增', () => {
    const f = write('dup.png', comfyPng('px-dup'));
    const first = ingestFiles({ lib, storage, sources: [f] });
    const again = ingestFiles({ lib, storage, sources: [f] });
    expect(again[0]!.status).toBe('existing');
    expect(again[0]!.recordId).toBe(first[0]!.recordId);
    expect(lib.records.get(first[0]!.recordId)!.artifacts).toHaveLength(1);
  });

  it('存量无坐标模板文件：重复入库时把画布布局补回来，配方身份不变', () => {
    const ui = {
      nodes: [
        { id: 6, type: 'CLIPTextEncode', pos: [10, 20], widgets_values: ['a cat astronaut, cinematic light'] },
        { id: 3, type: 'KSampler', pos: [400, 50], widgets_values: [12345, 'fixed', 30] },
      ],
      links: [],
    };
    const png = Buffer.concat([PNG_SIG, IHDR, textChunk('workflow', JSON.stringify(ui)), pngChunk('IDAT', Buffer.from('px-ui')), IEND]);
    const f = write('ui.png', png);
    const first = ingestFiles({ lib, storage, sources: [f] });
    const recipe = lib.recipes.get(first[0]!.recipeId!)!;
    expect(readFileSync(recipe.workflowFilePath!, 'utf8')).toContain('"pos"');

    // 旧口径落盘的模板：坐标被一并剥掉，导出时节点全叠在原点
    const stripped = JSON.parse(readFileSync(recipe.workflowFilePath!, 'utf8')) as { nodes: Record<string, unknown>[] };
    for (const n of stripped.nodes) delete n['pos'];
    const legacyPath = recipe.workflowFilePath!;
    writeFileSync(legacyPath, canonicalJson(stripped));

    const again = ingestFiles({ lib, storage, sources: [f] });
    expect(again[0]!.status).toBe('existing');
    const healed = lib.recipes.get(recipe.id)!;
    expect(healed.contentHash).toBe(recipe.contentHash);
    // 补回的内容就是坐标版模板本身，内容寻址下回到同一文件
    expect(healed.workflowFilePath).toBe(legacyPath);
    expect(readFileSync(healed.workflowFilePath!, 'utf8')).toContain('"pos"');
  });

  it('同一次运行的多输出合并为 1 条记录 + N 个产物', () => {
    const res = ingestFiles({
      lib,
      storage,
      sources: [write('run-1.png', comfyPng('px-1')), write('run-2.png', comfyPng('px-2')), write('run-3.png', comfyPng('px-3'))],
    });
    expect(res).toHaveLength(1);
    const rec = lib.records.get(res[0]!.recordId)!;
    expect(rec.artifacts).toHaveLength(3);
    expect(lib.recipes.list()).toHaveLength(1);
  });

  it('同批次同模板但提示词不同：各成一条记录、同一配方，提示词都不丢', () => {
    const withPrompt = (t: string, p: string) => ({ ...apiPrompt, '6': { class_type: 'CLIPTextEncode', inputs: { text: p } }, '3': { class_type: 'KSampler', inputs: { ...apiPrompt['3'].inputs, seed: Number(t) } } });
    const res = ingestFiles({
      lib,
      storage,
      sources: [write('e1.png', comfyPngWith('px-e1', withPrompt('11', 'english prompt one'))), write('e2.png', comfyPngWith('px-e2', withPrompt('22', 'another prompt two')))],
    });
    expect(res).toHaveLength(2);
    expect(lib.recipes.list()).toHaveLength(1);
    const recs = res.map((r) => lib.records.get(r.recordId)!);
    expect(recs.map((r) => r.prompt)).toEqual(['english prompt one', 'another prompt two']);
    expect(recs.map((r) => r.params?.seed)).toEqual([11, 22]);
    expect(recs[0]!.artifacts).toHaveLength(1);
    expect(recs[1]!.artifacts).toHaveLength(1);
    expect(recs[0]!.recipeId).toBe(recs[1]!.recipeId);
  });

  it('reference 模式：记录指回原路径，不复制文件', () => {
    const refStorage = createStorage({ dataDir: join(root, 'data-ref'), mode: 'reference' });
    const f = write('ref.png', comfyPng('px-ref'));
    const res = ingestFiles({ lib, storage: refStorage, sources: [f] });
    const rec = lib.records.get(res[0]!.recordId)!;
    expect(rec.artifacts[0]).toMatchObject({ path: f, storageMode: 'reference' });
    expect(refStorage.stats().files).toBe(0);
  });

  it('解析不到的字段标 needs_manual，记录仍可见；显式字段优先', () => {
    const f = write('plain.png', plainPng('px-plain'));
    const res = ingestFiles({ lib, storage, sources: [f], explicit: { prompt: 'manually filled' } });
    const rec = lib.records.get(res[0]!.recordId)!;
    expect(rec.prompt).toBe('manually filled');
    const fields = (rec.needsManual ?? []).map((n) => n.field);
    expect(fields).toContain('tool');
    expect(fields).toContain('recipe');
    expect(fields).not.toContain('prompt');
  });

  it('needs_manual 带稳定 reasonCode（界面据此翻译），reason 仅作人类可读兜底', () => {
    const f = write('plain.png', plainPng('px-plain'));
    const res = ingestFiles({ lib, storage, sources: [f] });
    const rec = lib.records.get(res[0]!.recordId)!;
    const flags = rec.needsManual ?? [];
    expect(flags.length).toBeGreaterThan(0);
    for (const n of flags) {
      expect(NEEDS_MANUAL_CODES).toContain(n.reasonCode);
      expect(typeof n.reason).toBe('string');
    }
    expect(flags.find((n) => n.field === 'recipe')?.reasonCode).toBe('workflow_metadata_absent');
    expect(flags.find((n) => n.field === 'tool')?.reasonCode).toBe('tool_not_detected');
  });

  it('手动补录路径（1d）：无文件字段直接成记录，recipe:null 合法', () => {
    const res = ingestFiles({
      lib,
      storage,
      sources: [],
      explicit: { tool: 'kling', prompt: '云端工具无工作流', artifacts: [{ path: write('v.mp4', 'fake-video-bytes'), mediaType: 'video' }] },
    });
    expect(res).toHaveLength(1);
    const rec = lib.records.get(res[0]!.recordId)!;
    expect(rec.tool).toBe('kling');
    expect(rec.recipeId).toBeUndefined();
    expect(rec.artifacts[0]!.mediaType).toBe('video');
    expect(rec.ingestSource).toBe('manual');
  });

  it('先建后用：上传文件显式关联已有配方，记录挂上 recipe 且不再标 recipe 待补录', () => {
    const recipe = lib.recipes.create({ kind: 'workflow-file', name: '先建好的工作流', tool: 'comfyui' });
    const res = ingestFiles({
      lib,
      storage,
      sources: [write('plain2.png', plainPng('px-link'))],
      explicit: { tool: 'comfyui', prompt: 'linked', recipeId: recipe.id },
    });
    const rec = lib.records.get(res[0]!.recordId)!;
    expect(rec.recipeId).toBe(recipe.id);
    expect((rec.needsManual ?? []).map((n) => n.field)).not.toContain('recipe');
    expect(rec.workflowFilePath).toBeUndefined();
  });

  it('自动解析出的配方优先于显式 recipeId', () => {
    const other = lib.recipes.create({ kind: 'workflow-file', name: '无关配方' });
    const res = ingestFiles({
      lib,
      storage,
      sources: [write('auto.png', comfyPng('px-prio'))],
      explicit: { recipeId: other.id },
    });
    expect(res[0]!.recipeId).not.toBe(other.id);
    expect(lib.recipes.get(res[0]!.recipeId)!.name).toBe('auto');
  });

  it('手动补录（无源文件）也可关联已有配方', () => {
    const recipe = lib.recipes.create({ kind: 'prompt-template', name: '模板', prompt: 'p' });
    const res = ingestFiles({
      lib,
      storage,
      sources: [],
      explicit: { tool: 'kling', artifacts: [{ path: write('v2.mp4', 'fake') }], recipeId: recipe.id },
    });
    expect(lib.records.get(res[0]!.recordId)!.recipeId).toBe(recipe.id);
  });
});

describe('配方使用统计口径：纯工作流 JSON 不算一次生成', () => {
  it('先入生成图、再拖同工作流的 JSON 导出：配方 uses 仍为 1', () => {
    ingestFiles({ lib, storage, sources: [write('usage.png', comfyPng('px-usage'))] });
    const recipeId = lib.recipes.list()[0]!.id;
    expect(lib.records.stats(recipeId).uses).toBe(1);

    ingestFiles({ lib, storage, sources: [write('usage.json', JSON.stringify(apiPrompt))] });

    expect(lib.recipes.list()).toHaveLength(1);
    expect(lib.records.stats(recipeId).uses).toBe(1);
  });

  it('只拖工作流 JSON 属纯收藏建档：建配方但不产生生成记录', () => {
    const res = ingestFiles({ lib, storage, sources: [write('collect.json', JSON.stringify(apiPrompt))] });
    expect(lib.recipes.list()).toHaveLength(1);
    expect(lib.records.search({})).toHaveLength(0);
    expect(res[0]).toMatchObject({ status: 'collected', recipeId: lib.recipes.list()[0]!.id });
  });

  it('重复拖同一份工作流 JSON：按模板哈希命中同一配方，不新增配方', () => {
    const src = write('again.json', JSON.stringify(apiPrompt));
    ingestFiles({ lib, storage, sources: [src] });
    const recipeId = lib.recipes.list()[0]!.id;
    ingestFiles({ lib, storage, sources: [src] });
    expect(lib.recipes.list()).toHaveLength(1);
    expect(lib.recipes.list()[0]!.id).toBe(recipeId);
  });

  it('同批次图 + 其工作流 JSON：JSON 不当生成记录，批次内已建配方仍照常归并', () => {
    const res = ingestFiles({
      lib,
      storage,
      sources: [write('both.png', comfyPng('px-both')), write('wf.json', JSON.stringify(apiPrompt))],
    });
    const created = res.filter((r) => r.status === 'created');
    expect(created).toHaveLength(1);
    expect(lib.records.search({})).toHaveLength(1);
    expect(lib.records.get(created[0]!.recordId)!.artifacts).toHaveLength(1);
    expect(lib.recipes.list()).toHaveLength(1);
  });
});
