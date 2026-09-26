import { createLibrary, type IngestExplicit, type Library, type RecipeSearchQuery, type SearchQuery, type StorageMode } from '@was/core';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface Tools {
  TOOL_SPECS: ToolSpec[];
  search_generations: (args: Record<string, unknown>) => unknown;
  get_generation: (args: Record<string, unknown>) => unknown;
  list_recipes: (args: Record<string, unknown>) => unknown;
  get_recipe: (args: Record<string, unknown>) => unknown;
  record_stats: (args: Record<string, unknown>) => unknown;
  ingest: (args: Record<string, unknown>) => unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' ? v : undefined);

export function createTools(options: { lib?: Library; dataDir: string }): Tools {
  const lib = options.lib ?? createLibrary({ dataDir: options.dataDir });

  return {
    TOOL_SPECS: [
      {
        name: 'search_generations',
        description: '检索生成记录：全文（提示词/备注/配方名/参数值）+ 工具/媒体/配方/待补录/时间过滤，按生成时间排序',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            tool: { type: 'string' },
            media_type: { type: 'string', enum: ['image', 'video'] },
            has_recipe: { type: 'boolean' },
            needs_manual: { type: 'boolean' },
            since: { type: 'number', description: '生成时间下界（epoch ms）' },
            until: { type: 'number' },
            sort: { type: 'string', enum: ['newest-first', 'oldest-first'] },
            limit: { type: 'number' },
          },
        },
      },
      { name: 'get_generation', description: '取单条生成记录完整溯源（含产物、参数、needs_manual）', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
      { name: 'list_recipes', description: '列出生成配方，可按形态/工具/关键词过滤', inputSchema: { type: 'object', properties: { kind: { type: 'string' }, tool: { type: 'string' }, query: { type: 'string' } } } },
      { name: 'get_recipe', description: '取单个生成配方', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
      { name: 'record_stats', description: '某配方的使用统计（生成次数、最近使用）', inputSchema: { type: 'object', properties: { recipe_id: { type: 'string' } }, required: ['recipe_id'] } },
      {
        name: 'ingest',
        description: '入库：传本机文件路径自动解析（ComfyUI 优先），可附显式字段；mode 缺省 copy',
        inputSchema: {
          type: 'object',
          properties: {
            files: { type: 'array', items: { type: 'string' } },
            mode: { type: 'string', enum: ['copy', 'reference'] },
            tool: { type: 'string' },
            prompt: { type: 'string' },
            params: { type: 'object' },
          },
        },
      },
    ],

    search_generations(args) {
      const q: SearchQuery = {
        query: str(args.query),
        tool: str(args.tool),
        mediaType: str(args.media_type) as SearchQuery['mediaType'],
        hasRecipe: bool(args.has_recipe),
        needsManual: bool(args.needs_manual),
        since: num(args.since),
        until: num(args.until),
        sort: args.sort === 'oldest-first' ? 'oldest-first' : 'newest-first',
        limit: num(args.limit),
      };
      const results = lib.records.search(q).map((r) => ({
        id: r.id,
        tool: r.tool,
        prompt: r.prompt,
        recipe_id: r.recipeId,
        created_at: r.createdAt,
        needs_manual: (r.needsManual ?? []).map((n) => n.field),
        artifact_count: r.artifacts.length,
      }));
      return { results, count: results.length };
    },

    get_generation(args) {
      const rec = lib.records.get(String(args.id));
      if (!rec) throw new Error(`生成记录不存在: ${String(args.id)}`);
      return rec;
    },

    list_recipes(args) {
      const q: RecipeSearchQuery = { query: str(args.query), tool: str(args.tool), kind: str(args.kind) as RecipeSearchQuery['kind'] };
      return { results: lib.recipes.search(q) };
    },

    get_recipe(args) {
      const r = lib.recipes.get(String(args.id));
      if (!r) throw new Error(`配方不存在: ${String(args.id)}`);
      return r;
    },

    record_stats(args) {
      const recipeId = String(args.recipe_id);
      const s = lib.records.stats(recipeId);
      return { recipe_id: recipeId, count: s.uses, last_used_at: s.lastUsedAt };
    },

    ingest(args) {
      try {
        const files = Array.isArray(args.files) ? args.files.map(String) : [];
        const mode: StorageMode = args.mode === 'reference' ? 'reference' : 'copy';
        const explicit: IngestExplicit = {};
        const tool = str(args.tool);
        const prompt = str(args.prompt);
        const params = args.params as Record<string, unknown> | undefined;
        if (tool !== undefined) explicit.tool = tool;
        if (prompt !== undefined) explicit.prompt = prompt;
        if (params !== undefined) explicit.params = params;
        const results = lib.ingest({ sources: files, explicit, mode });
        const collected = new Set<string>();
        for (const r of results) if (r.status === 'collected' && r.recipeId) collected.add(r.recipeId);
        return {
          status: 'ok',
          created: results.filter((r) => r.status === 'created').length,
          skipped_existing: results.filter((r) => r.status === 'existing').length,
          collected_recipes: collected.size,
          record_ids: results.flatMap((r) => (r.recordId ? [r.recordId] : [])),
        };
      } catch (e) {
        return { status: 'error', message: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
