import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { containsTemplateSentinel, extractComfyui, rehydrateTemplate, sniffSource, WAS_PROMPT, WAS_SEED } from '../extractors/index.js';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  }
  return ~c;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function textChunk(keyword: string, value: string): Buffer {
  return chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')]));
}

function makePng(chunks: Buffer[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...chunks,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ComfyUI API 格式（/prompt 提交体），含 1 个正向 + 1 个负向 CLIPTextEncode */
const apiPrompt = {
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat astronaut, cinematic light' } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, worst quality' } },
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 12345, steps: 30, cfg: 4.5, sampler_name: 'dpmpp_2m', scheduler: 'karras' },
  },
};

/** ComfyUI ui 工作流格式（workflow JSON 导出） */
const uiWorkflow = {
  nodes: [
    { id: 6, type: 'CLIPTextEncode', widgets_values: ['a dog astronaut'] },
    { id: 3, type: 'KSampler', widgets_values: [999, 'randomize', 20, 7, 'euler', 'normal', 1] },
  ],
  links: [],
};

const comfyPng = makePng([
  textChunk('prompt', JSON.stringify(apiPrompt, null, 2)),
  textChunk('workflow', JSON.stringify(uiWorkflow)),
]);

describe('sniffSource', () => {
  it('识别 ComfyUI PNG 与普通 PNG、JSON 的区别', () => {
    expect(sniffSource(comfyPng, 'out.png')).toBe('comfyui');
    expect(sniffSource(makePng([]), 'plain.png')).toBe('png');
    expect(sniffSource(Buffer.from(JSON.stringify(apiPrompt)), 'wf.json')).toBe('comfyui');
    expect(sniffSource(Buffer.from('hello'), 'notes.txt')).toBe('unknown');
  });
});

