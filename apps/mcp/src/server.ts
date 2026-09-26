import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createTools } from './tools.js';

const ASSET_DATA_DIR = process.env.ASSET_DATA_DIR ?? 'data';
const tools = createTools({ dataDir: ASSET_DATA_DIR });

const server = new McpServer({ name: 'workflow-asset-store', version: '0.0.0' });

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

server.registerTool(
  'search_generations',
  {
    description: '检索生成记录：全文（提示词/备注/配方名/参数值）+ 工具/媒体/配方/待补录/时间过滤',
    inputSchema: {
      query: z.string().optional(),
      tool: z.string().optional(),
      media_type: z.enum(['image', 'video']).optional(),
      has_recipe: z.boolean().optional(),
      needs_manual: z.boolean().optional(),
      since: z.number().optional(),
      until: z.number().optional(),
      sort: z.enum(['newest-first', 'oldest-first']).optional(),
      limit: z.number().optional(),
    },
  },
  (args) => json(tools.search_generations(args)),
);

server.registerTool('get_generation', { description: '取单条生成记录完整溯源', inputSchema: { id: z.string() } }, (args) => json(tools.get_generation(args)));

server.registerTool(
  'list_recipes',
  { description: '列出生成配方，可按形态/工具/关键词过滤', inputSchema: { kind: z.enum(['workflow-file', 'param-preset', 'prompt-template']).optional(), tool: z.string().optional(), query: z.string().optional() } },
  (args) => json(tools.list_recipes(args)),
);

server.registerTool('get_recipe', { description: '取单个生成配方', inputSchema: { id: z.string() } }, (args) => json(tools.get_recipe(args)));

server.registerTool('record_stats', { description: '某配方的使用统计', inputSchema: { recipe_id: z.string() } }, (args) => json(tools.record_stats(args)));

server.registerTool(
  'ingest',
  {
    description: '入库：传本机文件路径自动解析（ComfyUI 优先），可附显式字段；mode 缺省 copy',
    inputSchema: {
      files: z.array(z.string()).default([]),
      mode: z.enum(['copy', 'reference']).optional(),
      tool: z.string().optional(),
      prompt: z.string().optional(),
      params: z.record(z.string(), z.unknown()).optional(),
    },
  },
  (args) => json(tools.ingest(args)),
);

await server.connect(new StdioServerTransport());
