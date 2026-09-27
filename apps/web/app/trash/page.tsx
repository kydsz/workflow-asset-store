import Link from 'next/link';
import { Trash2Icon } from 'lucide-react';
import { getWebApi } from '@/src/webApi';
import { getServerT } from '@/lib/locale-server';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { EmptyTrashButton, PurgeButton, RestoreButton } from '@/components/TrashButtons';

export const dynamic = 'force-dynamic';

export default async function Trash() {
  const t = await getServerT();
  const api = getWebApi();
  const entries = api.listTrash();
  const counts = api.trashCounts();

  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('trash.title')}</h1>
        <span className="text-sm text-muted-foreground">
          {t('trash.countRecords', counts.records)}
          {' · '}
          {t('trash.countRecipes', counts.recipes)}
        </span>
        {entries.length ? (
          <span className="ml-auto">
            <EmptyTrashButton count={entries.length} />
          </span>
        ) : null}
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{t('trash.subtitle')}</p>

      {entries.length === 0 ? (
        <Empty className="rounded-lg border border-dashed py-20">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trash2Icon />
            </EmptyMedia>
            <EmptyTitle>{t('trash.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('trash.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((e) => (
            <div key={`${e.kind}-${e.id}`} className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
              {e.thumbUrl ? (
                e.mediaType === 'video' ? (
                  <video src={e.thumbUrl} muted playsInline className="size-12 shrink-0 rounded-md border bg-black object-cover" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.thumbUrl} alt={e.title} loading="lazy" className="size-12 shrink-0 rounded-md border bg-black object-cover" />
                )
              ) : null}
              <Badge variant="secondary" className="shrink-0">
                {e.kind === 'record' ? t('trash.kindRecord') : t('trash.kindRecipe')}
              </Badge>
              <Link href={e.detailUrl} className="min-w-0 basis-60 flex-1 truncate font-medium hover:underline" title={e.title}>
                {e.title}
              </Link>
              {e.tool ? (
                <Badge variant="outline" className="max-w-32">
                  <span className="min-w-0 truncate">{e.tool}</span>
                </Badge>
              ) : null}
              {e.artifactCount > 1 ? <Badge variant="outline">{t('gallery.artifacts', e.artifactCount)}</Badge> : null}
              <span className="shrink-0 text-xs text-muted-foreground">{t('trash.deletedAt', t.time(e.deletedAt))}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <RestoreButton kind={e.kind} id={e.id} />
                <PurgeButton kind={e.kind} id={e.id} />
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
