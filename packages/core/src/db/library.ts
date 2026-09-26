import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { and, desc, eq, like, or, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SQL } from 'drizzle-orm';
import { DomainError } from '../domain/errors.js';
import type {
  Artifact,
  ArtifactMediaType,
  GenerationRecord,
  NeedsManualField,
  NewGenerationRecord,
  NewRecipe,
  Recipe,
  RecipeKind,
  RecipeSearchQuery,
  RecordPatch,
  RecordStats,
  SearchQuery,
} from '../domain/types.js';
import { artifacts, generationRecords, recipes, type RecipeRow } from './schema.js';

export type Db = BetterSQLite3Database<{ recipes: typeof recipes; generationRecords: typeof generationRecords; artifacts: typeof artifacts }>;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    tool TEXT,
    workflow_file_path TEXT,
    prompt TEXT,
    params TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    content_hash TEXT,
    owner TEXT NOT NULL DEFAULT 'local',
    created_at REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS generation_records (
    id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    recipe_id TEXT REFERENCES recipes(id),
    prompt TEXT,
    params TEXT,
    workflow_file_path TEXT,
    note TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    needs_manual TEXT,
    ingest_source TEXT,
    owner TEXT NOT NULL DEFAULT 'local',
    created_at REAL NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES generation_records(id),
    path TEXT NOT NULL,
    media_type TEXT NOT NULL,
    storage_mode TEXT,
    file_hash TEXT,
    created_at REAL NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_generation_records_recipe ON generation_records(recipe_id)',
  'CREATE INDEX IF NOT EXISTS idx_artifacts_record ON artifacts(record_id)',
  'CREATE INDEX IF NOT EXISTS idx_artifacts_file_hash ON artifacts(file_hash)',
  'CREATE INDEX IF NOT EXISTS idx_recipes_content_hash ON recipes(content_hash)',
];

/** 旧库升级用列变更：SQLite 的 ADD COLUMN 无 IF NOT EXISTS，重复执行报 duplicate column 即跳过 */
const ALTERS = [
  'ALTER TABLE recipes ADD COLUMN content_hash TEXT',
  'ALTER TABLE generation_records ADD COLUMN needs_manual TEXT',
  'ALTER TABLE generation_records ADD COLUMN ingest_source TEXT',
  'ALTER TABLE artifacts ADD COLUMN file_hash TEXT',
];

export function openDb(file: string): { sqlite: Database.Database; db: Db } {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  for (const m of MIGRATIONS) sqlite.exec(m);
  for (const a of ALTERS) {
    try {
      sqlite.exec(a);
    } catch {
      /* 列已存在 */
    }
  }
  return { sqlite, db: drizzle(sqlite, { schema: { recipes, generationRecords, artifacts } }) };
}

const REQUIRED_CONTENT: Partial<Record<RecipeKind, keyof NewRecipe>> = {
  'prompt-template': 'prompt',
  'param-preset': 'params',
};

function assertRecipe(input: NewRecipe): void {
  const kind = input.kind as string;
  if (kind !== 'workflow-file' && kind !== 'prompt-template' && kind !== 'param-preset') {
    throw new DomainError(`未知配方形态: ${kind}`, 'recipe_kind_unknown');
  }
  if (!input.name?.trim()) throw new DomainError('配方必须有名称', 'recipe_name_required');
  // workflow-file 可先建档后补文件（backfill），不强制内容有值
  const field = REQUIRED_CONTENT[input.kind];
  if (!field) return;
  const value = input[field as keyof NewRecipe];
  if (value == null || value === '') {
    throw new DomainError(`${input.kind} 配方缺少必填内容: ${String(field)}`, 'recipe_content_missing');
  }
}

