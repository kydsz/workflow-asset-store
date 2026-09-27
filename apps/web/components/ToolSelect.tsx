'use client';

import { useState } from 'react';
import { useT } from '@/components/locale-provider';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** 存储值为小写标识（与 extractor 的 tool:'comfyui' 口径一致），展示名用品牌写法 */
export const TOOL_PRESETS: { value: string; label: string }[] = [
  { value: 'comfyui', label: 'ComfyUI' },
  { value: 'kling', label: '可灵 Kling' },
  { value: 'runway', label: 'Runway' },
  { value: 'midjourney', label: 'Midjourney' },
];

const NONE = '__none__';
const OTHER = '__other__';

export function ToolSelect(props: { id: string; name?: string; value: string; onChange: (v: string) => void; optional?: boolean }) {
  const t = useT();
  const isPreset = TOOL_PRESETS.some((p) => p.value === props.value);
  const [other, setOther] = useState(() => props.value !== '' && !isPreset);
  const sel = other ? OTHER : props.value || (props.optional ? NONE : undefined);

  const pick = (v: string) => {
    setOther(v === OTHER);
    if (v === NONE) props.onChange('');
    else if (v !== OTHER) props.onChange(v);
    else if (!isPreset) props.onChange(props.value);
    else props.onChange('');
  };

  return (
    <>
      <Select value={sel} onValueChange={pick}>
        <SelectTrigger id={props.id} className="w-full min-w-0">
          <SelectValue placeholder={t('tool.pick')} />
        </SelectTrigger>
        <SelectContent>
          {props.optional ? <SelectItem value={NONE}>{t('tool.none')}</SelectItem> : null}
          {TOOL_PRESETS.map((p) => (
            <SelectItem key={p.value} value={p.value}>
              {p.label}
            </SelectItem>
          ))}
          <SelectItem value={OTHER}>{t('tool.other')}</SelectItem>
        </SelectContent>
      </Select>
      {other ? (
        <Input name={props.name} value={props.value} onChange={(e) => props.onChange(e.target.value)} placeholder={t('upload.toolPlaceholder')} />
      ) : props.name ? (
        <input type="hidden" name={props.name} value={props.value} />
      ) : null}
    </>
  );
}
