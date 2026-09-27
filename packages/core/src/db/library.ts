import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { and, count, desc, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
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
    created_at REAL NOT NULL,
    deleted_at REAL
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
    created_at REAL NOT NULL,
    deleted_at REAL
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
  'ALTER TABLE recipes ADD COLUMN deleted_at REAL',
  'ALTER TABLE generation_records ADD COLUMN deleted_at REAL',
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
    deletedAt: row.deletedAt ?? undefined,
  };
  if (row.kind === 'workflow-file') return { ...base, workflowFilePath: row.workflowFilePath ?? '' };
  if (row.kind === 'prompt-template') return { ...base, prompt: row.prompt ?? '' };
  return { ...base, params: JSON.parse(row.params ?? '{}') as Record<string, unknown> };
}

export interface RecipeRepository {
  create(input: NewRecipe): Recipe;
  get(id: string): Recipe | undefined;
  /** 在库配方（不含回收站） */
  list(): Recipe[];
  findByContentHash(contentHash: string): Recipe | undefined;
  search(query: RecipeSearchQuery): Recipe[];
  /** 待补录回填：纯收藏配方后续拿到工作流文件时补上 */
  backfill(id: string, patch: { workflowFilePath?: string; contentHash?: string }): Recipe;
  /** 仅改显示名：模板身份（contentHash）与运行值不受影响 */
  rename(id: string, name: string): Recipe;
  /** 移入回收站（软删除），返回实际移动条数 */
  trash(ids: string[]): number;
  restore(id: string): Recipe;
  /** 物理删除配方行：先把引用它的生成记录 recipe_id 置空 */
  purge(id: string): void;
  listTrash(): Recipe[];
  countTrash(): number;
  /** 工作流文件是否仍被其他配方引用（内容寻址文件可被副本共用） */
  isWorkflowPathUsed(path: string, exceptId?: string): boolean;
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
        deletedAt: null,
      };
      db.insert(recipes).values(row).run();
      return rowToRecipe(row);
    },
    get(id) {
      const row = db.select().from(recipes).where(eq(recipes.id, id)).get();
      return row && rowToRecipe(row);
    },
    list() {
      return db.select().from(recipes).where(isNull(recipes.deletedAt)).all().map(rowToRecipe);
    },
    findByContentHash(contentHash) {
      const row = db
        .select()
        .from(recipes)
        .where(and(eq(recipes.contentHash, contentHash), isNull(recipes.deletedAt)))
        .get();
      return row ? rowToRecipe(row) : undefined;
    },
    search(q) {
      const conds: (SQL | undefined)[] = [isNull(recipes.deletedAt)];
      if (q.kind) conds.push(eq(recipes.kind, q.kind));
      if (q.tool) conds.push(eq(recipes.tool, q.tool));
      let rows = db.select().from(recipes).where(and(...conds)).all();
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
    rename(id, name) {
      const trimmed = name.trim();
      if (!trimmed) throw new DomainError('配方必须有名称', 'recipe_name_required');
      const row = db.select().from(recipes).where(and(eq(recipes.id, id), isNull(recipes.deletedAt))).get();
      if (!row) throw new DomainError(`配方不存在: ${id}`, 'recipe_not_found');
      db.update(recipes).set({ name: trimmed }).where(eq(recipes.id, id)).run();
      return rowToRecipe({ ...row, name: trimmed });
    },
    trash(ids) {
      const now = Date.now();
      let moved = 0;
      db.transaction((tx) => {
        for (const id of ids) {
          const hit = tx
            .update(recipes)
            .set({ deletedAt: now })
            .where(and(eq(recipes.id, id), isNull(recipes.deletedAt)))
            .run();
          if ((hit.changes ?? 0) > 0) moved++;
        }
      });
      return moved;
    },
    restore(id) {
      const row = db.select().from(recipes).where(eq(recipes.id, id)).get();
      if (!row) throw new DomainError(`配方不存在: ${id}`, 'recipe_not_found');
      // 回收站中的配方不参与模板归并，期间同模板可能已另建配方；直接放回会留下两个同哈希身份
      if (row.contentHash) {
        const clash = db
          .select({ id: recipes.id, name: recipes.name })
          .from(recipes)
          .where(and(eq(recipes.contentHash, row.contentHash), isNull(recipes.deletedAt), sql`${recipes.id} != ${id}`))
          .get();
        if (clash) throw new DomainError(`在库已有同模板配方: ${clash.name}`, 'recipe_restore_conflict');
      }
      db.update(recipes).set({ deletedAt: null }).where(eq(recipes.id, id)).run();
      return rowToRecipe({ ...row, deletedAt: null });
    },
    purge(id) {
      const row = db.select().from(recipes).where(eq(recipes.id, id)).get();
      if (!row) throw new DomainError(`配方不存在: ${id}`, 'recipe_not_found');
      db.transaction((tx) => {
        tx.update(generationRecords).set({ recipeId: null }).where(eq(generationRecords.recipeId, id)).run();
        tx.delete(recipes).where(eq(recipes.id, id)).run();
      });
    },
    listTrash() {
      return db
        .select()
        .from(recipes)
        .where(isNotNull(recipes.deletedAt))
        .orderBy(desc(recipes.deletedAt))
        .all()
        .map(rowToRecipe);
    },
    countTrash() {
      return db.select({ n: count() }).from(recipes).where(isNotNull(recipes.deletedAt)).get()?.n ?? 0;
    },
    isWorkflowPathUsed(path, exceptId) {
      const conds: (SQL | undefined)[] = [eq(recipes.workflowFilePath, path)];
      if (exceptId) conds.push(sql`${recipes.id} != ${exceptId}`);
      return db.select({ id: recipes.id }).from(recipes).where(and(...conds)).get() !== undefined;
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
    deletedAt: row.deletedAt ?? undefined,
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
  /** 含回收站条目（deletedAt 非空），供详情页展示 */
  get(id: string): GenerationRecord | undefined;
  listByRecipe(recipeId: string): GenerationRecord[];
  findByFileHash(fileHash: string): GenerationRecord | undefined;
  /** 在库记录（回收站条目不出现） */
  search(query: SearchQuery): GenerationRecord[];
  stats(recipeId: string): RecordStats;
  update(id: string, patch: RecordPatch): GenerationRecord;
  /** 移入回收站（软删除），返回实际移动条数 */
  trash(ids: string[]): number;
  restore(id: string): GenerationRecord;
  /** 物理删除记录行及其产物行；文件清理由 lib.purgeRecord 负责 */
  purge(id: string): void;
  listTrash(): GenerationRecord[];
  countTrash(): number;
  /** 产物文件是否仍被其它记录引用（内容寻址文件可被多条记录共用） */
  isArtifactPathUsed(path: string): boolean;
  /** 是否有生成记录仍引用该工作流文件路径 */
  isWorkflowPathUsed(path: string): boolean;
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
        deletedAt: null,
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
        .where(and(eq(generationRecords.recipeId, recipeId), isNull(generationRecords.deletedAt)))
        .all()
        .map((row) => rowToRecord(row, loadArtifacts(row.id)));
    },
    findByFileHash(fileHash) {
      const hit = db
        .select({ recordId: artifacts.recordId })
        .from(artifacts)
        .innerJoin(generationRecords, eq(generationRecords.id, artifacts.recordId))
        .where(and(eq(artifacts.fileHash, fileHash), isNull(generationRecords.deletedAt)))
        .get();
      return hit ? this.get(hit.recordId) : undefined;
    },
    search(q) {
      const conds: (SQL | undefined)[] = [isNull(generationRecords.deletedAt)];
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
      const where = and(...conds);
      const order = q.sort === 'oldest-first' ? sql`${generationRecords.createdAt} ASC` : desc(generationRecords.createdAt);
      const limit = q.limit ?? 100;
      const rows = db.select().from(generationRecords).where(where).orderBy(order).limit(limit).all();
      return rows.map((row) => rowToRecord(row, loadArtifacts(row.id)));
    },
    stats(recipeId) {
      const rows = db
        .select({ createdAt: generationRecords.createdAt })
        .from(generationRecords)
        .where(and(eq(generationRecords.recipeId, recipeId), isNull(generationRecords.deletedAt)))
        .all();
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
    trash(ids) {
      const now = Date.now();
      let moved = 0;
      db.transaction((tx) => {
        for (const id of ids) {
          const hit = tx
            .update(generationRecords)
            .set({ deletedAt: now })
            .where(and(eq(generationRecords.id, id), isNull(generationRecords.deletedAt)))
            .run();
          if ((hit.changes ?? 0) > 0) moved++;
        }
      });
      return moved;
    },
    restore(id) {
      const row = db.select().from(generationRecords).where(eq(generationRecords.id, id)).get();
      if (!row) throw new DomainError(`生成记录不存在: ${id}`, 'record_not_found');
      db.update(generationRecords).set({ deletedAt: null }).where(eq(generationRecords.id, id)).run();
      return rowToRecord({ ...row, deletedAt: null }, loadArtifacts(id));
    },
    purge(id) {
      const row = db.select().from(generationRecords).where(eq(generationRecords.id, id)).get();
      if (!row) throw new DomainError(`生成记录不存在: ${id}`, 'record_not_found');
      db.transaction((tx) => {
        tx.delete(artifacts).where(eq(artifacts.recordId, id)).run();
        tx.delete(generationRecords).where(eq(generationRecords.id, id)).run();
      });
    },
    listTrash() {
      return db
        .select()
        .from(generationRecords)
        .where(isNotNull(generationRecords.deletedAt))
        .orderBy(desc(generationRecords.deletedAt))
        .all()
        .map((row) => rowToRecord(row, loadArtifacts(row.id)));
    },
    countTrash() {
      return db.select({ n: count() }).from(generationRecords).where(isNotNull(generationRecords.deletedAt)).get()?.n ?? 0;
    },
    isArtifactPathUsed(path) {
      return db.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.path, path)).get() !== undefined;
    },
    isWorkflowPathUsed(path) {
      return db.select({ id: generationRecords.id }).from(generationRecords).where(eq(generationRecords.workflowFilePath, path)).get() !== undefined;
    },
  };
}
