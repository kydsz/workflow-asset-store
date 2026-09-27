import { real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const recipes = sqliteTable('recipes', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  tool: text('tool'),
  workflowFilePath: text('workflow_file_path'),
  prompt: text('prompt'),
  params: text('params'),
  tags: text('tags').notNull().default('[]'),
  contentHash: text('content_hash'),
  owner: text('owner').notNull().default('local'),
  createdAt: real('created_at').notNull(),
  deletedAt: real('deleted_at'),
});

export const generationRecords = sqliteTable('generation_records', {
  id: text('id').primaryKey(),
  tool: text('tool').notNull(),
  recipeId: text('recipe_id').references(() => recipes.id),
  prompt: text('prompt'),
  params: text('params'),
  workflowFilePath: text('workflow_file_path'),
  note: text('note'),
  tags: text('tags').notNull().default('[]'),
  needsManual: text('needs_manual'),
  ingestSource: text('ingest_source'),
  owner: text('owner').notNull().default('local'),
  createdAt: real('created_at').notNull(),
  deletedAt: real('deleted_at'),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  recordId: text('record_id')
    .notNull()
    .references(() => generationRecords.id),
  path: text('path').notNull(),
  mediaType: text('media_type').notNull(),
  storageMode: text('storage_mode'),
  fileHash: text('file_hash'),
  createdAt: real('created_at').notNull(),
});

export type RecipeRow = typeof recipes.$inferSelect;
export type GenerationRecordRow = typeof generationRecords.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
