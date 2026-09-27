import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createLibrary, DomainError, type Library } from './index.js';

const root = join(tmpdir(), `was-trash-${process.pid}`);
const srcDir = join(root, 'src');

const opened: Library[] = [];

function openLib(name: string): Library {
  const lib = createLibrary({ dataDir: join(root, name) });
  opened.push(lib);
  return lib;
}

let lib: Library;

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(srcDir, { recursive: true });
});

beforeEach(() => {
  lib = openLib(`data-${Math.random().toString(16).slice(2)}`);
});

afterAll(() => {
  for (const l of opened) l.close();
  rmSync(root, { recursive: true, force: true });
});

/** 写入一个源文件并以默认 copy 模式入库，返回记录 id 与库内产物绝对路径 */
function ingestFile(name: string, bytes = 'png-bytes', explicit = { tool: 'comfyui', prompt: 'p' }) {
  const src = join(srcDir, name);
  writeFileSync(src, bytes);
  const [res] = lib.ingest({ sources: [src], explicit });
  const rec = lib.records.get(res!.recordId!)!;
  return { recordId: rec.id, artifactPath: rec.artifacts[0]!.path };
}

const workflow = {
  '1': { class_type: 'CLIPTextEncode', inputs: { text: 'trash prompt' } },
  '2': { class_type: 'KSampler', inputs: { seed: 3, steps: 20 } },
};

function recipeWithFile(name: string, content = workflow) {
  const src = join(srcDir, name);
  writeFileSync(src, JSON.stringify(content));
  return lib.createRecipeWithFile({ name, tool: 'comfyui', filePath: src });
}

describe('生成记录软删除', () => {
  it('trash 后从列表/检索口径消失，get 仍带 deletedAt', () => {
    const { recordId } = ingestFile('t1.png');
    expect(lib.records.trash([recordId])).toBe(1);

    expect(lib.records.search({})).toHaveLength(0);
    expect(lib.records.listTrash().map((r) => r.id)).toContain(recordId);
    expect(lib.records.countTrash()).toBe(1);
    expect(lib.records.get(recordId)!.deletedAt).toBeTypeOf('number');
  });

  it('重复 trash 与未知 id 不计入；restore 回到库中', () => {
    const { recordId } = ingestFile('t2.png');
    lib.records.trash([recordId]);
    expect(lib.records.trash([recordId])).toBe(0);
    expect(lib.records.trash(['ghost'])).toBe(0);

    const back = lib.records.restore(recordId);
    expect(back.deletedAt).toBeUndefined();
    expect(lib.records.search({}).map((r) => r.id)).toContain(recordId);
    expect(lib.records.countTrash()).toBe(0);
    expect(() => lib.records.restore('ghost')).toThrow(DomainError);
  });

  it('回收站中的记录不占配方使用统计，恢复后重新计入', () => {
    const { recipe } = recipeWithFile('wf-stats.json');
    const rec = lib.records.create({
      tool: 'comfyui',
      recipeId: recipe.id,
      artifacts: [{ path: join(srcDir, 'a.png'), mediaType: 'image' }],
    });
    expect(lib.records.stats(recipe.id).uses).toBe(1);
    lib.records.trash([rec.id]);
    expect(lib.records.stats(recipe.id)).toMatchObject({ uses: 0, lastUsedAt: null });
    expect(lib.records.listByRecipe(recipe.id)).toHaveLength(0);
    lib.records.restore(rec.id);
    expect(lib.records.stats(recipe.id).uses).toBe(1);
    expect(lib.records.listByRecipe(recipe.id)).toHaveLength(1);
  });

  it('同内容文件在记录进回收站后可重新入库为新记录，不被去重吃掉', () => {
    const a = ingestFile('dup.png', 'same-bytes');
    lib.records.trash([a.recordId]);
    const b = ingestFile('dup-again.png', 'same-bytes');
    expect(b.recordId).not.toBe(a.recordId);
    expect(lib.records.search({})).toHaveLength(1);
  });
});