function rowToRecipe(row: RecipeRow): Recipe {
  const base = {
    id: row.id,
    kind: row.kind as RecipeKind,
    name: row.name,
    tool: row.tool ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    contentHash: row.contentHash ?? undefined,
    owner: row.owner,
    createdAt: row.createdAt,
  };
  if (row.kind === 'workflow-file') return { ...base, workflowFilePath: row.workflowFilePath ?? '' };
  if (row.kind === 'prompt-template') return { ...base, prompt: row.prompt ?? '' };
  return { ...base, params: JSON.parse(row.params ?? '{}') as Record<string, unknown> };
}

export interface RecipeRepository {
  create(input: NewRecipe): Recipe;
  get(id: string): Recipe | undefined;
  list(): Recipe[];
  findByContentHash(contentHash: string): Recipe | undefined;
  search(query: RecipeSearchQuery): Recipe[];
  /** 待补录回填：纯收藏配方后续拿到工作流文件时补上 */
  backfill(id: string, patch: { workflowFilePath?: string; contentHash?: string }): Recipe;
}

export function createRecipeRepository(db: Db): RecipeRepository {
  return {
    create(input) {
      assertRecipe(input);
      const row = {
        id: randomUUID(),
        kind: input.kind as RecipeKind,
        name: input.name,
        tool: input.tool ?? null,
        workflowFilePath: input.kind === 'workflow-file' ? input.workflowFilePath ?? null : null,
        prompt: input.kind === 'prompt-template' ? input.prompt : null,
        params: input.kind === 'param-preset' ? JSON.stringify(input.params) : null,
        tags: JSON.stringify(input.tags ?? []),
        contentHash: input.kind === 'workflow-file' ? (input.contentHash ?? null) : null,
        owner: input.owner ?? 'local',
        createdAt: Date.now(),
      };
      db.insert(recipes).values(row).run();
      return rowToRecipe(row);
    },
    get(id) {
      const row = db.select().from(recipes).where(eq(recipes.id, id)).get();
      return row && rowToRecipe(row);
    },
    list() {
      return db.select().from(recipes).all().map(rowToRecipe);
    },
    findByContentHash(contentHash) {
      const row = db.select().from(recipes).where(eq(recipes.contentHash, contentHash)).get();
      return row ? rowToRecipe(row) : undefined;
    },
    search(q) {
      const conds: (SQL | undefined)[] = [];
      if (q.kind) conds.push(eq(recipes.kind, q.kind));
      if (q.tool) conds.push(eq(recipes.tool, q.tool));
      let rows = conds.length ? db.select().from(recipes).where(and(...conds)).all() : db.select().from(recipes).all();
      if (q.query) {
        const needle = q.query.toLowerCase();
        rows = rows.filter((r) => `${r.name} ${r.prompt ?? ''} ${r.tool ?? ''} ${r.params ?? ''} ${r.tags}`.toLowerCase().includes(needle));
      }
      const limit = q.limit ?? 100;
      return rows.slice(0, limit).map(rowToRecipe);
    },
    backfill(id, patch) {
      const row = db.select().from(recipes).where(eq(recipes.id, id)).get();
      if (!row) throw new DomainError(`配方不存在: ${id}`, 'recipe_not_found');
      const updated = { ...row, workflowFilePath: patch.workflowFilePath ?? row.workflowFilePath, contentHash: patch.contentHash ?? row.contentHash };
      db.update(recipes)
        .set({ workflowFilePath: updated.workflowFilePath, contentHash: updated.contentHash })
        .where(eq(recipes.id, id))
        .run();
      return rowToRecipe(updated);
    },
  };
}

function assertRecord(db: Db, input: NewGenerationRecord): void {
  if (!input.tool?.trim()) throw new DomainError('生成记录必须标注生成工具 (sourceTool)', 'record_tool_required');
  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw new DomainError('生成记录至少需要一个产物', 'record_artifacts_required');
  }
  for (const a of input.artifacts) {
    if (!a?.path?.trim()) throw new DomainError('产物缺少 path', 'artifact_path_required');
    if (a.mediaType !== 'image' && a.mediaType !== 'video') {
      throw new DomainError(`产物 mediaType 仅支持 image/video: ${String(a.mediaType)}`, 'artifact_media_type_unsupported');
    }
  }
  if (input.prompt != null && input.prompt !== '' && typeof input.prompt !== 'string') {
    throw new DomainError('提示词必须是文本', 'prompt_must_be_text');
  }
  if (input.recipeId != null && !db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, input.recipeId)).get()) {
    throw new DomainError(`关联的配方不存在: ${input.recipeId}`, 'recipe_not_found');
  }
}

