'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolve(pref: ThemePref): Theme {
  return pref === 'system' ? systemTheme() : pref;
}

function apply(t: Theme) {
  const el = document.documentElement;
  el.classList.toggle('light', t === 'light');
  el.classList.toggle('dark', t === 'dark');
  el.style.colorScheme = t;
}

const Ctx = createContext<{ pref: ThemePref; theme: Theme; setTheme: (t: ThemePref) => void }>({
  pref: 'dark',
  theme: 'dark',
  setTheme: () => {},
});

export const useThemeCtx = () => useContext(Ctx);

/** 与 <head> 内联 bootstrap 脚本配套：脚本先落 class，这里只负责后续切换与同步 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>('dark');
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const stored = localStorage.getItem('was-theme');
    const initial: ThemePref = stored === 'light' || stored === 'system' ? stored : 'dark';
    setPref(initial);
    const applied = resolve(initial);
    setThemeState(applied);
    apply(applied);
    if (initial !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = systemTheme();
      setThemeState(next);
      apply(next);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const setTheme = useCallback((next: ThemePref) => {
    setPref(next);
    const applied = resolve(next);
    setThemeState(applied);
    try {
      localStorage.setItem('was-theme', next);
    } catch {
      /* ignore */
    }
    apply(applied);
  }, []);

  return <Ctx.Provider value={{ pref, theme, setTheme }}>{children}</Ctx.Provider>;
}