describe('彻底删除回收站中的生成记录', () => {
  it('purge 删除记录行与库内 copy 产物文件', () => {
    const { recordId, artifactPath } = ingestFile('purge.png', 'unique-purge-bytes');
    expect(existsSync(artifactPath)).toBe(true);
    lib.records.trash([recordId]);
    lib.purgeRecord(recordId);

    expect(lib.records.get(recordId)).toBeUndefined();
    expect(lib.records.listTrash()).toHaveLength(0);
    expect(existsSync(artifactPath)).toBe(false);
  });

  it('未先进回收站也可直接 purge；外链（reference）产物只删记录不动原文件', () => {
    const outside = join(srcDir, 'outside.mp4');
    writeFileSync(outside, 'keep-me');
    const rec = lib.records.create({ tool: 'kling', artifacts: [{ path: outside, mediaType: 'video', storageMode: 'reference' }] });
    lib.purgeRecord(rec.id);
    expect(lib.records.get(rec.id)).toBeUndefined();
    expect(existsSync(outside)).toBe(true);
  });

  it('两条记录共用同一内容寻址文件时，purge 单条不删掉对方文件', () => {
    const src = join(srcDir, 'share.png');
    writeFileSync(src, 'shared-bytes');
    const placed = lib.storage.place(src);
    const a = lib.records.create({ tool: 'x', artifacts: [{ path: placed.path, mediaType: 'image', storageMode: 'copy', fileHash: 'h-a' }] });
    const b = lib.records.create({ tool: 'x', artifacts: [{ path: placed.path, mediaType: 'image', storageMode: 'copy', fileHash: 'h-b' }] });
    lib.purgeRecord(b.id);
    expect(existsSync(placed.path)).toBe(true);
    expect(lib.records.get(a.id)!.artifacts[0]!.path).toBe(placed.path);
    lib.purgeRecord(a.id);
    expect(existsSync(placed.path)).toBe(false);
  });

  it('未知 id 抛 record_not_found', () => {
    expect(() => lib.purgeRecord('ghost')).toThrow(/生成记录不存在/);
  });
});

