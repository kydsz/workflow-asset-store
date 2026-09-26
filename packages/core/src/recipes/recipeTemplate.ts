import { existsSync, readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { DomainError } from '../domain/errors.js';
import type { Recipe } from '../domain/types.js';
import { canonicalJson, containsTemplateSentinel, rehydrateTemplate, sha256hex, stripVolatile } from '../extractors/index.js';
import type { Library } from '../index.js';
import type { RecipeRepository } from '../db/library.js';
import type { Storage } from '../storage/storage.js';

/** 文件名净化：仅保留字母数字与 . _ ( ) - 及 CJK */
export const SAFE_NAME = /[^A-Za-z0-9._()\-\u4e00-\u9fff]/g;

export interface TemplateDigest {
  template: unknown;
  contentHash: string;
}

/** 配方身份的唯一口径：剥离 prompt/seed/画布噪音后的规范化模板 + 其哈希 */
export function templateOf(raw: unknown): TemplateDigest {
  const template = stripVolatile(raw);
  return { template, contentHash: sha256hex(Buffer.from(canonicalJson(template), 'utf8')) };
}

/** 旧库存量配方是改前落的原始内容（哈希为旧口径）：按其自身剥离后的哈希再匹配一次，实现自愈归并 */
function findLegacyMatchingRecipe(recipes: RecipeRepository, templateHash: string): Recipe | undefined {
  for (const r of recipes.list()) {
    if (r.kind !== 'workflow-file') continue;
    if (!r.workflowFilePath || !existsSync(r.workflowFilePath)) continue;
    try {
      if (templateOf(JSON.parse(readFileSync(r.workflowFilePath, 'utf8'))).contentHash === templateHash) return r;
    } catch {
      /* 非法 JSON 不参与匹配 */
    }
  }
  return undefined;
}

function matchTemplate(recipes: RecipeRepository, contentHash: string): Recipe | undefined {
  return (
    recipes.findByContentHash(contentHash) ??
    findLegacyMatchingRecipe(recipes, contentHash)
  );
}

/** 入库管线用：命中已有模板直接归并，未命中才落盘（.json 后缀防止与产物图同哈希互相覆盖）并新建配方 */
export function matchOrPlace(
  recipes: RecipeRepository,
  storage: Storage,
  opts: { template: unknown; contentHash: string; srcFile: string; name?: string; tool?: string },
): { recipeId: string; created: boolean } {
  const existing = matchTemplate(recipes, opts.contentHash);
  if (existing) return { recipeId: existing.id, created: false };
  const placed = storage.place(opts.srcFile, Buffer.from(canonicalJson(opts.template), 'utf8'), '.json');
  const recipe = recipes.create({
    kind: 'workflow-file',
    name: opts.name ?? basename(opts.srcFile, extname(opts.srcFile)),
    tool: opts.tool,
    workflowFilePath: placed.path,
    contentHash: opts.contentHash,
  });
  return { recipeId: recipe.id, created: true };
}

export interface AttachIO {
  lib: Library;
  storage: Storage;
}

/** 先建后挂的统一入口：与自动入库同一归并口径。raw bytes 只用于源文件内容未变时的原地重挂判断 */
export function attachWorkflowTemplate(io: AttachIO, opts: { recipeId: string; bytes: Buffer }): { recipe: Recipe; mergedInto?: string } {
  const recipes = io.lib.recipes;
  const target = recipes.get(opts.recipeId);
  if (!target) throw new DomainError(`配方不存在: ${opts.recipeId}`, 'recipe_not_found');
  if (target.kind !== 'workflow-file') throw new DomainError('只有工作流文件配方可补挂文件，其余形态请用文本内容', 'workflow_kind_mismatch');
  let parsed: unknown;
  try {
    parsed = JSON.parse(opts.bytes.toString('utf8'));
  } catch {
    throw new DomainError('工作流文件需为合法 JSON', 'workflow_json_invalid');
  }
  const { template, contentHash } = templateOf(parsed);
  const match = matchTemplate(recipes, contentHash);
  if (match) {
    if (match.id === target.id) {
      const path = target.workflowFilePath || match.workflowFilePath;
      if (target.workflowFilePath && target.contentHash === contentHash) return { recipe: target };
      return { recipe: recipes.backfill(target.id, { workflowFilePath: path, contentHash }) };
    }
    return { recipe: match, mergedInto: match.id };
  }
  if (target.workflowFilePath) {
    throw new DomainError(`该配方已挂其他工作流模板，与新内容模板不一致: ${target.name}`, 'recipe_template_conflict');
  }
  const tmp = `${opts.recipeId}.attach.tmp`;
  const placed = io.storage.place(tmp, Buffer.from(canonicalJson(template), 'utf8'), '.json');
  return { recipe: recipes.backfill(target.id, { workflowFilePath: placed.path, contentHash }) };
}

/** 历史未模板化工作流的兜底注入：按节点类型+位置写回（模板哨兵路径走 rehydrateTemplate） */
function injectRawParams(json: unknown, run: { prompt?: string; seed?: number }): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
  const root = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  const uiNodes = (root as { nodes?: unknown }).nodes;
  if (Array.isArray(uiNodes)) {
    let promptSet = false;
    for (const n of uiNodes as Record<string, unknown>[]) {
      const w = n?.widgets_values;
      if (!Array.isArray(w)) continue;
      if (run.prompt && !promptSet && n.type === 'CLIPTextEncode') {
        w[0] = run.prompt;
        promptSet = true;
      }
      if (run.seed !== undefined && n.type === 'KSampler') w[0] = run.seed;
    }
    return root;
  }
  let promptSet = false;
  for (const node of Object.values(root)) {
    if (!node || typeof node !== 'object') continue;
    const n = node as { class_type?: string; inputs?: Record<string, unknown> };
    if (run.prompt && !promptSet && /textencode/i.test(n.class_type ?? '') && n.inputs && typeof n.inputs.text === 'string') {
      n.inputs.text = run.prompt;
      promptSet = true;
    }
    if (run.seed !== undefined && n.class_type === 'KSampler' && n.inputs) n.inputs.seed = run.seed;
  }
  return root;
}

export interface ExportIO {
  recipes: RecipeRepository;
}

/** 导出即回填：模板哨兵/历史原始图统一处理；无可导出文件返回 null；非法 JSON 原样导出 */
export function exportRecipeWorkflow(io: ExportIO, opts: { recipe: Recipe; run?: { prompt?: string; seed?: number } }): { text: string; filename: string } | null {
  const recipe = io.recipes.get(opts.recipe.id) ?? opts.recipe;
  if (recipe.kind !== 'workflow-file' || !recipe.workflowFilePath) return null;
  if (!existsSync(recipe.workflowFilePath)) return null;
  const text = readFileSync(recipe.workflowFilePath, 'utf8');
  const stem = (recipe.name || recipe.id.slice(0, 8)).replace(SAFE_NAME, '_');
  const filename = `${stem}.json`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { text, filename };
  }
  const run = opts.run ?? {};
  if (containsTemplateSentinel(parsed)) {
    // 哨兵一律回填为可运行值（默认导出提示词回空、seed 时间戳兜底），保证产物可直接投喂 ComfyUI
    const seed = run.seed ?? Date.now() % 2 ** 31;
    return { text: JSON.stringify(rehydrateTemplate(parsed, { prompt: run.prompt ?? '', seed })), filename };
  }
  if (run.prompt || run.seed !== undefined) {
    return { text: JSON.stringify(injectRawParams(parsed, run)), filename };
  }
  return { text, filename };
}
