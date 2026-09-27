import Link from 'next/link';
import { ImageIcon, VideoIcon } from 'lucide-react';
import { getServerT } from '@/lib/locale-server';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { TrashButton } from '@/components/TrashButtons';
import type { RecordCard } from '@/src/webApi';

export async function Gallery({ cards }: { cards: RecordCard[] }) {
  const t = await getServerT();
  if (!cards.length) {
    return (
      <Empty className="rounded-lg border border-dashed py-20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageIcon />
          </EmptyMedia>
          <EmptyTitle>{t('gallery.emptyTitle')}</EmptyTitle>
          <EmptyDescription>{t('gallery.emptyDesc')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="columns-2 gap-4 md:columns-3 xl:columns-4 [&>*]:mb-4">
      {cards.map((c) => (
        <div
          key={c.id}
          className="group relative break-inside-avoid overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition-colors hover:border-primary/50"
        >
          <Link href={c.detailUrl} className="block">
            {c.thumbUrl ? (
              c.mediaType === 'video' ? (
                <video src={c.thumbUrl} muted playsInline className="max-h-96 w-full bg-black object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbUrl} alt={c.prompt ?? c.id} loading="lazy" className="max-h-96 w-full bg-black object-cover" />
              )
            ) : (
              <div className="flex aspect-video items-center justify-center text-muted-foreground">
                <VideoIcon className="size-6" />
              </div>
            )}
            <div className="flex flex-col gap-1.5 p-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="max-w-full">
                  <span className="min-w-0 truncate">{c.tool}</span>
                </Badge>
                {c.recipeName ? (
                  <Badge variant="outline" className="max-w-full">
                    <span className="min-w-0 truncate">{c.recipeName}</span>
                  </Badge>
                ) : null}
                {c.artifactCount > 1 ? <Badge variant="outline">{t('gallery.artifacts', c.artifactCount)}</Badge> : null}
                {c.needsManual.length ? <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-400">{t('gallery.needsManualCount', c.needsManual.length)}</Badge> : null}
              </div>
              <div className="line-clamp-2 text-sm text-foreground/90">{c.prompt ?? <span className="text-muted-foreground">{t('common.noPrompt')}</span>}</div>
              <div className="truncate text-xs text-muted-foreground">{t.time(c.createdAt)}</div>
            </div>
          </Link>
          <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <TrashButton kind="record" id={c.id} size="icon-sm" variant="secondary" className="bg-background/85 backdrop-blur" />
          </div>
        </div>
      ))}
    </div>
  );
}
