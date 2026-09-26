export type RecipeKind = 'workflow-file' | 'param-preset' | 'prompt-template';

export type ArtifactMediaType = 'image' | 'video';

export type StorageMode = 'copy' | 'reference';

export interface Artifact {
  path: string;
  mediaType: ArtifactMediaType;
  /** copy 模式为 data/files/ 内的相对路径；reference 模式保留原路径（ADR-0004） */
  storageMode?: StorageMode;
  /** 源文件内容哈希，用于重复入库去重 */
  fileHash?: string;
}

interface RecipeFields {
  name: string;
  tool?: string | undefined;
  tags?: string[] | undefined;
  owner?: string | undefined;
}

export type NewRecipe = RecipeFields &
  (
    /** workflow-file 允许先建档、文件后补（backfill） */
    | { kind: 'workflow-file'; workflowFilePath?: string | undefined; prompt?: undefined; params?: undefined; contentHash?: string | undefined }
    | { kind: 'prompt-template'; prompt: string; workflowFilePath?: undefined; params?: undefined; contentHash?: undefined }
    | { kind: 'param-preset'; params: Record<string, unknown>; workflowFilePath?: undefined; prompt?: undefined; contentHash?: undefined }
  );

export type Recipe = { id: string; kind: RecipeKind; name: string; owner: string; createdAt: number } & Omit<
  NewRecipe,
  'owner'
>;

/** 待补录原因码：界面按 code 取词，reason 字段是人类可读兜底 */
export type NeedsManualCode =
  | 'tool_not_detected'
  | 'prompt_not_parsed'
  | 'workflow_metadata_absent'
  | 'workflow_content_not_parsed'
  | 'media_type_ambiguous';

export const NEEDS_MANUAL_CODES: NeedsManualCode[] = [
  'tool_not_detected',
  'prompt_not_parsed',
  'workflow_metadata_absent',
  'workflow_content_not_parsed',
  'media_type_ambiguous',
];

export interface NeedsManualField {
  field: string;
  reason: string;
  reasonCode?: NeedsManualCode;
}

interface GenerationRecordFields {
  tool: string;
  recipeId?: string | undefined;
  prompt?: string | undefined;
  params?: Record<string, unknown> | undefined;
  workflowFilePath?: string | undefined;
  note?: string | undefined;
  tags?: string[] | undefined;
  owner?: string | undefined;
  /** 自动解析缺失、待手动补录的字段（进入 /incomplete 队列） */
  needsManual?: NeedsManualField[] | undefined;
  ingestSource?: 'auto-extract' | 'manual' | undefined;
}

export interface NewGenerationRecord extends GenerationRecordFields {
  artifacts: Artifact[];
}

export interface GenerationRecord extends GenerationRecordFields {
  id: string;
  artifacts: Artifact[];
  owner: string;
  createdAt: number;
}

export interface SearchQuery {
  /** 全文命中提示词、备注、配方名、参数值 */
  query?: string;
  tool?: string;
  mediaType?: ArtifactMediaType;
  hasRecipe?: boolean;
  needsManual?: boolean;
  since?: number;
  until?: number;
  sort?: 'newest-first' | 'oldest-first';
  limit?: number;
}

export interface RecipeSearchQuery {
  query?: string;
  kind?: RecipeKind;
  tool?: string;
  limit?: number;
}

export interface RecordStats {
  uses: number;
  lastUsedAt: number | null;
}

export interface RecordPatch {
  tool?: string;
  prompt?: string;
  note?: string;
  recipeId?: string | null;
  /** 本次已补录/忽略的 needs_manual 字段；空数组为无操作 */
  resolveManual?: string[];
}
