import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { Library } from '../index.js';
import type { ArtifactMediaType, NeedsManualField } from '../domain/types.js';
import { extractComfyui, sha256hex, sniffSource, type ExtractResult } from '../extractors/index.js';
import { matchOrPlace } from '../recipes/recipeTemplate.js';
import type { Storage } from '../storage/storage.js';

export interface IngestExplicit {
  tool?: string;
  prompt?: string;
  note?: string;
  params?: Record<string, unknown>;
  artifacts?: { path: string; mediaType?: ArtifactMediaType }[];
  /** 先建后挂：显式关联已有配方；自动解析出的配方优先 */
  recipeId?: string;
}

export interface IngestResult {
  /** collected：源文件是裸工作流清单，只归并成配方，没有对应的生成记录 */
  status: 'created' | 'existing' | 'collected';
  recordId?: string;
  recipeId?: string;
  files: string[];
}

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);

const mediaTypeOf = (p: string): ArtifactMediaType => (VIDEO_EXT.has(extname(p).toLowerCase()) ? 'video' : 'image');
const titleOf = (p: string) => basename(p, extname(p));
/** 工作流清单：ComfyUI 导出的 .json 本身就是配方内容，不是任何一次生成的输出物 */
const isWorkflowManifest = (p: string) => extname(p).toLowerCase() === '.json';

interface Item {
  file: string;
  hash: string;
  extract?: ExtractResult;
  recipeId?: string;
  needsManual: NeedsManualField[];
}

/** 按工作流模板哈希归并；命中已有模板则复用配方，未命中才落盘新建（口径收口在 recipes/recipeTemplate） */
function ensureRecipe(lib: Library, storage: Storage, file: string, extract: ExtractResult): string | undefined {
  if (!extract.contentHash || extract.recipeContent === undefined) return undefined;
  return matchOrPlace(lib.recipes, storage, {
    template: extract.recipeContent,
    contentHash: extract.contentHash,
    srcFile: file,
    name: titleOf(file),
    tool: 'comfyui',
  }).recipeId;
}

/**
 * 同一次运行的判据：同配方 + 同当次提示词/负向/seed。
 * 只按配方归并会把"同一工作流改了提示词的多张图"压成 1 条记录，除首条外其余提示词全部丢失。
 */
function runKeyOf(item: Item): string {
  if (!item.extract) return `file:${item.file}`;
  const seed = item.extract.params?.seed;
  const runSeed = typeof seed === 'number' || typeof seed === 'string' ? seed : '';
  // 解析出提示词但无配方（如纯提示词图）时按文件独立成记录，避免互相误并
  return `run:${item.recipeId ?? item.file}|${item.extract.prompts?.[0] ?? ''}|${item.extract.negative ?? ''}|${runSeed}`;
}

