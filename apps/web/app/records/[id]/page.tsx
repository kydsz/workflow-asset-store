import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, FileJson, FileVideo, Image as ImageIcon } from 'lucide-react';
import { getWebApi } from '@/src/webApi';
import { getServerT } from '@/lib/locale-server';
import { reasonText } from '@/lib/locale';
import type { TKey } from '@/lib/locale';
import { PatchForm } from '@/components/PatchForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { PurgeButton, RestoreButton, TrashButton } from '@/components/TrashButtons';
import { isPreviewable } from '@/lib/format';

export const dynamic = 'force-dynamic';

const FIELD_KEYS: Record<string, TKey> = {
  tool: 'common.tool',
  prompt: 'common.prompt',
  recipe: 'common.recipe',
  mediaType: 'common.mediaType',
};

export default async function RecordDetail(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const t = await getServerT();
  const api = getWebApi();
  const rec = api.getRecordSafe(id);
  if (!rec) notFound();
  // 配方可被彻底删除而记录仍在：用 safe 取，避免详情页 500
  const recipe = rec.recipeId ? api.getRecipeSafe(rec.recipeId) : undefined;
  const needs = rec.needsManual ?? [];
  const primary = rec.artifacts[0];
  const recipes = api.listRecipes().map((r) => ({ id: r.id, name: r.name }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← {t('record.back')}
        </Link>
        <span className="ml-auto">
          {rec.deletedAt ? (
            <span className="flex items-center gap-2">
              <RestoreButton kind="record" id={rec.id} redirectTo="/" />
              <PurgeButton kind="record" id={rec.id} redirectTo="/" variant="destructive" />
            </span>
          ) : (
            <TrashButton kind="record" id={rec.id} redirectTo="/" variant="destructive" />
          )}
        </span>
      </div>

      {rec.deletedAt ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <Badge variant="outline" className="border-destructive/40 text-destructive">
            {t('nav.trash')}
          </Badge>
          <span className="text-muted-foreground">{t('trash.bannerRecord')}</span>
          <span className="text-xs text-muted-foreground">{t('trash.deletedAt', t.time(rec.deletedAt))}</span>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* 左：媒体 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('record.preview')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {primary && isPreviewable(primary.path) ? (
              primary.mediaType === 'video' ? (
                <video src={`${api.artifactFileUrl(primary.path)}`} controls className="w-full rounded-lg border bg-black" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`${api.artifactFileUrl(primary.path)}`}
                  alt={rec.prompt ?? rec.id}
                  className="w-full rounded-lg border object-contain"
                />
              )
            ) : primary ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
                <FileJson className="size-8 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">{t('record.noImagePreview')}</div>
                <Button asChild size="xs" variant="outline">
                  <a href={`${api.artifactFileUrl(primary.path)}`} download>
                    <Download data-icon="inline-start" />
                    {t('record.downloadFile')}
                  </a>
                </Button>
              </div>
            ) : (
              <Empty>
                <EmptyMedia><ImageIcon /></EmptyMedia>
                <EmptyTitle>{t('record.noArtifactTitle')}</EmptyTitle>
                <EmptyDescription>{t('record.noArtifactDesc')}</EmptyDescription>
              </Empty>
            )}
            {rec.artifacts.filter((a) => isPreviewable(a.path)).length > 1 ? (
              <div className="grid grid-cols-4 gap-2">
                {rec.artifacts.filter((a) => isPreviewable(a.path)).map((a, i) =>
                  a.mediaType === 'video' ? (
                    <video key={i} src={`${api.artifactFileUrl(a.path)}`} muted playsInline className="aspect-square w-full rounded-md border object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={`${api.artifactFileUrl(a.path)}`} alt={t('record.imageIndex', i + 1)} className="aspect-square w-full rounded-md border object-cover" />
                  ),
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* 右：信息 */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('record.provenance')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="max-w-40">
                  <span className="min-w-0 truncate">{rec.tool}</span>
                </Badge>
                {recipe ? (
                  <Badge variant="outline" className="max-w-64">
                    {t('record.recipeLabel')}
                    <Link href={`/recipes/${recipe.id}`} className="min-w-0 truncate underline underline-offset-2">
                      {recipe.name}
                    </Link>
                    {recipe.deletedAt ? <span className="text-destructive">· {t('nav.trash')}</span> : null}
                  </Badge>
                ) : rec.recipeId ? (
                  <Badge variant="ghost">{t('trash.recipeGone')}</Badge>
                ) : (
                  <Badge variant="ghost">{t('record.noRecipe')}</Badge>
                )}
                {recipe?.workflowFilePath ? (
                  <Button asChild size="xs" variant="outline">
                    <a href={`/api/recipes/${recipe.id}/workflow?record_id=${rec.id}`}>
                      <Download data-icon="inline-start" />
                      {t('common.exportWithParams')}
                    </a>
                  </Button>
                ) : null}
              </div>
              <Row k={t('record.createdAt')} v={t.time(rec.createdAt)} />
              {rec.prompt ? (
                <div>
                  <div className="text-xs text-muted-foreground">{t('common.prompt')}</div>
                  <code className="block rounded-md bg-muted p-2 text-xs whitespace-pre-wrap break-all">{rec.prompt}</code>
                </div>
              ) : (
                <Row k={t('common.prompt')} v={t('record.noPromptValue')} muted />
              )}
              {rec.note ? <Row k={t('common.note')} v={rec.note} /> : null}
              <Row k={t('record.ingestSource')} v={rec.ingestSource === 'manual' ? t('record.ingestManual') : (rec.ingestSource ?? '—')} />
              <Row k={t('record.owner')} v={rec.owner} />
            </CardContent>
          </Card>

          {rec.params && Object.keys(rec.params).length ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('record.paramsThisRun')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {Object.entries(rec.params).map(([k, v]) => (
                  <Row key={k} k={k} v={String(v)} />
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('record.files', rec.artifacts.length)}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {rec.artifacts.length === 0 ? <span className="text-muted-foreground">{t('record.noFiles')}</span> : null}
              {rec.artifacts.map((a, i) => (
                <div key={i} className="rounded-lg border p-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {a.mediaType === 'video' ? <FileVideo className="size-3.5" /> : <ImageIcon className="size-3.5" />}
                    {a.mediaType === 'video' ? t('record.videoIndex', i + 1) : t('record.imageIndex', i + 1)}
                    <span className="ml-auto">{a.storageMode === 'copy' ? t('record.storageCopy') : t('record.storageRef')}</span>
                  </div>
                  <code className="mt-1 block text-xs break-all">{a.path}</code>
                  {a.fileHash ? <div className="mt-1 text-xs text-muted-foreground">sha256:{a.fileHash.slice(0, 12)}…</div> : null}
                </div>
              ))}
            </CardContent>
          </Card>

          {needs.length ? (
            <Card className="border-amber-500/40">
              <CardHeader>
                <CardTitle className="text-base text-amber-600 dark:text-amber-500">{t('record.needsSection', needs.length)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {needs.map((n) => {
                  const fk = FIELD_KEYS[n.field];
                  return (
                  <div key={n.field}>
                    <Badge variant="outline" className="mr-2 border-amber-600/40 text-amber-700 dark:border-amber-500/40 dark:text-amber-500">{fk ? t(fk) : n.field}</Badge>
                    <span className="text-muted-foreground">{reasonText(t, n)}</span>
                  </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('record.edit')}</CardTitle>
            </CardHeader>
            <CardContent>
              <PatchForm
                recordId={rec.id}
                needs={needs}
                recipes={recipes}
                initial={{ tool: rec.tool, prompt: rec.prompt ?? '', note: rec.note ?? '', recipeId: rec.recipeId ?? '' }}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row(p: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="max-w-[45%] shrink-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{p.k}</span>
      <span className={p.muted ? 'min-w-0 text-sm text-muted-foreground' : 'min-w-0 text-sm text-right break-all'}>{p.v}</span>
    </div>
  );
}
