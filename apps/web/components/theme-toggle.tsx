'use client';

import { Moon, Sun } from 'lucide-react';
import { useThemeCtx } from '@/components/theme-provider';
import { useT } from '@/components/locale-provider';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useThemeCtx();
  const t = useT();
  const isDark = theme !== 'light';
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={isDark ? t('theme.toLight') : t('theme.toDark')}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
