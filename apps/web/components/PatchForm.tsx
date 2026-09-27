'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { patchRecordAction } from '@/app/actions';
import { useT } from '@/components/locale-provider';
import { reasonText } from '@/lib/locale';
import type { TKey } from '@/lib/locale';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ToolSelect } from '@/components/ToolSelect';

const NONE = '__none__';

const FIELD_KEYS: Record<string, TKey> = { tool: 'common.tool', prompt: 'common.prompt', recipe: 'common.recipe', mediaType: 'common.mediaType' };

export function PatchForm(props: {
  recordId: string;
  needs: { field: string; reason: string; reasonCode?: 'tool_not_detected' | 'prompt_not_parsed' | 'workflow_metadata_absent' | 'workflow_content_not_parsed' | 'media_type_ambiguous' }[];
  initial: { tool: string; prompt: string; note: string; recipeId?: string };
  recipes: { id: string; name: string }[];
}) {
  const [busy, start] = useTransition();
  const [recipeId, setRecipeId] = useState(props.initial.recipeId ?? NONE);
  const [tool, setTool] = useState(props.initial.tool);
  const t = useT();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (recipeId !== NONE) fd.set('recipeId', recipeId);
    else fd.delete('recipeId');
    start(async () => {
      const r = await patchRecordAction(props.recordId, fd);
      if (r.error) toast.error(t('toast.saveFailed', r.error));
      else toast.success(t('toast.saved'));
    });
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="pt-tool">{t('common.tool')}</Label>
          <ToolSelect id="pt-tool" name="tool" value={tool} onChange={setTool} />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label>{t('common.recipe')}</Label>
          <Select value={recipeId} onValueChange={setRecipeId}>
            <SelectTrigger className="w-full min-w-0">
              <SelectValue placeholder={t('common.none')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>{t('common.none')}</SelectItem>
              {props.recipes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pt-prompt">{t('common.prompt')}</Label>
        <Textarea id="pt-prompt" name="prompt" rows={3} defaultValue={props.initial.prompt} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pt-note">{t('common.note')}</Label>
        <Input id="pt-note" name="note" defaultValue={props.initial.note} />
      </div>
      {props.needs.length ? (
        <div className="flex flex-wrap items-center gap-4 rounded-md bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t('record.needsFields')}</span>
          {props.needs.map((n) => {
            const fk = FIELD_KEYS[n.field];
            return (
            <label key={n.field} className="flex items-center gap-1.5" title={reasonText(t, n)}>
              <input type="checkbox" name="resolve" value={n.field} defaultChecked className="size-3.5 accent-primary" />
              {fk ? t(fk) : n.field} {t('record.resolvedSuffix')}
            </label>
            );
          })}
        </div>
      ) : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  );
}
