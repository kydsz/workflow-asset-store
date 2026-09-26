import Link from 'next/link';
import { InboxIcon } from 'lucide-react';
import { getWebApi } from '@/src/webApi';
import { getServerT } from '@/lib/locale-server';
import { reasonText, type TKey } from '@/lib/locale';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

export const dynamic = 'force-dynamic';

const FIELD_KEY: Record<string, TKey> = { tool: 'common.tool', prompt: 'common.prompt', recipe: 'common.recipe', mediaType: 'common.mediaType' };

export default async function Incomplete() {
  const t = await getServerT();
  const records = getWebApi().listIncomplete();
  return (
    <>
      <div className="mb-2 flex items-baseline gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('incomplete.title')}</h1>
        <span className="text-sm text-muted-foreground">{t('common.count', records.length)}</span>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{t('incomplete.subtitle')}</p>
      {records.length === 0 ? (
        <Empty className="rounded-lg border border-dashed py-20">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>{t('incomplete.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('incomplete.emptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {records.map((r) => (
            <Link
              key={r.id}
              href={`/records/${r.id}`}
              className="flex items-center gap-4 rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:border-primary/50"
            >
              <span className="w-72 truncate">{r.prompt?.slice(0, 40) || t('incomplete.recordFallback', r.id.slice(0, 8))}</span>
              <Badge variant="secondary">{r.tool}</Badge>
              <span className="flex flex-wrap gap-1">
                {(r.needsManual ?? []).map((n) => {
                  const fk = FIELD_KEY[n.field];
                  return (
                    <Badge key={n.field} variant="outline" className="border-amber-600/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-400" title={reasonText(t, n)}>
                      {fk ? t(fk) : n.field}
                    </Badge>
                  );
                })}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{t.time(r.createdAt)}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