describe('ComfyUI 自动解析', () => {
  it('API 格式 PNG：提取正向提示词、负向提示词与采样参数', () => {
    const r = extractComfyui(comfyPng, 'out.png');
    expect(r.tool).toBe('comfyui');
    expect(r.prompts).toContain('a cat astronaut, cinematic light');
    expect(r.negative).toBe('blurry, worst quality');
    expect(r.params).toMatchObject({ seed: 12345, steps: 30, cfg: 4.5, sampler_name: 'dpmpp_2m', scheduler: 'karras' });
  });

  it('ui workflow 格式：从 widgets_values 提取提示词与参数', () => {
    const r = extractComfyui(Buffer.from(JSON.stringify(uiWorkflow)), 'wf.json');
    expect(r.prompts).toContain('a dog astronaut');
    expect(r.params).toMatchObject({ seed: 999, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal' });
  });

  it('workflow 优先于 prompt 作为配方内容（哈希取更完整的一份），内容为剥离 prompt/seed 的模板', () => {
    const withBoth = extractComfyui(comfyPng, 'out.png');
    const workflowOnly = makePng([textChunk('workflow', JSON.stringify(uiWorkflow))]);
    const r = extractComfyui(workflowOnly, 'w.png');
    const strippedUi = {
      nodes: [
        { id: 6, type: 'CLIPTextEncode', widgets_values: [WAS_PROMPT] },
        { id: 3, type: 'KSampler', widgets_values: [WAS_SEED, 'randomize', 20, 7, 'euler', 'normal', 1] },
      ],
      links: [],
    };
    expect(withBoth.recipeContent).toEqual(strippedUi);
    expect(r.recipeContent).toEqual(strippedUi);
  });

  it('CRC 损坏的 tEXt 块被忽略而不是抛错，其余块照常解析', () => {
    const bad = Buffer.from(comfyPng);
    // 破坏 prompt 块的 CRC：该块应被跳过，文本改从存活的 workflow 块 best-effort 提取
    const promptDataStart = bad.indexOf(Buffer.from(apiPrompt['6']!.class_type!, 'latin1'));
    bad.writeUInt32BE(0xdeadbeef, promptDataStart - 4);
    const r = extractComfyui(bad, 'broken.png');
    expect(r.prompts).toEqual(['a dog astronaut']);
    expect((r.recipeContent as { nodes: { widgets_values: unknown[] }[] }).nodes[0]!.widgets_values).toEqual([WAS_PROMPT]);
  });

  it('自定义文本编码节点（如 TextEncodeQwenImage21）也能提取提示词', () => {
    const qwenWorkflow = {
      nodes: [
        { id: 469, type: 'TextEncodeQwenImage21', widgets_values: ['长城扁平插画', 'some-style'] },
        { id: 474, type: 'KSampler', widgets_values: [449131521243677, 'randomize', 25, 1, 'euler', 'simple', 1] },
      ],
      links: [],
    };
    const r = extractComfyui(Buffer.from(JSON.stringify(qwenWorkflow)), 'qwen.json');
    expect(r.prompts).toEqual(['长城扁平插画']);
    expect(r.params).toMatchObject({ steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple' });
  });

  it('解析不到任何字段时返回空结果，由上层标 needs_manual', () => {
    const r = extractComfyui(makePng([]), 'plain.png');
    expect(r.prompts).toBeUndefined();
    expect(r.recipeContent).toBeUndefined();
    expect(r.params).toBeUndefined();
  });

  it('无 text 的 CLIPTextEncode 不算有效提示词', () => {
    const r = extractComfyui(Buffer.from(JSON.stringify({ '1': { class_type: 'CLIPTextEncode', inputs: {} } })), 'x.json');
    expect(r.prompts).toBeUndefined();
  });
});

describe('模板哈希：只改提示词/seed 归并同一配方', () => {
  const apiWith = (text: string, seed: number) => ({
    '6': { class_type: 'CLIPTextEncode', inputs: { text } },
    '3': { class_type: 'KSampler', inputs: { seed, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal' } },
  });
  const pngOf = (flow: unknown) => makePng([textChunk('prompt', JSON.stringify(flow))]);

  it('API 图：提示词与 seed 不同但内容哈希一致，记录侧仍解析出当次值', () => {
    const a = extractComfyui(pngOf(apiWith('cat', 1)), 'a.png');
    const b = extractComfyui(pngOf(apiWith('dog', 999)), 'b.png');
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.prompts).toEqual(['cat']);
    expect(b.prompts).toEqual(['dog']);
    expect(b.params).toMatchObject({ seed: 999 });
  });

  it('steps/cfg 等其余参数变化仍算不同配方（界内约定）', () => {
    const base = extractComfyui(pngOf(apiWith('cat', 1)), 'a.png');
    const changed = JSON.parse(JSON.stringify(apiWith('cat', 1))) as { '3': { inputs: { steps: number } } };
    changed['3'].inputs.steps = 30;
    const other = extractComfyui(pngOf(changed), 'b.png');
    expect(other.contentHash).not.toBe(base.contentHash);
  });

  it('含哨兵模板的 JSON 再导入保持同一哈希（幂等）', () => {
    const stripped = extractComfyui(pngOf(apiWith('cat', 1)), 'a.png');
    const again = extractComfyui(Buffer.from(JSON.stringify(stripped.recipeContent)), 'tpl.json');
    expect(again.contentHash).toBe(stripped.contentHash);
  });

  it('UI 工作流的画布噪音（平移/缩放/节点坐标/前端簿记）不进模板哈希', () => {
    const mk = (noise: Record<string, unknown>, nodeNoise: Record<string, unknown>) => ({
      nodes: [
        { id: 6, type: 'CLIPTextEncode', widgets_values: ['cat'], ...nodeNoise },
        { id: 3, type: 'KSampler', widgets_values: [1, 'fixed', 20], ...nodeNoise },
      ],
      links: [],
      ...noise,
    });
    const a = extractComfyui(Buffer.from(JSON.stringify(mk({}, { pos: [10, 20], size: [315, 78] }))), 'a.json');
    const b = extractComfyui(
      Buffer.from(JSON.stringify(mk({ extra: { ds: { scale: 1.283902517749506, offset: [-321.06, -2281.19] } }, config: {}, widget_idx_map: { '3': [0, 1] } }, { pos: [999, -44], size: [400, 120], bgcolor: '#322', flags: { collapsed: false } }))),
      'b.json',
    );
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('rehydrateTemplate 回填哨兵并识别模板', () => {
    const tpl = extractComfyui(pngOf(apiWith('cat', 1)), 'a.png').recipeContent;
    expect(containsTemplateSentinel(tpl)).toBe(true);
    const back = rehydrateTemplate(tpl, { prompt: 'dog', seed: 42 }) as Record<string, { inputs: Record<string, unknown> }>;
    expect(back['6']!.inputs.text).toBe('dog');
    expect(back['3']!.inputs.seed).toBe(42);
    expect(containsTemplateSentinel(back)).toBe(false);
  });
});
