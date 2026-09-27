'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Images, FlaskConical, Inbox, Boxes, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { UploadDialog } from '@/components/UploadDialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleToggle } from '@/components/locale-toggle';
import { useT } from '@/components/locale-provider';

const NAV = [
  { href: '/', label: 'nav.records', icon: Images },
  { href: '/recipes', label: 'nav.recipes', icon: FlaskConical },
  { href: '/incomplete', label: 'nav.incomplete', icon: Inbox },
  { href: '/trash', label: 'nav.trash', icon: Trash2 },
] as const;

export function AppNav({ recipes, incompleteCount }: { recipes: { id: string; name: string }[]; incompleteCount: number }) {
  const pathname = usePathname();
  const t = useT();
  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-4 border-r bg-sidebar px-3 py-4">
      <div className="flex items-center gap-2 px-2">
        <Boxes className="size-5 text-primary" />
        <div className="leading-tight">
          <div className="text-sm font-semibold">{t('nav.brand')}</div>
          <div className="text-[11px] text-muted-foreground">{t('nav.tagline')}</div>
        </div>
      </div>
      <UploadDialog recipes={recipes} />
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4" />
              {t(label)}
              {href === '/incomplete' && incompleteCount > 0 ? (
                <Badge variant="outline" className="ml-auto border-amber-600/40 text-[10px] text-amber-600 dark:border-amber-400/40 dark:text-amber-400">
                  {incompleteCount}
                </Badge>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-2 px-2">
        <span className="text-[11px] leading-relaxed text-muted-foreground">{t('nav.dragHint')}</span>
        <div className="flex items-center justify-end gap-2">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
