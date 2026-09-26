import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { getWebApi } from '@/src/webApi';
import { getServerT } from '@/lib/locale-server';
import type { TKey } from '@/lib/locale';
import type { RecipeKind } from '@was/core';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { NewRecipeDialog } from '@/components/NewRecipeDialog';
import { RecipeCardActions } from '@/components/RecipeCardActions';

export const dynamic = 'force-dynamic';

const KIND_KEYS: Record<RecipeKind, TKey> = {
  'workflow-file': 'kind.workflow-file',
  'param-preset': 'kind.param-preset',
  'prompt-template': 'kind.prompt-template',
};

export default async function Recipes(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const t = await getServerT();
  const kind = typeof sp.kind === 'string' ? sp.kind : undefined;
  const q = typeof sp.q === 'string' ? sp.q : undefined;
  const api = getWebApi();
  const recipes = api.listRecipes({ kind, q });

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('nav.recipes')}</h1>
        <NewRecipeDialog />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {[
            ['', t('common.all')],
            ['workflow-file', t(KIND_KEYS['workflow-file'])],
            ['param-preset', t(KIND_KEYS['param-preset'])],
            ['prompt-template', t(KIND_KEYS['prompt-template'])],
          ].map(([k, label]) => (
            <Link
              key={k || 'all'}
              href={k ? `/recipes?kind=${k}` : '/recipes'}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                (kind ?? '') === k && 'bg-secondary font-medium text-secondary-foreground',
              )}
            >
              {label}
            </Link>
          ))}
        </div>
        <form method="get" className="ml-auto flex items-center gap-2">
          {kind ? <input type="hidden" name="kind" value={kind} /> : null}
          <Input name="q" defaultValue={q} placeholder={t('recipes.searchPlaceholder')} className="w-56" />
          <Button type="submit" variant="secondary" size="sm">
            {t('common.search')}
          </Button>
        </form>
      </div>

      {recipes.length === 0 ? (
        <Empty className="rounded-lg border border-dashed py-20">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FlaskConical />
            </EmptyMedia>
            <EmptyTitle>{t('recipes.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('recipes.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {recipes.map((r) => {
            const kindKey = KIND_KEYS[r.kind];
            return (
            <div
              key={r.id}
              className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm transition-colors hover:border-primary/50"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{kindKey ? t(kindKey) : r.kind}</Badge>
                {r.tool ? (
                  <Badge variant="outline" className="max-w-40">
                    <span className="min-w-0 truncate">{r.tool}</span>
                  </Badge>
                ) : null}
                {r.kind === 'workflow-file' && !r.workflowFilePath ? (
                  <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">{t('recipes.awaitingFile')}</Badge>
                ) : null}
              </div>
              <Link
                href={`/recipes/${r.id}`}
                className="min-w-0 font-medium [overflow-wrap:anywhere] underline-offset-2 hover:underline"
              >
                {r.name}
              </Link>
              {r.prompt ? <div className="line-clamp-2 text-sm text-muted-foreground">{r.prompt}</div> : null}
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="text-xs text-muted-foreground">{t('recipes.usedCount', api.recipeStats(r.id).uses)}</span>
                <RecipeCardActions recipe={r} />
              </div>
            </div>
            );
          })}
        </div>
      )}
    </>
  );
}
