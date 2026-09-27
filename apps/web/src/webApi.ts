import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  createLibrary,
  DomainError,
  type GenerationRecord,
  type IngestExplicit,
  type Library,
  type NewRecipe,
  type Recipe,
  type RecipeKind,
  type RecordStats,
  type SearchQuery,
} from '@was/core';
import { isPreviewable } from '../lib/format';

export type { SearchQuery, RecipeKind } from '@was/core';

export interface RecordCard {
  id: string;
  tool: string;
  prompt?: string;
  createdAt: number;
  artifactCount: number;
  mediaType: string;
  hasRecipe: boolean;
  recipeId?: string;
  recipeName?: string;
  needsManual: string[];
  thumbUrl?: string;
  detailUrl: string;
}

export interface UploadResult {
  created: number;
  skipped_existing: number;
  /** 拖入的裸工作流 JSON：只归并/新建配方，不产生生成记录，故不进使用统计 */
  collected_recipes: number;
  record_ids: string[];
}

export interface RecipeDetail {
  recipe: Recipe;
  records: GenerationRecord[];
  stats: RecordStats;
  /** workflow-file 配方的模板 JSON 原文预览；无文件或不可读为 null */
  workflowText: string | null;
}

/** 回收站条目类型：删除/恢复/彻底删除都按它分派 */
export type TrashKind = 'record' | 'recipe';

export interface TrashEntry {
  kind: TrashKind;
  id: string;
  /** 记录取提示词，配方取名称 */
  title: string;
  tool?: string;
  createdAt: number;
  deletedAt: number;
  artifactCount: number;
  mediaType?: string;
  thumbUrl?: string;
  detailUrl: string;
}

export interface WebApi {
  listRecords(params: SearchQuery): { records: RecordCard[]; total: number };
  getRecord(id: string): GenerationRecord;
  getRecordSafe(id: string): GenerationRecord | null;
  listIncomplete(): GenerationRecord[];
  patchRecord(id: string, patch: { tool?: string; prompt?: string; note?: string; resolve?: string[]; recipeId?: string }): GenerationRecord;
  createManualRecord(input: { tool: string; prompt?: string; note?: string; paths: string[]; recipeId?: string }): GenerationRecord;
  ingestUpload(form: FormData): Promise<UploadResult>;
  listRecipes(query?: { kind?: string; tool?: string; q?: string }): Recipe[];
  getRecipe(id: string): Recipe;
  getRecipeSafe(id: string): Recipe | null;
  getRecipeDetail(id: string): RecipeDetail | null;
  recipeStats(recipeId: string): RecordStats;
  createRecipe(input: { name: string; kind: RecipeKind; tool?: string; prompt?: string; params?: Record<string, unknown> }): Recipe;
  attachWorkflowFile(recipeId: string, blob: Blob, filename: string): Promise<Recipe>;
  duplicateRecipe(recipeId: string, name?: string): Recipe;
  renameRecipe(recipeId: string, name: string): Recipe;
  exportWorkflow(recipeId: string, opts?: { recordId?: string; prompt?: string; params?: Record<string, unknown> }): { text: string; filename: string } | null;
  /** 移入回收站（软删除），返回实际移动条数 */
  trashRecords(ids: string[]): number;
  trashRecipe(id: string): number;
  listTrash(): TrashEntry[];
  trashCounts(): { records: number; recipes: number };
  restoreTrash(kind: TrashKind, id: string): GenerationRecord | Recipe;
  /** 彻底删除：连同只被它引用的库内文件一起回收 */
  purgeTrash(kind: TrashKind, id: string): void;
  emptyTrash(): { records: number; recipes: number };
  /** 产物路径 → /api/files URL（data 内为相对路径，data 外保留绝对路径由 resolveFileParam 做登记校验） */
  artifactFileUrl(path: string): string;
  /** /api/files 的 URL 段 → 文件内容：data 内直接读，data 外仅当已登记为产物才放行 */
  resolveFileParam(seg: string): { bytes: Buffer; contentType: string } | null;
  readLibraryFile(path: string): { bytes: Buffer; contentType: string } | null;
  readArtifactFor(recordId: string, index: number): { bytes: Buffer; contentType: string } | null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
};