function rowToRecord(row: typeof generationRecords.$inferSelect, artifactRows: typeof artifacts.$inferSelect[]): GenerationRecord {
  return {
    id: row.id,
    tool: row.tool,
    recipeId: row.recipeId ?? undefined,
    prompt: row.prompt ?? undefined,
    params: row.params == null ? undefined : (JSON.parse(row.params) as Record<string, unknown>),
    workflowFilePath: row.workflowFilePath ?? undefined,
    note: row.note ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    needsManual: row.needsManual == null ? undefined : (JSON.parse(row.needsManual) as NeedsManualField[]),
    ingestSource: (row.ingestSource ?? undefined) as GenerationRecord['ingestSource'],
    owner: row.owner,
    createdAt: row.createdAt,
    artifacts: artifactRows.map((a) => ({
      path: a.path,
      mediaType: a.mediaType as ArtifactMediaType,
      storageMode: (a.storageMode ?? undefined) as Artifact['storageMode'],
      fileHash: a.fileHash ?? undefined,
    })),
  };
}

export interface RecordRepository {
  create(input: NewGenerationRecord): GenerationRecord;
  get(id: string): GenerationRecord | undefined;
  listByRecipe(recipeId: string): GenerationRecord[];
  findByFileHash(fileHash: string): GenerationRecord | undefined;
  search(query: SearchQuery): GenerationRecord[];
  stats(recipeId: string): RecordStats;
  update(id: string, patch: RecordPatch): GenerationRecord;
}

