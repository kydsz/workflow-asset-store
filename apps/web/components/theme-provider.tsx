'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

export type Theme = 'light' | 'dark';

const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'dark', setTheme: () => {} });

export const useThemeCtx = () => useContext(Ctx);

/** 与 <head> 内联 bootstrap 脚本配套：脚本先落 class，这里只负责后续切换与同步 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    setThemeState(document.documentElement.classList.contains('light') ? 'light' : 'dark');
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem('was-theme', t);
    } catch {
      /* ignore */
    }
    const el = document.documentElement;
    el.classList.toggle('light', t === 'light');
    el.classList.toggle('dark', t === 'dark');
    el.style.colorScheme = t;
  }, []);

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>;
}
