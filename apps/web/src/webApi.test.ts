import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibrary, type Library } from '@was/core';
import { createWebApi, type WebApi } from './webApi.js';

const root = join(tmpdir(), `was-web-${process.pid}`);
const dataDir = join(root, 'data');
const srcDir = join(root, 'src');

let lib: Library;
let api: WebApi;

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(dataDir, 'files'), { recursive: true });
  mkdirSync(srcDir, { recursive: true });
});

beforeEach(() => {
  lib = createLibrary({ sqlite: ':memory:', dataDir });
  api = createWebApi({ lib, dataDir });
});

function crcChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  let c = -1;
  for (const b of body) {
    let x = c ^ b;
    for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1;
    c = x;
  }
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(~c >>> 0);
  return Buffer.concat([len, body, crc]);
}

function comfyPng(tag: string): Buffer {
  const apiJson = JSON.stringify({
    '1': { class_type: 'CLIPTextEncode', inputs: { text: `web prompt ${tag}` } },
    '2': { class_type: 'KSampler', inputs: { seed: Number(tag.replace(/\D/g, '')) || 7, steps: 21, cfg: 5 } },
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const text = Buffer.concat([Buffer.from('prompt', 'latin1'), Buffer.from([0]), Buffer.from(apiJson, 'latin1')]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crcChunk('IHDR', ihdr),
    crcChunk('tEXt', text),
    crcChunk('IDAT', Buffer.from(tag)),
    crcChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('列表与检索', () => {
  it('空库返回空列表', async () => {
    expect(await api.listRecords({})).toMatchObject({ records: [], total: 0 });
  });

  it('卡片含缩略图 url、产物数、配方与待补录标记；search/filter 参数生效', async () => {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(comfyPng('px-web-1'))], { type: 'image/png' }), 'shot.png');
    await api.ingestUpload(form);
    const all = await api.listRecords({});
    expect(all.total).toBe(1);
    const card = all.records[0]!;
    expect(card).toMatchObject({ tool: 'comfyui', prompt: 'web prompt px-web-1', artifactCount: 1, needsManual: [] });
    expect(card.thumbUrl).toContain('/api/files/');
    expect(card.detailUrl).toBe(`/records/${card.id}`);

    expect((await api.listRecords({ query: 'no-hit' })).total).toBe(0);
    expect((await api.listRecords({ query: 'px-web' })).total).toBe(1);
    expect((await api.listRecords({ tool: 'kling' })).total).toBe(0);
  });

  it('未知记录：getRecord 抛错，getRecordSafe 返回 null', async () => {
    expect(() => api.getRecord('ghost')).toThrow(/不存在/);
    expect(await api.getRecordSafe('ghost')).toBeNull();
  });
});

describe('文件读取边界', () => {
  it('data 目录内的文件可读，越界路径拒绝', async () => {
    writeFileSync(join(dataDir, 'files', 'ok.png'), 'x');
    expect(await api.readLibraryFile('files/ok.png')).not.toBeNull();
    expect(await api.readLibraryFile('../../etc/passwd')).toBeNull();
    expect(await api.readLibraryFile('../secret.txt')).toBeNull();
    expect(await api.readLibraryFile('nope.png')).toBeNull();
    // /api/files 解析口同样接受 data 内相对段（卡片缩略图 URL 形态）
    expect((await api.resolveFileParam('files/ok.png'))?.bytes.toString()).toBe('x');
    expect(await api.resolveFileParam('../secret.txt')).toBeNull();
  });

  it('外链产物仅当已登记在库中才可读取（防任意文件读取）', async () => {
    const outside = join(srcDir, 'registered.mp4');
    writeFileSync(outside, 'video-bytes');
    const rec = lib.records.create({ tool: 'kling', artifacts: [{ path: outside, mediaType: 'video', storageMode: 'reference' }] });
    const hit = await api.readArtifactFor(rec.id, 0);
    expect(hit?.bytes.toString()).toBe('video-bytes');
    expect(await api.readArtifactFor(rec.id, 9)).toBeNull();
    const forged = lib.records.get(rec.id)!;
    expect(await api.readArtifactFor(forged.id, 0)).not.toBeNull();
    // 未登记的绝对路径不能通过库内接口读取
    expect(await api.readLibraryFile(outside)).toBeNull();
    // /api/files 解析口：已登记外链可读，未登记拒绝
    expect((await api.resolveFileParam(outside.replaceAll('\\', '/')))?.bytes.toString()).toBe('video-bytes');
    const sneaky = join(srcDir, 'sneaky.txt');
    writeFileSync(sneaky, 'secret');
    expect(await api.resolveFileParam(sneaky.replaceAll('\\', '/'))).toBeNull();
  });
});

describe('上传入库与手动补录', () => {
  it('FormData 上传走自动解析：同批不同提示词各成记录但归并同一配方', async () => {
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(comfyPng('px-web-a1'))], { type: 'image/png' }), 'a.png');
    form.append('files', new Blob([new Uint8Array(comfyPng('px-web-b2'))], { type: 'image/png' }), 'b.png');
    const r = await api.ingestUpload(form);
    // 两张图提示词/seed 不同 → 两次运行，各成记录；模板相同 → 一个配方
    expect(r.created).toBe(2);
    expect(lib.recipes.list()).toHaveLength(1);
    expect(r.record_ids).toHaveLength(2);
    const recA = lib.records.get(r.record_ids[0]!)!;
    const recB = lib.records.get(r.record_ids[1]!)!;
    expect(recA.prompt).toBe('web prompt px-web-a1');
    expect(recB.prompt).toBe('web prompt px-web-b2');
    expect(recA.recipeId).toBe(recB.recipeId);
    // 之后单独再传一张改提示词的：新记录、同配方
    const form2 = new FormData();
    form2.append('files', new Blob([new Uint8Array(comfyPng('px-web-c3'))], { type: 'image/png' }), 'c.png');
    const r2 = await api.ingestUpload(form2);
    expect(r2.created).toBe(1);
    expect(lib.recipes.list()).toHaveLength(1);
    const recC = lib.records.get(r2.record_ids[0]!)!;
    expect(recC.prompt).toBe('web prompt px-web-c3');
    expect(recC.recipeId).toBe(recA.recipeId);
  });

  it('同一次运行的多输出（同提示词同 seed）上传合并为 1 记录 2 产物', async () => {
    const same = (tag: string) => {
      const apiJson = JSON.stringify({
        '1': { class_type: 'CLIPTextEncode', inputs: { text: 'one run two outputs' } },
        '2': { class_type: 'KSampler', inputs: { seed: 7, steps: 21, cfg: 5 } },
      });
      const ihdr = Buffer.alloc(13);
      ihdr.writeUInt32BE(8, 0);
      ihdr.writeUInt32BE(8, 4);
      ihdr[8] = 8;
      ihdr[9] = 2;
      const text = Buffer.concat([Buffer.from('prompt', 'latin1'), Buffer.from([0]), Buffer.from(apiJson, 'latin1')]);
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        crcChunk('IHDR', ihdr),
        crcChunk('tEXt', text),
        crcChunk('IDAT', Buffer.from(tag)),
        crcChunk('IEND', Buffer.alloc(0)),
      ]);
    };
    const form = new FormData();
    form.append('files', new Blob([new Uint8Array(same('batch-1'))], { type: 'image/png' }), 'o1.png');
    form.append('files', new Blob([new Uint8Array(same('batch-2'))], { type: 'image/png' }), 'o2.png');
    const r = await api.ingestUpload(form);
    expect(r.created).toBe(1);
    expect(lib.records.get(r.record_ids[0]!)!.artifacts).toHaveLength(2);
  });

  it('拖入 ComfyUI 工作流 JSON：只算收藏配方，不计入生成记录与使用统计', async () => {
    const apiFlow = JSON.stringify({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'web prompt px-1' } },
      '2': { class_type: 'KSampler', inputs: { seed: 1, steps: 21, cfg: 5 } },
    });
    const form = new FormData();
    form.append('files', new Blob([apiFlow], { type: 'application/json' }), 'wf.json');
    const r = await api.ingestUpload(form);
    expect(r).toMatchObject({ created: 0, collected_recipes: 1, record_ids: [] });
    expect(lib.recipes.list()).toHaveLength(1);
    const recipeId = lib.recipes.list()[0]!.id;
    expect(api.recipeStats(recipeId).uses).toBe(0);

    // 再传该工作流真实生成的图：记录 +1、使用次数 +1，且不产生第二个配方
    const form2 = new FormData();
    form2.append('files', new Blob([new Uint8Array(comfyPng('px-1'))], { type: 'image/png' }), 'g.png');
    const r2 = await api.ingestUpload(form2);
    expect(r2).toMatchObject({ created: 1, collected_recipes: 0 });
    expect(lib.recipes.list()).toHaveLength(1);
    expect(api.recipeStats(recipeId).uses).toBe(1);
  });

  it('手动补录（1d）：引用本机路径建记录，recipe 为空合法', async () => {    const f = join(srcDir, 'cloud.mp4');
    writeFileSync(f, 'fake');
    const rec = await api.createManualRecord({ tool: 'kling', prompt: '可灵生成', paths: [f] });
    expect(rec.tool).toBe('kling');
    expect(rec.recipeId).toBeUndefined();
    expect(rec.ingestSource).toBe('manual');
    expect(rec.artifacts[0]).toMatchObject({ path: f, mediaType: 'video', storageMode: 'reference' });
  });

  it('待补录队列：列出并补录后清除标记', async () => {
    const plainPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      crcChunk('IHDR', Buffer.alloc(13)),
      crcChunk('IDAT', Buffer.from('plain')),
      crcChunk('IEND', Buffer.alloc(0)),
    ]);
    const form2 = new FormData();
    form2.append('files', new Blob([plainPng], { type: 'image/png' }), 'plain.png');
    const r = await api.ingestUpload(form2);
    const rec = lib.records.get(r.record_ids[0]!)!;
    const flagged = rec.needsManual!.map((n) => n.field);
    expect(flagged.length).toBeGreaterThan(0);
    expect((await api.listIncomplete()).map((x) => x.id)).toContain(rec.id);

    // 补齐所有待补录字段后离开队列
    await api.patchRecord(rec.id, { tool: 'comfyui', prompt: '手动补的提示词', resolve: flagged });
    const out = (await api.listIncomplete()).map((x) => x.id);
    expect(out).not.toContain(rec.id);
    expect((await api.listRecords({ hasRecipe: false })).records.map((x) => x.id)).toContain(rec.id);
  });
});