const contentTypeOf = (p: string) => {
  const dot = p.lastIndexOf('.');
  return CONTENT_TYPES[dot >= 0 ? p.slice(dot).toLowerCase() : ''] ?? 'application/octet-stream';
};

/** 产物 URL 段：data 内取相对路径（与历史卡片一致），否则绝对路径正斜杠化 */
function toSeg(dataDir: string, p: string): string {
  if (!isAbsolute(p)) return p;
  const rel = relative(dataDir, p);
  if (rel && !rel.startsWith('..')) return rel.replaceAll(sep, '/');
  return p.replaceAll(sep, '/');
}

export function createWebApi(options: { lib: Library; dataDir: string }): WebApi {
  const { lib, dataDir } = options;

  const fileUrl = (p: string) => `/api/files/${encodeURIComponent(toSeg(dataDir, p))}`;

  const toCard = (rec: GenerationRecord, recipeNames: Map<string, string>): RecordCard => {
    const first = rec.artifacts[0];
    return {
      id: rec.id,
      tool: rec.tool,
      prompt: rec.prompt,
      createdAt: rec.createdAt,
      artifactCount: rec.artifacts.length,
      mediaType: first?.mediaType ?? 'image',
      hasRecipe: Boolean(rec.recipeId),
      recipeId: rec.recipeId,
      recipeName: rec.recipeId ? recipeNames.get(rec.recipeId) : undefined,
      needsManual: (rec.needsManual ?? []).map((n) => n.field),
      thumbUrl: first && isPreviewable(first.path) ? fileUrl(first.path) : undefined,
      detailUrl: `/records/${rec.id}`,
    };
  };

  /** 外链（reference 模式）产物：仅当路径已登记在某条记录的产物里才放行 */
  const readRegisteredArtifact = (absPath: string) => {
    if (!lib.records.isArtifactPathUsed(absPath)) return null;
    if (!existsSync(absPath) || !statSync(absPath).isFile()) return null;
    return { bytes: readFileSync(absPath), contentType: contentTypeOf(absPath) };
  };

  return {
    listRecords(params) {
      const records = lib.records.search(params);
      const total = lib.records.search({ ...params, limit: 100_000 }).length;
      const recipeNames = new Map(lib.recipes.list().map((r) => [r.id, r.name]));
      return { records: records.map((r) => toCard(r, recipeNames)), total };
    },

    getRecord(id) {
      const rec = lib.records.get(id);
      if (!rec) throw new DomainError(`生成记录不存在: ${id}`, 'record_not_found');
      return rec;
    },

    getRecordSafe(id) {
      return lib.records.get(id) ?? null;
    },

    listIncomplete() {
      return lib.records.search({ needsManual: true, limit: 500 });
    },

    patchRecord(id, patch) {
      return lib.records.update(id, {
        tool: patch.tool,
        prompt: patch.prompt,
        note: patch.note,
        recipeId: patch.recipeId,
        resolveManual: patch.resolve?.length ? patch.resolve : undefined,
      });
    },

    createManualRecord(input) {
      const artifacts = input.paths.map((p) => {
        const abs = resolve(p);
        if (!existsSync(abs)) throw new DomainError(`文件不存在: ${p}`, 'file_not_found');
        return { path: abs, mediaType: /\.(mp4|mov|webm|avi|mkv)$/i.test(abs) ? ('video' as const) : ('image' as const) };
      });
      const explicit: IngestExplicit = { tool: input.tool, prompt: input.prompt, note: input.note, recipeId: input.recipeId, artifacts };
      const [first] = lib.ingest({ sources: [], explicit });
      return lib.records.get(first!.recordId!)!;
    },

    async ingestUpload(form) {
      const sources: string[] = [];
      for (const e of form.getAll('files')) {
        if (typeof File === 'undefined' || !(e instanceof File)) continue;
        sources.push(lib.uploadStaging(e.name || 'upload.bin', Buffer.from(await e.arrayBuffer())));
      }
      const explicit: IngestExplicit = {};
      const text = (k: string) => {
        const v = form.get(k);
        return typeof v === 'string' && v.trim() ? v.trim() : undefined;
      };
      const tool = text('tool');
      const prompt = text('prompt');
      const recipeId = text('recipeId');
      if (tool) explicit.tool = tool;
      if (prompt) explicit.prompt = prompt;
      if (recipeId) explicit.recipeId = recipeId;
      const results = lib.ingest({ sources, explicit });
      const collected = new Set<string>();
      for (const r of results) if (r.status === 'collected' && r.recipeId) collected.add(r.recipeId);
      return {
        created: results.filter((r) => r.status === 'created').length,
        skipped_existing: results.filter((r) => r.status === 'existing').length,
        collected_recipes: collected.size,
        record_ids: results.flatMap((r) => (r.recordId ? [r.recordId] : [])),
      };
    },

    listRecipes(query) {
      return lib.recipes.search({ kind: query?.kind as RecipeKind | undefined, tool: query?.tool, query: query?.q });
    },

    getRecipe(id) {
      const r = lib.recipes.get(id);
      if (!r) throw new DomainError(`配方不存在: ${id}`, 'recipe_not_found');
      return r;
    },

    getRecipeSafe(id) {
      return lib.recipes.get(id) ?? null;
    },

    getRecipeDetail(id) {
      const recipe = lib.recipes.get(id);
      if (!recipe) return null;
      const file = recipe.kind === 'workflow-file' && recipe.workflowFilePath ? this.readLibraryFile(recipe.workflowFilePath) : null;
      return {
        recipe,
        records: lib.records.listByRecipe(id),
        stats: lib.records.stats(id),
        workflowText: file ? file.bytes.toString('utf8') : null,
      };
    },

    recipeStats(recipeId) {
      return lib.records.stats(recipeId);
    },

    createRecipe(input) {
      const base = { name: input.name, tool: input.tool };
      let recipe: NewRecipe;
      if (input.kind === 'prompt-template') recipe = { ...base, kind: 'prompt-template', prompt: input.prompt ?? '' };
      else if (input.kind === 'param-preset') recipe = { ...base, kind: 'param-preset', params: input.params ?? {} };
      else recipe = { ...base, kind: 'workflow-file' };
      return lib.recipes.create(recipe);
    },

    async attachWorkflowFile(recipeId, blob) {
      const bytes = Buffer.from(await blob.arrayBuffer());
      return lib.attachWorkflowFile(recipeId, bytes).recipe;
    },

    duplicateRecipe(recipeId, name) {
      const recipe = lib.recipes.get(recipeId);
      if (!recipe) throw new DomainError(`配方不存在: ${recipeId}`, 'recipe_not_found');
      const base = { name: name?.trim() || `${recipe.name} 副本`, tool: recipe.tool };
      let input: NewRecipe;
      if (recipe.kind === 'workflow-file') input = { ...base, kind: 'workflow-file', workflowFilePath: recipe.workflowFilePath || undefined };
      else if (recipe.kind === 'prompt-template') input = { ...base, kind: 'prompt-template', prompt: recipe.prompt ?? '' };
      else input = { ...base, kind: 'param-preset', params: recipe.params ?? {} };
      // 副本不带 contentHash：避免入库归并回原件，作为独立草稿演化
      return lib.recipes.create(input);
    },

    renameRecipe(recipeId, name) {
      return lib.recipes.rename(recipeId, name);
    },

    exportWorkflow(recipeId, opts) {
      const record = opts?.recordId ? lib.records.get(opts.recordId) : undefined;
      const seedRaw = (opts?.params ?? record?.params)?.seed;
      return lib.exportWorkflow(recipeId, {
        prompt: opts?.prompt ?? record?.prompt,
        params: typeof seedRaw === 'number' ? { seed: seedRaw } : undefined,
      });
    },

    trashRecords(ids) {
      return lib.records.trash(ids);
    },

    trashRecipe(id) {
      return lib.recipes.trash([id]);
    },

    listTrash() {
      const entries: TrashEntry[] = [
        ...lib.records.listTrash().map((r) => ({
          kind: 'record' as const,
          id: r.id,
          title: r.prompt ?? r.note ?? r.id.slice(0, 8),
          tool: r.tool,
          createdAt: r.createdAt,
          deletedAt: r.deletedAt ?? 0,
          artifactCount: r.artifacts.length,
          mediaType: r.artifacts[0]?.mediaType,
          thumbUrl: r.artifacts[0] && isPreviewable(r.artifacts[0].path) ? fileUrl(r.artifacts[0].path) : undefined,
          detailUrl: `/records/${r.id}`,
        })),
        ...lib.recipes.listTrash().map((r) => ({
          kind: 'recipe' as const,
          id: r.id,
          title: r.name,
          tool: r.tool,
          createdAt: r.createdAt,
          deletedAt: r.deletedAt ?? 0,
          artifactCount: 0,
          detailUrl: `/recipes/${r.id}`,
        })),
      ];
      return entries.sort((a, b) => b.deletedAt - a.deletedAt);
    },

    trashCounts() {
      return { records: lib.records.countTrash(), recipes: lib.recipes.countTrash() };
    },

    restoreTrash(kind, id) {
      return kind === 'recipe' ? lib.recipes.restore(id) : lib.records.restore(id);
    },

    purgeTrash(kind, id) {
      if (kind === 'recipe') lib.purgeRecipe(id);
      else lib.purgeRecord(id);
    },

    emptyTrash() {
      const records = lib.records.listTrash().length;
      const recipes = lib.recipes.listTrash().length;
      for (const r of lib.records.listTrash()) lib.purgeRecord(r.id);
      for (const r of lib.recipes.listTrash()) lib.purgeRecipe(r.id);
      return { records, recipes };
    },

    artifactFileUrl: fileUrl,

    resolveFileParam(seg) {
      // data 内卡片的相对段（files/xxx.png）直接读；绝对路径形态（外链产物）仅当已登记才放行
      const absolute = isAbsolute(seg) || seg.startsWith('/') || seg.startsWith('\\');
      const local = absolute ? (process.platform === 'win32' ? resolve(seg) : resolve(`/${seg}`)) : null;
      return lib.readLibraryFile(seg) ?? (local ? readRegisteredArtifact(local) : null);
    },

    readLibraryFile(path) {
      return lib.readLibraryFile(path);
    },

    readArtifactFor(recordId, index) {
      const rec = lib.records.get(recordId);
      const artifact = rec?.artifacts[index];
      if (!rec || !artifact) return null;
      if (!existsSync(artifact.path) || !statSync(artifact.path).isFile()) return null;
      return { bytes: readFileSync(artifact.path), contentType: contentTypeOf(artifact.path) };
    },
  };
}

let singleton: WebApi | null = null;

export function getWebApi(): WebApi {
  if (!singleton) {
    // 本地自托管应用：data 目录在运行时解析，无需（也无法）在构建期静态追踪
    const dataDir = join(/*turbopackIgnore: true*/ process.cwd(), process.env.ASSET_DATA_DIR ?? 'data');
    const lib = createLibrary({ dataDir });
    singleton = createWebApi({ lib, dataDir: lib.dataDir });
  }
  return singleton;
}
