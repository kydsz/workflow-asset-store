import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import { getWebApi } from '@/src/webApi';
import { getServerT } from '@/lib/locale-server';
import type { RecipeKind } from '@was/core';
import type { TKey } from '@/lib/locale';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AttachWorkflowForm } from '@/components/AttachWorkflowForm';
import { DuplicateRecipeButton } from '@/components/DuplicateRecipeButton';
import { PurgeButton, RestoreButton, TrashButton } from '@/components/TrashButtons';

export const dynamic = 'force-dynamic';

const KIND_KEYS: Record<RecipeKind, TKey> = {
  'workflow-file': 'kind.workflow-file',
  'param-preset': 'kind.param-preset',
  'prompt-template': 'kind.prompt-template',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5 text-sm">
      <div className="w-24 shrink-0 text-muted-foreground">{label}</div>
      <div className="min-w-0 break-all">{children}</div>
    </div>
  );
}

/** 工作流原文多为压缩后的单行 JSON，直接渲染会撑出横向滚动；尽量格式化后再交给 pre-wrap 换行 */
function formatWorkflowJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

const PRE_WRAP = 'overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded-md bg-muted/50 text-xs leading-relaxed';

export default async function RecipeDetail(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const t = await getServerT();
  const kindLabel = (k: RecipeKind) => t(KIND_KEYS[k]);
  const api = getWebApi();
  const detail = api.getRecipeDetail(id);
  if (!detail) notFound();
  const { recipe, records, stats } = detail;
  const awaitingFile = recipe.kind === 'workflow-file' && !recipe.workflowFilePath;
  const workflow = detail.workflowText ? formatWorkflowJson(detail.workflowText) : undefined;

  return (
    <>
      <Link href="/recipes" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> {t('recipe.back')}
      </Link>

      {recipe.deletedAt ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <Badge variant="outline" className="border-destructive/40 text-destructive">
            {t('nav.trash')}
          </Badge>
          <span className="text-muted-foreground">{t('trash.bannerRecipe')}</span>
          <span className="text-xs text-muted-foreground">{t('trash.deletedAt', t.time(recipe.deletedAt))}</span>
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{recipe.name}</h1>
        <Badge variant="secondary">{kindLabel(recipe.kind)}</Badge>
        <Badge variant="outline" className="max-w-64">
          <span className="min-w-0 truncate">{recipe.tool ?? t('recipe.noTool')}</span>
        </Badge>
        {awaitingFile ? <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">{t('recipe.awaitingFileBadge')}</Badge> : null}
        <span className="ml-auto flex items-center gap-2">
          {recipe.deletedAt ? (
            <>
              <RestoreButton kind="recipe" id={recipe.id} redirectTo="/recipes" />
              <PurgeButton kind="recipe" id={recipe.id} redirectTo="/recipes" variant="destructive" />
            </>
          ) : (
            <>
              <DuplicateRecipeButton recipeId={recipe.id} />
              {workflow ? (
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/recipes/${recipe.id}/workflow`}>
                    <Download data-icon="inline-start" /> {t('recipe.downloadWorkflow')}
                  </a>
                </Button>
              ) : null}
              <TrashButton kind="recipe" id={recipe.id} redirectTo="/recipes" variant="destructive" />
            </>
          )}
        </span>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {recipe.kind === 'workflow-file' ? (
            <Card>
              <CardHeader>
                <CardTitle>{awaitingFile ? t('recipe.attachCard') : t('recipe.replaceCard')}</CardTitle>
              </CardHeader>
              <CardContent>
                <AttachWorkflowForm recipeId={recipe.id} />
              </CardContent>
            </Card>
          ) : null}

          {workflow ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('recipe.workflowJson')}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">{t('recipe.workflowPreviewHint')}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className={`${PRE_WRAP} max-h-96 p-3`}>{workflow.slice(0, 6000)}</pre>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('recipe.history', records.length)}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {records.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground">{t('recipe.historyEmpty')}</div>
              ) : (
                <div>
                  {records.map((r, i) => (
                    <div key={r.id}>
                      {i > 0 ? <Separator /> : null}
                      <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-sm">
                        <Link href={`/records/${r.id}`} className="min-w-0 flex-1 basis-40 truncate hover:underline">
                          {r.prompt ?? <span className="text-muted-foreground">{t('common.noPrompt')}</span>}
                        </Link>
                        <Badge variant="outline" className="max-w-40">
                          <span className="min-w-0 truncate">{r.tool}</span>
                        </Badge>
                        {r.needsManual?.length ? (
                          <Badge className="shrink-0 bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">{t('common.needsManual')}</Badge>
                        ) : null}
                        <span className="shrink-0 text-xs text-muted-foreground">{t.time(r.createdAt)}</span>
                        {recipe.workflowFilePath ? (
                          <a
                            href={`/api/recipes/${recipe.id}/workflow?record_id=${r.id}`}
                            className="shrink-0 text-xs text-primary hover:underline"
                            title={t('common.exportWithParamsHint')}
                          >
                            {t('common.exportWithParams')}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t('recipe.info')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <Field label={t('recipe.usage')}>
              {t('common.usedTimes', stats.uses)}
              {stats.lastUsedAt ? t('recipe.lastUsed', t.time(stats.lastUsedAt)) : ''}
            </Field>
            {recipe.kind === 'workflow-file' && recipe.contentHash ? (
              <Field label={t('recipe.contentHash')}>
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{recipe.contentHash.slice(0, 16)}…</code>
              </Field>
            ) : null}
            {recipe.prompt ? (
              <Field label={t('recipe.promptTemplate')}>
                <code className="whitespace-pre-wrap break-all text-xs">{recipe.prompt}</code>
              </Field>
            ) : null}
            {recipe.params ? (
              <Field label={t('recipe.params')}>
                <pre className={`${PRE_WRAP} max-h-64 p-2`}>{JSON.stringify(recipe.params, null, 2)}</pre>
              </Field>
            ) : null}
            <Field label={t('recipe.createdAt')}>{t.time(recipe.createdAt)}</Field>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
