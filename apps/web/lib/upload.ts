import { toast } from 'sonner';
import { uploadIngest } from '@/app/actions';
import type { Translate } from '@/lib/locale';

export interface IngestOptions {
  recipeId?: string;
  tool?: string;
  prompt?: string;
}

/** 上传入库并弹结果 toast；返回记录 id 列表（失败返回 null） */
export async function ingestFilesToLibrary(files: File[], t: Translate, opts: IngestOptions = {}): Promise<string[] | null> {
  if (!files.length) {
    toast.error(t('toast.noFiles'));
    return null;
  }
  const fd = new FormData();
  for (const f of files) fd.append('files', f, f.name);
  if (opts.recipeId) fd.append('recipeId', opts.recipeId);
  if (opts.tool?.trim()) fd.append('tool', opts.tool.trim());
  if (opts.prompt?.trim()) fd.append('prompt', opts.prompt.trim());
  const tk = toast.loading(t('toast.ingesting', files.length));
  try {
    const r = await uploadIngest(fd);
    const parts: string[] = [];
    if (r.created) parts.push(t('toast.ingested', r.created));
    if (r.collected_recipes) parts.push(t('toast.collectedRecipes', r.collected_recipes));
    if (r.skipped_existing) parts.push(t('toast.skippedDup', r.skipped_existing));
    if (r.record_ids.length === 1) {
      toast.success(`${parts.join(t('toast.join'))} · ${t('common.viewRecord')}`, { id: tk, action: { label: t('common.viewRecord'), onClick: () => window.location.assign(`/records/${r.record_ids[0]}`) } });
    } else {
      toast.success(parts.join(t('toast.join')), { id: tk });
    }
    return r.record_ids;
  } catch (e) {
    toast.error(t('toast.ingestFailed', e instanceof Error ? e.message : String(e)), { id: tk });
    return null;
  }
}