describe('配方先建后用', () => {
  it('createRecipe 三种形态：workflow-file 允许暂无文件', async () => {
    const wf = api.createRecipe({ name: '先建的工作流', kind: 'workflow-file', tool: 'comfyui' });
    expect(wf.workflowFilePath).toBe('');
    const tpl = api.createRecipe({ name: '提示词模板', kind: 'prompt-template', prompt: 'a cat' });
    expect(tpl.prompt).toBe('a cat');
    const preset = api.createRecipe({ name: '参数预设', kind: 'param-preset', params: { steps: 30 } });
    expect(preset.params).toEqual({ steps: 30 });
    expect(() => api.createRecipe({ name: '缺内容', kind: 'prompt-template' })).toThrow(/缺少必填内容/);
  });

  it('attachWorkflowFile：JSON 规范化落库并回填路径与哈希', async () => {
    const wf = api.createRecipe({ name: '待补文件', kind: 'workflow-file' });
    const file = new Blob(['{ "2": {"b": 1}, "1": {"a": 2} }'], { type: 'application/json' });
    const filled = await api.attachWorkflowFile(wf.id, file, 'my workflow.json');
    expect(filled.workflowFilePath).toBeTruthy();
    expect(filled.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // 规范化：键排序后存库
    expect(JSON.parse(readFileSync(filled.workflowFilePath!, 'utf8'))).toEqual({ '1': { a: 2 }, '2': { b: 1 } });
    // 同名哈希可被归并检索到
    expect(lib.recipes.findByContentHash(filled.contentHash!)?.id).toBe(wf.id);
  });

  it('attachWorkflowFile 拒绝非 JSON 与非 workflow-file 配方', async () => {
    const wf = api.createRecipe({ name: 'x', kind: 'workflow-file' });
    await expect(api.attachWorkflowFile(wf.id, new Blob(['not json'], { type: 'text/plain' }), 'a.txt')).rejects.toThrow(/JSON/);
    const tpl = api.createRecipe({ name: 'y', kind: 'prompt-template', prompt: 'p' });
    await expect(api.attachWorkflowFile(tpl.id, new Blob(['{}'], { type: 'application/json' }), 'a.json')).rejects.toThrow(/配方/);
  });

  it('上传时带 recipeId：无元数据文件直接挂到已有配方，不进 recipe 待补录', async () => {
    const wf = api.createRecipe({ name: '关联目标', kind: 'workflow-file', tool: 'comfyui' });
    const plainPng = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      crcChunk('IHDR', Buffer.alloc(13)),
      crcChunk('IDAT', Buffer.from('plain-link')),
      crcChunk('IEND', Buffer.alloc(0)),
    ]);
    const form = new FormData();
    form.append('files', new Blob([plainPng], { type: 'image/png' }), 'shot2.png');
    form.append('tool', 'comfyui');
    form.append('prompt', 'linked shot');
    form.append('recipeId', wf.id);
    const r = await api.ingestUpload(form);
    const rec = lib.records.get(r.record_ids[0]!)!;
    expect(rec.recipeId).toBe(wf.id);
    expect((rec.needsManual ?? []).map((n) => n.field)).not.toContain('recipe');
  });

  it('手动补录与编辑记录可关联已有配方', async () => {
    const wf = api.createRecipe({ name: '手动关联', kind: 'workflow-file' });
    const f = join(srcDir, 'cloud2.mp4');
    writeFileSync(f, 'fake');
    const rec = api.createManualRecord({ tool: 'kling', paths: [f], recipeId: wf.id });
    expect(rec.recipeId).toBe(wf.id);
    const f2 = join(srcDir, 'cloud3.mp4');
    writeFileSync(f2, 'fake2');
    const rec2 = api.createManualRecord({ tool: 'kling', paths: [f2] });
    expect(rec2.recipeId).toBeUndefined();
    api.patchRecord(rec2.id, { recipeId: wf.id });
    expect(lib.records.get(rec2.id)!.recipeId).toBe(wf.id);
  });
});