export function createRecordRepository(db: Db): RecordRepository {
  const loadArtifacts = (recordId: string) => db.select().from(artifacts).where(eq(artifacts.recordId, recordId)).all();
  return {
    create(input) {
      assertRecord(db, input);
      const now = Date.now();
      const id = randomUUID();
      const row = {
        id,
        tool: input.tool,
        recipeId: input.recipeId ?? null,
        prompt: input.prompt ?? null,
        params: input.params == null ? null : JSON.stringify(input.params),
        workflowFilePath: input.workflowFilePath ?? null,
        note: input.note ?? null,
        tags: JSON.stringify(input.tags ?? []),
        needsManual: input.needsManual == null ? null : JSON.stringify(input.needsManual),
        ingestSource: input.ingestSource ?? null,
        owner: input.owner ?? 'local',
        createdAt: now,
      };
      const artifactRows = input.artifacts.map((a): typeof artifacts.$inferSelect => ({
        id: randomUUID(),
        recordId: id,
        path: a.path,
        mediaType: a.mediaType,
        storageMode: a.storageMode ?? null,
        fileHash: a.fileHash ?? null,
        createdAt: now,
      }));
      db.transaction((tx) => {
        tx.insert(generationRecords).values(row).run();
        tx.insert(artifacts).values(artifactRows).run();
      });
      return rowToRecord(row, artifactRows);
    },
    get(id) {
      const row = db.select().from(generationRecords).where(eq(generationRecords.id, id)).get();
      return row && rowToRecord(row, loadArtifacts(id));
    },
    listByRecipe(recipeId) {
      return db
        .select()
        .from(generationRecords)
        .where(eq(generationRecords.recipeId, recipeId))
        .all()
        .map((row) => rowToRecord(row, loadArtifacts(row.id)));
    },
    findByFileHash(fileHash) {
      const hit = db.select({ recordId: artifacts.recordId }).from(artifacts).where(eq(artifacts.fileHash, fileHash)).get();
      return hit ? this.get(hit.recordId) : undefined;
    },
    search(q) {
      const conds: (SQL | undefined)[] = [];
      if (q.tool) conds.push(eq(generationRecords.tool, q.tool));
      if (q.hasRecipe === true) conds.push(sql`${generationRecords.recipeId} IS NOT NULL`);
      if (q.hasRecipe === false) conds.push(sql`${generationRecords.recipeId} IS NULL`);
      if (q.needsManual === true) conds.push(sql`${generationRecords.needsManual} IS NOT NULL AND ${generationRecords.needsManual} != '[]'`);
      if (q.needsManual === false) conds.push(sql`(${generationRecords.needsManual} IS NULL OR ${generationRecords.needsManual} = '[]')`);
      if (q.since != null) conds.push(sql`${generationRecords.createdAt} >= ${q.since}`);
      if (q.until != null) conds.push(sql`${generationRecords.createdAt} <= ${q.until}`);
      if (q.mediaType) {
        conds.push(sql`EXISTS (SELECT 1 FROM artifacts WHERE artifacts.record_id = ${generationRecords.id} AND artifacts.media_type = ${q.mediaType})`);
      }
      if (q.query) {
        const pattern = `%${q.query}%`;
        const recipeHit = sql`EXISTS (SELECT 1 FROM ${recipes} WHERE ${recipes.id} = ${generationRecords.recipeId} AND (${like(recipes.name, pattern)} OR ${like(recipes.params, pattern)}))`;
        conds.push(or(like(generationRecords.prompt, pattern), like(generationRecords.note, pattern), like(generationRecords.params, pattern), like(generationRecords.workflowFilePath, pattern), recipeHit));
      }
      const where = conds.length ? and(...conds) : undefined;
      const order = q.sort === 'oldest-first' ? sql`${generationRecords.createdAt} ASC` : desc(generationRecords.createdAt);
      const limit = q.limit ?? 100;
      const rows = db.select().from(generationRecords).where(where).orderBy(order).limit(limit).all();
      return rows.map((row) => rowToRecord(row, loadArtifacts(row.id)));
    },
    stats(recipeId) {
      const rows = db.select({ createdAt: generationRecords.createdAt }).from(generationRecords).where(eq(generationRecords.recipeId, recipeId)).all();
      return { uses: rows.length, lastUsedAt: rows.length ? Math.max(...rows.map((r) => r.createdAt)) : null };
    },
    update(id, patch) {
      const row = db.select().from(generationRecords).where(eq(generationRecords.id, id)).get();
      if (!row) throw new DomainError(`生成记录不存在: ${id}`, 'record_not_found');
      if (patch.recipeId !== undefined && patch.recipeId !== null) {
        if (!db.select({ id: recipes.id }).from(recipes).where(eq(recipes.id, patch.recipeId)).get()) {
          throw new DomainError(`关联的配方不存在: ${patch.recipeId}`, 'recipe_not_found');
        }
      }
      let needsManual = row.needsManual == null ? [] : (JSON.parse(row.needsManual) as NeedsManualField[]);
      if (patch.resolveManual !== undefined && patch.resolveManual.length > 0) {
        const set = new Set(patch.resolveManual);
        needsManual = needsManual.filter((n) => !set.has(n.field));
      }
      const updated = {
        ...row,
        tool: patch.tool ?? row.tool,
        prompt: patch.prompt ?? row.prompt,
        note: patch.note ?? row.note,
        recipeId: patch.recipeId === undefined ? row.recipeId : patch.recipeId,
        needsManual: needsManual.length ? JSON.stringify(needsManual) : '[]',
      };
      db.update(generationRecords)
        .set({ tool: updated.tool, prompt: updated.prompt, note: updated.note, recipeId: updated.recipeId, needsManual: updated.needsManual })
        .where(eq(generationRecords.id, id))
        .run();
      return rowToRecord(updated, loadArtifacts(id));
    },
  };
}
