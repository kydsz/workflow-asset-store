import { createHash } from 'node:crypto';
import { extname } from 'node:path';

export type SourceKind = 'comfyui' | 'png' | 'json' | 'unknown';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_CHUNK_LIMIT = 64 * 1024 * 1024;

export function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, normalizeJson(v)]),
    );
  }
  return value;
}

export const canonicalJson = (value: unknown) => JSON.stringify(normalizeJson(value));

interface PngTextChunk {
  keyword: string;
  text: string;
}

function isCrcValid(typeAndData: Buffer, expectedCrc: number): boolean {
  let c = -1;
  for (const b of typeAndData) {
    c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  }
  return (~c >>> 0) === expectedCrc;
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** 遍历 PNG tEXt 块；CRC 损坏的块直接跳过而不是抛错 */
export function readPngTextChunks(buf: Buffer): PngTextChunk[] {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) return [];
  const out: PngTextChunk[] = [];
  let off = 8;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (len > TEXT_CHUNK_LIMIT || off + 12 + len > buf.length) break;
    const data = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    if (type === 'tEXt' && isCrcValid(buf.subarray(off + 4, off + 8 + len), crc)) {
      const nul = data.indexOf(0);
      if (nul > 0) {
        out.push({ keyword: data.toString('latin1', 0, nul), text: data.toString('latin1', nul + 1) });
      }
    }
    if (type === 'IEND') break;
    off += 12 + len;
  }
  return out;
}

function looksLikeComfyJson(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj['nodes'])) return true;
  return Object.values(obj).some((v) => v && typeof v === 'object' && 'class_type' in v);
}

export function sniffSource(buf: Buffer, name: string): SourceKind {
  if (buf.subarray(0, 8).equals(PNG_SIG)) {
    const chunks = readPngTextChunks(buf);
    return chunks.some((c) => c.keyword === 'prompt' || c.keyword === 'workflow') ? 'comfyui' : 'png';
  }
  if (extname(name).toLowerCase() === '.json') {
    try {
      return looksLikeComfyJson(JSON.parse(buf.toString('utf8'))) ? 'comfyui' : 'json';
    } catch {
      return 'unknown';
    }
  }
  return 'unknown';
}

export interface ExtractResult {
  tool?: string;
  prompts?: string[];
  negative?: string;
  params?: Record<string, unknown>;
  /** 归并配方用的工作流内容（优先 ui workflow，其次 API prompt 图） */
  recipeContent?: unknown;
  contentHash?: string;
}

interface JsonFlow {
  class_type?: string;
  inputs?: Record<string, unknown>;
  widgets_values?: unknown[];
  type?: string;
}

function isFlowLike(value: unknown): value is Record<string, JsonFlow> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).some(
    (v) => v && typeof v === 'object' && 'class_type' in v,
  );
}

function nodesList(value: unknown): JsonFlow[] {
  if (!value || typeof value !== 'object') return [];
  const nodes = (value as Record<string, unknown>)['nodes'];
  return Array.isArray(nodes) ? (nodes as JsonFlow[]) : [];
}

/** CLIPTextEncode 及自定义文本编码节点（如 TextEncodeQwenImage21）类型名均含 TextEncode */
const isTextEncodeNode = (t: string | undefined) => typeof t === 'string' && /textencode/i.test(t);

function collectTexts(json: unknown): string[] {
  const texts: string[] = [];
  if (isFlowLike(json)) {
    for (const node of Object.values(json)) {
      if (!isTextEncodeNode(node?.class_type)) continue;
      const i = node.inputs ?? {};
      for (const key of ['text', 'prompt'] as const) {
        const t = i[key];
        if (typeof t === 'string' && t.trim()) {
          texts.push(t.trim());
          break;
        }
      }
    }
  }
  if (!texts.length) {
    for (const node of nodesList(json)) {
      if (!isTextEncodeNode(node?.type) || !Array.isArray(node.widgets_values)) continue;
      const t = node.widgets_values.find((w) => typeof w === 'string' && (w as string).trim());
      if (typeof t === 'string') texts.push(t.trim());
    }
  }
  return texts;
}

function collectSamplerParams(json: unknown): Record<string, unknown> {
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  if (isFlowLike(json)) {
    for (const node of Object.values(json)) {
      if (node?.class_type === 'KSampler') {
        const i = node.inputs ?? {};
        return { seed: num(i['seed']), steps: num(i['steps']), cfg: num(i['cfg']), sampler_name: str(i['sampler_name']), scheduler: str(i['scheduler']) };
      }
    }
  }
  for (const node of nodesList(json)) {
    if (node?.type === 'KSampler' && Array.isArray(node.widgets_values)) {
      const w = node.widgets_values;
      return { seed: num(w[0]), steps: num(w[2]), cfg: num(w[3]), sampler_name: str(w[4]), scheduler: str(w[5]) };
    }
  }
  return {};
}

