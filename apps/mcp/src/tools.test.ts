import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibrary } from '@was/core';
import { createTools } from './tools.js';

const root = join(tmpdir(), `was-mcp-${process.pid}`);
const dataDir = join(root, 'data');

let lib: ReturnType<typeof createLibrary>;
let tools: ReturnType<typeof createTools>;

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
  const api = JSON.stringify({
    '1': { class_type: 'CLIPTextEncode', inputs: { text: `mcp prompt ${tag}` } },
    '2': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal' } },
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const text = Buffer.concat([Buffer.from('prompt', 'latin1'), Buffer.from([0]), Buffer.from(api, 'latin1')]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crcChunk('IHDR', ihdr),
    crcChunk('tEXt', text),
    crcChunk('IDAT', Buffer.from(tag)),
    crcChunk('IEND', Buffer.alloc(0)),
  ]);
}

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  lib = createLibrary({ sqlite: ':memory:', dataDir });
  tools = createTools({ lib, dataDir });
});

const call = async (name: keyof ReturnType<typeof createTools>, args: Record<string, unknown> = {}) =>
  (tools[name] as (a: Record<string, unknown>) => unknown)(args);

const ids: { recordId: string; recipeId: string } = { recordId: '', recipeId: '' };

describe('MCP 工具面（docs §7）', () => {
  it('TOOL_SPECS 暴露约定的六个工具', () => {
    expect(tools.TOOL_SPECS.map((t) => t.name).sort()).toEqual(
      ['get_generation', 'get_recipe', 'ingest', 'list_recipes', 'record_stats', 'search_generations'].sort(),
    );
  });

  it('ingest 自动解析入库并返回摘要', async () => {
    const src = join(root, 'src', 'shot.png');
    writeFileSync(src, comfyPng('mcp-px-1'));
    const r = (await call('ingest', { files: [src] })) as { status: string; created: number; record_ids: string[] };
    expect(r.status).toBe('ok');
    expect(r.created).toBe(1);
    ids.recordId = r.record_ids[0]!;
    ids.recipeId = lib.records.get(ids.recordId)!.recipeId!;
  });

  it('search_generations 返回摘要（不含产物明细），支持过滤', async () => {
    const r = (await call('search_generations', { query: 'mcp prompt' })) as { results: Record<string, unknown>[] };
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toMatchObject({ id: ids.recordId, tool: 'comfyui', prompt: 'mcp prompt mcp-px-1' });
    expect(r.results[0]).not.toHaveProperty('artifacts');
    expect((await call('search_generations', { has_recipe: true })) as { results: unknown[] }).toBeTruthy();
  });

  it('get_generation 返回完整溯源，未知 id 报错', async () => {
    const full = (await call('get_generation', { id: ids.recordId })) as Record<string, unknown>;
    expect(full).toMatchObject({ id: ids.recordId, tool: 'comfyui' });
    expect(full.artifacts).toHaveLength(1);
    await expect(call('get_generation', { id: 'ghost' })).rejects.toThrow(/不存在/);
  });

  it('list_recipes / get_recipe / record_stats 走配方维度', async () => {
    const lr = (await call('list_recipes')) as { results: { id: string }[] };
    expect(lr.results.map((x) => x.id)).toContain(ids.recipeId);
    const gr = (await call('get_recipe', { id: ids.recipeId })) as Record<string, unknown>;
    expect(gr).toMatchObject({ id: ids.recipeId, kind: 'workflow-file', tool: 'comfyui' });
    const st = (await call('record_stats', { recipe_id: ids.recipeId })) as Record<string, unknown>;
    expect(st).toMatchObject({ recipe_id: ids.recipeId, count: 1, last_used_at: expect.any(Number) });
  });

  it('reference 模式入库不复制文件', async () => {
    const src = join(root, 'src', 'ref.png');
    writeFileSync(src, comfyPng('mcp-px-ref'));
    const r = (await call('ingest', { files: [src], mode: 'reference' })) as { status: string; created: number; record_ids: string[] };
    expect(r.status).toBe('ok');
    const rec = lib.records.get(r.record_ids[0]!)!;
    expect(rec.artifacts[0]).toMatchObject({ path: src, storageMode: 'reference' });
  });

  it('ingest 对不可读文件返回错误而不是抛栈', async () => {
    const r = (await call('ingest', { files: [join(root, 'src', 'missing.png')] })) as { status: string };
    expect(r.status).toBe('error');
  });
});
