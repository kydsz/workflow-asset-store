'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { selectCls } from '@/lib/format';
import { useT } from '@/components/locale-provider';

export function FilterBar({ tools }: { tools: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const t = useT();

  const set = useCallback(
    (k: string, v?: string) => {
      const n = new URLSearchParams(sp.toString());
      if (v) n.set(k, v);
      else n.delete(k);
      router.replace(v ? `${pathname}?${n.toString()}` : `?${n.toString()}`);
    },
    [router, pathname, sp],
  );

  const get = (k: string) => sp.get(k) ?? '';

  return (
    <form
      className="mb-6 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get('q');
        set('q', typeof q === 'string' && q ? q : undefined);
      }}
    >
      <Input name="q" defaultValue={get('q')} placeholder={t('filter.searchPlaceholder')} className="h-8 w-64 md:w-80" />
      <select name="tool" value={get('tool')} onChange={(e) => set('tool', e.target.value || undefined)} className={selectCls}>
        <option value="">{t('filter.allTools')}</option>
        {tools.map((t2) => (
          <option key={t2} value={t2}>
            {t2}
          </option>
        ))}
      </select>
      <select value={get('media')} onChange={(e) => set('media', e.target.value || undefined)} className={selectCls}>
        <option value="">{t('filter.allMedia')}</option>
        <option value="image">{t('filter.image')}</option>
        <option value="video">{t('filter.video')}</option>
      </select>
      <select value={get('recipe')} onChange={(e) => set('recipe', e.target.value || undefined)} className={selectCls}>
        <option value="">{t('filter.recipeAny')}</option>
        <option value="1">{t('filter.recipeYes')}</option>
        <option value="0">{t('filter.recipeNo')}</option>
      </select>
      <select value={get('manual')} onChange={(e) => set('manual', e.target.value || undefined)} className={selectCls}>
        <option value="">{t('filter.manualAny')}</option>
        <option value="1">{t('filter.manualPending')}</option>
        <option value="0">{t('filter.manualComplete')}</option>
      </select>
      {(get('q') || get('tool') || get('media') || get('recipe') || get('manual')) && (
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => router.replace(pathname)}>
          {t('filter.clear')}
        </button>
      )}
    </form>
  );
}
