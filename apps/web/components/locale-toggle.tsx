'use client';

import { Languages } from 'lucide-react';
import { useI18n } from '@/components/locale-provider';
import { Button } from '@/components/ui/button';

export function LocaleToggle() {
  const { locale, t, setLocale } = useI18n();
  return (
    <Button variant="ghost" size="icon-sm" title={t('lang.toggleTitle')} onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}>
      <Languages className="size-4" />
    </Button>
  );
}
