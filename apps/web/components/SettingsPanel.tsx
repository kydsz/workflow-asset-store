'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { saveStorageDirAction } from '@/app/actions';
import { useI18n, useT } from '@/components/locale-provider';
import { useThemeCtx, type ThemePref } from '@/components/theme-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { StorageInfo } from '@/src/storageInfo';
import {
  COLUMN_OPTIONS,
  DEFAULT_COLUMNS,
  DEFAULT_THUMB_H,
  GALLERY_COLUMNS_KEY,
  GALLERY_THUMB_H_KEY,
  THUMB_OPTIONS,
  readDisplayPrefs,
  writeDisplayPref,
} from '@/lib/display-preferences';
import type { Locale } from '@/lib/locale';

const THEME_OPTIONS: ThemePref[] = ['light', 'dark', 'system'];

export function SettingsPanel({ storage }: { storage: StorageInfo }) {
  const { t, locale, setLocale } = useI18n();
  const { pref, setTheme } = useThemeCtx();
  // 服务端渲染只能给默认值，真实偏好挂载后再读，避免 hydration 不一致
  const [prefs, setPrefs] = useState({ columns: DEFAULT_COLUMNS, thumbHeightPx: DEFAULT_THUMB_H });
  useEffect(() => setPrefs(readDisplayPrefs()), []);

  const changeDisplay = (key: typeof GALLERY_COLUMNS_KEY | typeof GALLERY_THUMB_H_KEY, value: number) => {
    writeDisplayPref(key, value);
    setPrefs((p) => (key === GALLERY_COLUMNS_KEY ? { ...p, columns: value } : { ...p, thumbHeightPx: value }));
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.appearance')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="set-theme">{t('settings.theme')}</Label>
            <Select value={pref} onValueChange={(v) => setTheme(v as ThemePref)}>
              <SelectTrigger id="set-theme" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {t(`settings.theme.${o}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="set-lang">{t('settings.language')}</Label>
            <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
              <SelectTrigger id="set-lang" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="zh">{t('settings.lang.zh')}</SelectItem>
                <SelectItem value="en">{t('settings.lang.en')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.gallery')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="set-columns">{t('settings.columns')}</Label>
            <Select value={String(prefs.columns)} onValueChange={(v) => changeDisplay(GALLERY_COLUMNS_KEY, Number(v))}>
              <SelectTrigger id="set-columns" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMN_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t('settings.columns.n', n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="set-thumb">{t('settings.thumbH')}</Label>
            <Select
              value={String(prefs.thumbHeightPx)}
              onValueChange={(v) => changeDisplay(GALLERY_THUMB_H_KEY, Number(v))}
            >
              <SelectTrigger id="set-thumb" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THUMB_OPTIONS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h === 0 ? t('settings.thumbH.unlimited') : t('settings.thumbH.px', h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.gallery.desc')}</p>
        </CardContent>
      </Card>

      <StorageCard storage={storage} />
    </div>
  );
}

function StorageCard({ storage }: { storage: StorageInfo }) {
  const t = useT();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<{ pendingDir: string; targetHasDb: boolean } | null>(null);
  const pendingDir = saved?.pendingDir ?? storage.pendingDir;
  const pendingHasDb = saved ? saved.targetHasDb : storage.pendingHasDb;
  // 来源说的是「当前生效目录」从哪来，配置文件里存了新值也不改变它
  const source = storage.envValue ? 'env' : storage.configuredDir === storage.activeDir ? 'config' : 'default';

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    start(async () => {
      const r = await saveStorageDirAction(value);
      if (r.error) {
        toast.error(t('toast.saveFailed', r.error));
        return;
      }
      setSaved({ pendingDir: r.pendingDir!, targetHasDb: !!r.targetHasDb });
      setValue('');
      toast.success(t('settings.storage.saved'));
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.storage')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label>{t('settings.storage.active')}</Label>
          <code className="min-w-0 break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">{storage.activeDir}</code>
          <p className="text-xs text-muted-foreground">
            {t('settings.storage.source')}: {t(`settings.storage.source.${source}`)} · {t('settings.storage.configFile')}: <span className="break-all">{storage.configFile}</span>
          </p>
        </div>

        {storage.envValue ? <p className="text-xs text-amber-700 dark:text-amber-400">{t('settings.storage.envWarn')}</p> : null}

        {pendingDir ? (
          <div className="flex flex-col gap-1 rounded-md border border-dashed px-2 py-1.5">
            <Label className="text-xs text-muted-foreground">{t('settings.storage.pending')}</Label>
            <code className="min-w-0 break-all font-mono text-xs">{pendingDir}</code>
            {pendingHasDb ? null : <p className="text-xs text-amber-700 dark:text-amber-400">{t('settings.storage.emptyWarn')}</p>}
          </div>
        ) : null}

        <form className="flex flex-col gap-2" onSubmit={onSubmit}>
          <Label htmlFor="set-storage">{t('settings.storage.new')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="set-storage"
              className="min-w-0 flex-1 font-mono text-xs"
              placeholder={t('settings.storage.newPlaceholder')}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" disabled={busy || !value.trim()}>
              {t('settings.storage.save')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.storage.desc')}</p>
        </form>
      </CardContent>
    </Card>
  );
}
