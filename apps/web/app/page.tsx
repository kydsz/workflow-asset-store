import { getWebApi } from '@/src/webApi';
import { getServerT } from '@/lib/locale-server';
import { Gallery } from '@/components/Gallery';
import { FilterBar } from '@/components/FilterBar';

export const dynamic = 'force-dynamic';

export default async function Home(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await props.searchParams;
  const t = await getServerT();
  const api = getWebApi();
  const s = (k: string) => (typeof sp[k] === 'string' && sp[k] ? (sp[k] as string) : undefined);
  const b = (k: string) => (sp[k] === '1' ? true : sp[k] === '0' ? false : undefined);
  const { records, total } = api.listRecords({
    query: s('q'),
    tool: s('tool'),
    mediaType: s('media') as 'image' | 'video' | undefined,
    hasRecipe: b('recipe'),
    needsManual: b('manual'),
    limit: 200,
  });
  const allTools = Array.from(
    new Set([
      ...api.listRecipes().map((r) => r.tool),
      ...api.listRecords({ limit: 100000 }).records.map((r) => r.tool),
    ].filter((x): x is string => Boolean(x))),
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t('nav.records')}</h1>
        <span className="text-sm text-muted-foreground">{t('common.count', total)}</span>
      </div>

      <FilterBar tools={allTools} />

      <Gallery cards={records} />
    </>
  );
}