describe('生成配方软删除', () => {
  it('trash 后配方列表/检索/哈希归并都不再命中，记录仍保留 recipeId', () => {
    const { recipe } = recipeWithFile('wf-trash.json');
    const rec = lib.records.create({
      tool: 'comfyui',
      recipeId: recipe.id,
      artifacts: [{ path: join(srcDir, 'r.png'), mediaType: 'image' }],
    });
    expect(lib.recipes.trash([recipe.id])).toBe(1);

    expect(lib.recipes.list().map((r) => r.id)).not.toContain(recipe.id);
    expect(lib.recipes.search({})).toHaveLength(0);
    expect(lib.recipes.findByContentHash(recipe.contentHash!)).toBeUndefined();
    expect(lib.recipes.get(recipe.id)!.deletedAt).toBeTypeOf('number');
    expect(lib.recipes.listTrash().map((r) => r.id)).toContain(recipe.id);
    expect(lib.records.get(rec.id)!.recipeId).toBe(recipe.id);
  });

  it('restore 后重新可见并可被同名模板归并', () => {
    const { recipe } = recipeWithFile('wf-restore.json');
    lib.recipes.trash([recipe.id]);
    lib.recipes.restore(recipe.id);
    expect(lib.recipes.list().map((r) => r.id)).toContain(recipe.id);
    expect(lib.recipes.findByContentHash(recipe.contentHash!)!.id).toBe(recipe.id);
  });

  it('回收站中的配方不参与入库归并：同模板再挂会新建配方，原件留在回收站', () => {
    const { recipe } = recipeWithFile('wf-merge.json');
    lib.recipes.trash([recipe.id]);
    const again = recipeWithFile('wf-merge-copy.json');
    expect(again.recipe.id).not.toBe(recipe.id);
    expect(lib.recipes.listTrash().map((r) => r.id)).toContain(recipe.id);
  });

  it('同模板配方已在库时 restore 抛 recipe_restore_conflict，原件仍留在回收站', () => {
    const { recipe } = recipeWithFile('wf-clash.json');
    lib.recipes.trash([recipe.id]);
    const again = recipeWithFile('wf-clash-copy.json');
    expect(again.recipe.contentHash).toBe(recipe.contentHash);

    let err: unknown;
    try {
      lib.recipes.restore(recipe.id);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('recipe_restore_conflict');
    expect(lib.recipes.list().map((r) => r.id)).toEqual([again.recipe.id]);
    expect(lib.recipes.get(recipe.id)!.deletedAt).toBeTypeOf('number');
  });

  it('purge 配方：删除行与独占的工作流文件，关联记录的 recipe_id 置空', () => {
    const { recipe } = recipeWithFile('wf-purge.json');
    const rec = lib.records.create({
      tool: 'comfyui',
      recipeId: recipe.id,
      artifacts: [{ path: join(srcDir, 'x.png'), mediaType: 'image' }],
    });
    lib.purgeRecipe(recipe.id);

    expect(lib.recipes.get(recipe.id)).toBeUndefined();
    expect(existsSync(recipe.workflowFilePath!)).toBe(false);
    expect(lib.records.get(rec.id)!.recipeId).toBeUndefined();
  });

  it('副本配方共享工作流文件时，原件先 purge 不删掉副本要用的文件', () => {
    const { recipe } = recipeWithFile('wf-shared.json');
    const copy = lib.recipes.create({ kind: 'workflow-file', name: '副本', tool: 'comfyui', workflowFilePath: recipe.workflowFilePath });
    lib.purgeRecipe(recipe.id);
    expect(existsSync(copy.workflowFilePath!)).toBe(true);
  });

  it('未知 id 抛 recipe_not_found', () => {
    expect(() => lib.purgeRecipe('ghost')).toThrow(/配方不存在/);
    expect(() => lib.recipes.restore('ghost')).toThrow(DomainError);
  });
});

describe('旧库升级：deleted_at 列自动补齐', () => {
  it('无 deleted_at 列的库打开后可直接进回收站', () => {
    const dir = join(root, 'legacy');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'asset-store.db');
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE recipes (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, tool TEXT,
        workflow_file_path TEXT, prompt TEXT, params TEXT, tags TEXT NOT NULL DEFAULT '[]',
        content_hash TEXT, owner TEXT NOT NULL DEFAULT 'local', created_at REAL NOT NULL
      );
      CREATE TABLE generation_records (
        id TEXT PRIMARY KEY, tool TEXT NOT NULL, recipe_id TEXT REFERENCES recipes(id), prompt TEXT,
        params TEXT, workflow_file_path TEXT, note TEXT, tags TEXT NOT NULL DEFAULT '[]',
        needs_manual TEXT, ingest_source TEXT, owner TEXT NOT NULL DEFAULT 'local', created_at REAL NOT NULL
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES generation_records(id), path TEXT NOT NULL,
        media_type TEXT NOT NULL, storage_mode TEXT, file_hash TEXT, created_at REAL NOT NULL
      );
    `);
    raw.close();

    const upgraded = openLib('legacy');
    const rec = upgraded.records.create({ tool: 'comfyui', artifacts: [{ path: join(srcDir, 'l.png'), mediaType: 'image' }] });
    expect(rec.deletedAt).toBeUndefined();
    upgraded.records.trash([rec.id]);
    expect(upgraded.records.search({})).toHaveLength(0);
    expect(upgraded.records.listTrash().map((r) => r.id)).toContain(rec.id);
    expect(readFileSync(file).length).toBeGreaterThan(0);
  });
});