function compact(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** 模板占位符：配方内容里存哨兵，导出时回填当次提示词/seed（stripVolatile/rehydrateTemplate 成对使用） */
export const WAS_PROMPT = '__was_prompt';
export const WAS_SEED = '__was_seed';
const WAS_SENTINELS = new Set<string>([WAS_PROMPT, WAS_SEED]);

/** 配方模板化：剥离运行相关的正向提示词（首个文本编码节点）与各 KSampler 的 seed，使「只改提示词/换 seed」的图归并到同一配方 */
export function stripVolatile(json: unknown): unknown {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return json;
  const root = structuredClone(json) as Record<string, unknown>;
  if (Array.isArray(root['nodes'])) {
    // 画布视图噪音不属于配方身份：平移/缩放、节点坐标、前端簿记字段一并剥离
    delete root['extra'];
    delete root['config'];
    delete root['widget_idx_map'];
    for (const n of root['nodes'] as JsonFlow[] & Record<string, unknown>[]) {
      delete (n as Record<string, unknown>)['pos'];
      delete (n as Record<string, unknown>)['size'];
      delete (n as Record<string, unknown>)['bgcolor'];
      delete (n as Record<string, unknown>)['flags'];
    }
    let promptSet = false;
    for (const n of root['nodes'] as JsonFlow[]) {
      if (!Array.isArray(n.widgets_values)) continue;
      if (!promptSet && isTextEncodeNode(n.type)) {
        const idx = n.widgets_values.findIndex((w) => typeof w === 'string' && w.trim());
        if (idx >= 0) {
          n.widgets_values[idx] = WAS_PROMPT;
          promptSet = true;
        }
      }
      if (n.type === 'KSampler' && n.widgets_values.length) {
        // 与 collectSamplerParams 同一约定：KSampler 首控件即 seed
        n.widgets_values[0] = WAS_SEED;
      }
    }
    return root;
  }
  let promptSet = false;
  for (const node of Object.values(root)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const n = node as { class_type?: string; inputs?: Record<string, unknown> };
    if (!n.inputs) continue;
    if (!promptSet && isTextEncodeNode(n.class_type)) {
      for (const key of ['text', 'prompt'] as const) {
        if (typeof n.inputs[key] === 'string' && (n.inputs[key] as string).trim()) {
          n.inputs[key] = WAS_PROMPT;
          promptSet = true;
          break;
        }
      }
    }
    if (n.class_type === 'KSampler' && (typeof n.inputs['seed'] === 'number' || typeof n.inputs['seed'] === 'string')) {
      n.inputs['seed'] = WAS_SEED;
    }
  }
  return root;
}

export function containsTemplateSentinel(json: unknown): boolean {
  if (Array.isArray(json)) return json.some(containsTemplateSentinel);
  if (json && typeof json === 'object') return Object.values(json).some(containsTemplateSentinel);
  return typeof json === 'string' && WAS_SENTINELS.has(json);
}

/** 导出前回填：把模板哨兵替换为当次具体值（未提供的字段保留哨兵原样） */
export function rehydrateTemplate(json: unknown, patch: { prompt?: string; seed?: number | string }): unknown {
  if (!json || typeof json !== 'object') return json;
  const sub = (v: unknown): unknown => (v === WAS_PROMPT ? (patch.prompt ?? v) : v === WAS_SEED ? (patch.seed ?? v) : walk(v));
  const walk = (value: unknown): unknown => {
    // widgets_values 这类数组槽位要按元素替换，字符串级哨兵不能只在对象分支处理
    if (Array.isArray(value)) return value.map(sub);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = sub(v);
      return out;
    }
    return value;
  };
  return walk(json);
}

/** ComfyUI 元数据解析：PNG tEXt(prompt/workflow) 或 JSON 导出（自动解析，ADR 见 docs/architecture.md） */
export function extractComfyui(buf: Buffer, name: string): ExtractResult {
  let workflowJson: unknown;
  let promptJson: unknown;

  if (buf.subarray(0, 8).equals(PNG_SIG)) {
    for (const c of readPngTextChunks(buf)) {
      if (c.keyword !== 'prompt' && c.keyword !== 'workflow') continue;
      try {
        const json = JSON.parse(c.text);
        if (c.keyword === 'workflow' && workflowJson === undefined) workflowJson = json;
        if (c.keyword === 'prompt' && promptJson === undefined) promptJson = json;
      } catch {
        /* 解析失败按缺失处理，交手动补录 */
      }
    }
  } else {
    try {
      workflowJson = JSON.parse(buf.toString('utf8'));
    } catch {
      workflowJson = undefined;
    }
  }

  const recipeContent = workflowJson === undefined && promptJson === undefined ? undefined : stripVolatile(workflowJson ?? promptJson);
  const flowSource = promptJson ?? workflowJson;
  const texts = collectTexts(flowSource);
  const params = collectSamplerParams(flowSource);
  const negative = texts.length > 1 ? texts[1] : undefined;

  return {
    tool: 'comfyui',
    prompts: texts.length ? [texts[0]!] : undefined,
    negative,
    params: Object.keys(params).length ? params : undefined,
    recipeContent,
    contentHash: recipeContent === undefined ? undefined : sha256hex(Buffer.from(canonicalJson(recipeContent))),
  };
}
