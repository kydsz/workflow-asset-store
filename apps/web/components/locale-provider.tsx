'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { LOCALE_COOKIE, LOCALE_STORAGE_KEY, makeT, type Locale, type Translate } from '@/lib/locale';

const Ctx = createContext<{ locale: Locale; t: Translate; setLocale: (l: Locale) => void }>({
  locale: 'zh',
  t: makeT('zh'),
  setLocale: () => {},
});

export const useI18n = () => useContext(Ctx);

export const useT = () => useContext(Ctx).t;

export function LocaleProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const router = useRouter();
  const t = useMemo(() => makeT(initialLocale), [initialLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === initialLocale) return;
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
        document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
      } catch {
        /* ignore */
      }
      router.refresh();
    },
    [initialLocale, router],
  );

  return <Ctx.Provider value={{ locale: initialLocale, t, setLocale }}>{children}</Ctx.Provider>;
}