export function ingestFiles(options: {
  lib: Library;
  storage: Storage;
  sources: string[];
  explicit?: IngestExplicit;
}): IngestResult[] {
  const { lib, storage, explicit } = options;
  const results: IngestResult[] = [];

  // 1d 手动补录：无源文件，显式字段直接成记录（reference 安置，recipe:null 合法）
  if (options.sources.length === 0) {
    if (!explicit?.artifacts?.length) return results;
    const artifacts = explicit.artifacts.map((a) => ({
      path: a.path,
      mediaType: a.mediaType ?? mediaTypeOf(a.path),
      storageMode: 'reference' as const,
      fileHash: sha256hex(readFileSync(a.path)),
    }));
    const rec = lib.records.create({
      tool: explicit.tool ?? 'unknown',
      recipeId: explicit.recipeId,
      prompt: explicit.prompt,
      note: explicit.note,
      params: explicit.params,
      artifacts,
      ingestSource: 'manual',
    });
    results.push({ status: 'created', recordId: rec.id, files: artifacts.map((a) => a.path) });
    return results;
  }

  // 1. 逐文件：去重 → 嗅探 → 自动解析 → 配方归并
  const items: Item[] = [];
  for (const file of options.sources) {
    const buf = readFileSync(file);
    const hash = sha256hex(buf);
    const kind = sniffSource(buf, file);
    const extract = kind === 'comfyui' ? extractComfyui(buf, file) : undefined;
    const known = lib.records.findByFileHash(hash);
    if (known) {
      // 重复入库不再建新配方，但仍走一次归并：命中旧口径模板文件时把丢失的画布布局补回来
      if (extract) ensureRecipe(lib, storage, file, extract);
      results.push({ status: 'existing', recordId: known.id, recipeId: known.recipeId, files: [file] });
      continue;
    }

    const has = (field: keyof IngestExplicit) => explicit !== undefined && field in explicit;

    const needsManual: NeedsManualField[] = [];
    if (!extract?.tool && !has('tool')) needsManual.push({ field: 'tool', reasonCode: 'tool_not_detected', reason: '未识别到生成工具' });
    if (!extract?.prompts?.length && !has('prompt')) needsManual.push({ field: 'prompt', reasonCode: 'prompt_not_parsed', reason: '未解析到提示词' });
    if (!explicit?.recipeId) {
      if (!extract) needsManual.push({ field: 'recipe', reasonCode: 'workflow_metadata_absent', reason: '文件不含可解析的工作流元数据，需手动关联或补录' });
      else if (extract.recipeContent === undefined) needsManual.push({ field: 'recipe', reasonCode: 'workflow_content_not_parsed', reason: '未解析到工作流内容' });
    }
    if (kind === 'unknown') needsManual.push({ field: 'mediaType', reasonCode: 'media_type_ambiguous', reason: 'MVP 仅支持 image/video，需人工确认媒体类型' });

    const item: Item = { file, hash, needsManual, ...(extract ? { extract } : {}) };
    if (extract) {
      const recipeId = ensureRecipe(lib, storage, file, extract);
      if (recipeId) item.recipeId = recipeId;
    }
    if (!item.recipeId && explicit?.recipeId) item.recipeId = explicit.recipeId;
    // 解析得出配方的裸 JSON 导出属"收藏一份配方"，不是一次生成：建记录会虚增配方使用次数
    if (item.recipeId && kind === 'comfyui' && isWorkflowManifest(file)) {
      results.push({ status: 'collected', recipeId: item.recipeId, files: [file] });
      continue;
    }
    items.push(item);
  }

  // 2. 同一次运行的多输出合并为 1 条记录 + N 个产物
  const buckets = new Map<string, Item[]>();
  for (const item of items) {
    const key = runKeyOf(item);
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  for (const bucket of buckets.values()) {
    const lead = bucket.find((i) => i.extract) ?? bucket[0]!;
    const extract = lead.extract;
    const recipeId = lead.recipeId;

    const prompt = extract?.prompts?.[0] ?? explicit?.prompt;
    const params: Record<string, unknown> = { ...(extract?.params ?? {}), ...(extract?.negative ? { negative: extract.negative } : {}), ...(explicit?.params ?? {}) };

    const needsManual = mergeNeedsManual(bucket, explicit);
    const artifacts = bucket.map((i) => {
      const placed = storage.place(i.file);
      return { path: placed.path, storageMode: placed.mode, fileHash: i.hash, mediaType: mediaTypeOf(i.file) };
    });

    const rec = lib.records.create({
      tool: extract?.tool ?? explicit?.tool ?? 'unknown',
      recipeId,
      prompt,
      params: Object.keys(params).length ? params : undefined,
      workflowFilePath: recipeId ? lib.recipes.get(recipeId)?.workflowFilePath || undefined : undefined,
      artifacts,
      needsManual,
      ingestSource: 'auto-extract',
    });
    results.push({ status: 'created', recordId: rec.id, recipeId, files: bucket.map((i) => i.file) });
  }
  return results;
}

function mergeNeedsManual(bucket: Item[], explicit?: IngestExplicit): NeedsManualField[] {
  const seen = new Set<string>();
  const out: NeedsManualField[] = [];
  for (const item of bucket) {
    for (const n of item.needsManual) {
      if (explicit && n.field in explicit) continue;
      if (!seen.has(n.field)) {
        seen.add(n.field);
        out.push(n);
      }
    }
  }
  return out;
}
