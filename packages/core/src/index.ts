import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { DomainError, ERROR_CODES } from './domain/errors.js';
import { openDb, createRecipeRepository, createRecordRepository, type RecipeRepository, type RecordRepository } from './db/library.js';
import { createStorage, type Storage, type PlacedFile } from './storage/storage.js';
import { ingestFiles, type IngestResult, type IngestExplicit } from './ingest/pipeline.js';
import { extractComfyui, sniffSource, canonicalJson, sha256hex, stripVolatile, rehydrateTemplate, containsTemplateSentinel, WAS_PROMPT, WAS_SEED, type ExtractResult, type SourceKind } from './extractors/index.js';
import { attachWorkflowTemplate, exportRecipeWorkflow, matchOrPlace, templateOf, SAFE_NAME, type AttachIO, type ExportIO } from './recipes/recipeTemplate.js';
import type { Recipe, RecipeSearchQuery, RecordStats, SearchQuery, StorageMode } from './domain/types.js';

export interface LibraryOptions {
  /** SQLite 文件路径；测试用 ':memory:'（ADR-0003 本地自托管） */
  sqlite?: string;
  /** 数据目录：DB 缺省落在其中（asset-store.db），copy 存储与上传暂存也以它为根；与 sqlite 同给时仅覆盖目录根 */
  dataDir?: string;
}

/** 先建后挂的产物：命中库内同模板配方时归并并给出目标 id */
export interface AttachResult {
  recipe: Recipe;
  mergedInto?: string;
}

export interface Library {
  recipes: RecipeRepository;
  records: RecordRepository;
  /** 库的绝对数据目录 */
  readonly dataDir: string;
  /** 缺省 copy 模式存储（入库、配方落盘共用） */
  readonly storage: Storage;
  uploadStaging(name: string, bytes: Buffer): string;
  ingest(options: { sources: string[]; explicit?: IngestExplicit; mode?: StorageMode }): IngestResult[];
  createRecipeWithFile(input: { name: string; tool?: string; filePath: string }): AttachResult;
  attachWorkflowFile(recipeId: string, bytes: Buffer): AttachResult;
  exportWorkflow(recipeId: string, run?: { prompt?: string; params?: Record<string, unknown> }): { text: string; filename: string } | null;
  /** 数据目录内安全读取：越界、绝对路径越权、db 文件一律 null */
  readLibraryFile(relPath: string): { bytes: Buffer; contentType: string } | null;
  close(): void;
}

const DB_NAME = 'asset-store.db';

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
  '.txt': 'text/plain; charset=utf-8',
};

const contentTypeOf = (p: string) => {
  const dot = p.lastIndexOf('.');
  return CONTENT_TYPES[dot >= 0 ? p.slice(dot).toLowerCase() : ''] ?? 'application/octet-stream';
};

export function createLibrary(options: LibraryOptions): Library {
  const dataDir = resolve(options.dataDir ?? (options.sqlite && options.sqlite !== ':memory:' ? resolve(options.sqlite, '..') : process.cwd()));
  mkdirSync(dataDir, { recursive: true });
  const { sqlite, db } = openDb(options.sqlite ?? join(dataDir, DB_NAME));
  const recipes = createRecipeRepository(db);
  const records = createRecordRepository(db);
  const storage = createStorage({ dataDir, mode: 'copy' });
  const uploadDir = join(dataDir, 'uploads');
  const dbFile = join(dataDir, DB_NAME);

  const insideData = (abs: string) => abs.startsWith(dataDir + sep);

  return {
    recipes,
    records,
    dataDir,
    storage,
    uploadStaging(name, bytes) {
      mkdirSync(uploadDir, { recursive: true });
      const dest = join(uploadDir, `${Date.now()}-${name.replace(SAFE_NAME, '_') || 'upload.bin'}`);
      writeFileSync(dest, bytes);
      return dest;
    },
    ingest({ sources, explicit, mode }) {
      return ingestFiles({
        lib: this,
        storage: mode === 'reference' ? createStorage({ dataDir, mode }) : storage,
        sources,
        explicit,
      });
    },
    createRecipeWithFile(input) {
      if (!existsSync(input.filePath)) throw new DomainError(`文件不存在: ${input.filePath}`, 'file_not_found');
      const created = recipes.create({ kind: 'workflow-file', name: input.name, tool: input.tool });
      return attachWorkflowTemplate({ lib: this, storage }, { recipeId: created.id, bytes: readFileSync(input.filePath) });
    },
    attachWorkflowFile(recipeId, bytes) {
      return attachWorkflowTemplate({ lib: this, storage }, { recipeId, bytes });
    },
    exportWorkflow(recipeId, run) {
      const recipe = recipes.get(recipeId);
      if (!recipe) throw new DomainError(`配方不存在: ${recipeId}`, 'recipe_not_found');
      const seedRaw = run?.params?.seed;
      return exportRecipeWorkflow({ recipes }, {
        recipe,
        run: { prompt: run?.prompt, seed: typeof seedRaw === 'number' ? seedRaw : undefined },
      });
    },
    readLibraryFile(relPath) {
      const abs = isAbsolute(relPath) ? resolve(relPath) : resolve(dataDir, relPath);
      if (!insideData(abs) || abs === dbFile) return null;
      if (!existsSync(abs) || !statSync(abs).isFile()) return null;
      return { bytes: readFileSync(abs), contentType: contentTypeOf(abs) };
    },
    close: () => sqlite.close(),
  };
}

export * from './domain/types.js';
export {
  DomainError,
  ERROR_CODES,
  createStorage,
  ingestFiles,
  extractComfyui,
  sniffSource,
  canonicalJson,
  sha256hex,
  stripVolatile,
  rehydrateTemplate,
  containsTemplateSentinel,
  WAS_PROMPT,
  WAS_SEED,
  attachWorkflowTemplate,
  exportRecipeWorkflow,
  matchOrPlace,
  templateOf,
};
export type { ErrorCode } from './domain/errors.js';
export type {
  Storage,
  PlacedFile,
  IngestResult,
  IngestExplicit,
  ExtractResult,
  SourceKind,
  RecipeRepository,
  RecordRepository,
  RecipeSearchQuery,
  RecordStats,
  SearchQuery,
  AttachIO,
  ExportIO,
};