describe('配方复制与导出', () => {
  const comfyApiJson = JSON.stringify({
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'old prompt' } },
    '2': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } },
  });

  async function recipeWithWorkflow(name = '可导出配方') {
    const wf = api.createRecipe({ name, kind: 'workflow-file', tool: 'comfyui' });
    return api.attachWorkflowFile(wf.id, new Blob([comfyApiJson], { type: 'application/json' }), 'w.json');
  }

  it('duplicateRecipe：副本换名、共享文件路径、不带 contentHash 避免归并回原件', async () => {
    const wf = await recipeWithWorkflow();
    const copy = api.duplicateRecipe(wf.id);
    expect(copy.id).not.toBe(wf.id);
    expect(copy.name).toBe('可导出配方 副本');
    expect(copy.workflowFilePath).toBe(wf.workflowFilePath);
    expect(copy.contentHash).toBeUndefined();
    const tplCopy = api.duplicateRecipe(api.createRecipe({ name: 't', kind: 'prompt-template', prompt: 'hello' }).id);
    expect(tplCopy.prompt).toBe('hello');
  });

  it('exportWorkflow：默认导出模板（无 record 时提示词回填为空、seed 兜底）；带 recordId 注入当次提示词与 seed', async () => {
    const wf = await recipeWithWorkflow();
    const plain = api.exportWorkflow(wf.id);
    expect(JSON.parse(plain!.text)['1'].inputs.text).toBe('');
    expect(typeof JSON.parse(plain!.text)['2'].inputs.seed).toBe('number');
    expect(plain!.filename).toContain('.json');

    // 同模板内容补挂到另一配方：按归并口径返回对方，不产生第二份文件
    const dupDraft = api.createRecipe({ name: '重复模板', kind: 'workflow-file', tool: 'comfyui' });
    const merged = await api.attachWorkflowFile(dupDraft.id, new Blob([comfyApiJson], { type: 'application/json' }), 'w.json');
    expect(merged.id).toBe(wf.id);

    // 模板配方（自动入库产生）：无参数导出保持原文；带 recordId 回填当次值
    const otherTemplate = JSON.stringify({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'other negative base' } },
      '2': { class_type: 'KSampler', inputs: { seed: 1, steps: 40 } },
    });
    const tpl = api.createRecipe({ name: '模板配方', kind: 'workflow-file', tool: 'comfyui' });
    await api.attachWorkflowFile(tpl.id, new Blob([otherTemplate], { type: 'application/json' }), 'w.json');
    const rec = lib.records.create({
      tool: 'comfyui',
      recipeId: tpl.id,
      prompt: 'cat astronaut',
      params: { seed: 777, steps: 25 },
      artifacts: [{ path: join(srcDir, 'x.png'), mediaType: 'image' }],
    });
    const injected = JSON.parse(api.exportWorkflow(tpl.id, { recordId: rec.id })!.text);
    expect(injected['1'].inputs.text).toBe('cat astronaut');
    expect(injected['2'].inputs.seed).toBe(777);
    expect(injected['2'].inputs.steps).toBe(40);
    // 无配方文件时导出为 null
    const bare = api.createRecipe({ name: '无文件', kind: 'workflow-file' });
    expect(api.exportWorkflow(bare.id)).toBeNull();
  });

  it('带参导出兼容 UI 格式（nodes 数组）', async () => {
    const uiJson = JSON.stringify({
      nodes: [
        { id: 3, type: 'CLIPTextEncode', widgets_values: ['old', 'neg'] },
        { id: 5, type: 'KSampler', widgets_values: [1, 'fixed', 2, 20, 8, 'dpmpp_2m', 'karras', 0, 1] },
      ],
    });
    const wf = api.createRecipe({ name: 'UI格式', kind: 'workflow-file' });
    await api.attachWorkflowFile(wf.id, new Blob([uiJson], { type: 'application/json' }), 'ui.json');
    const filled = api.exportWorkflow(wf.id, { prompt: 'new text', params: { seed: 99 } })!;
    const parsed = JSON.parse(filled.text);
    expect(parsed.nodes[0].widgets_values[0]).toBe('new text');
    expect(parsed.nodes[1].widgets_values[0]).toBe(99);
  });
});
