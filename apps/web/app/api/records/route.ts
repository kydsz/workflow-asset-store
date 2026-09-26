import { NextResponse } from 'next/server';
import { getWebApi, type SearchQuery } from '../../../src/webApi';

export const dynamic = 'force-dynamic';

function paramsToQuery(sp: URLSearchParams): SearchQuery {
  const s = (k: string) => sp.get(k) || undefined;
  const b = (k: string) => (sp.get(k) === '1' ? true : sp.get(k) === '0' ? false : undefined);
  const n = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  return {
    query: s('q') ?? s('query'),
    tool: s('tool'),
    mediaType: s('media') as SearchQuery['mediaType'],
    hasRecipe: b('recipe'),
    needsManual: b('manual'),
    since: n('since'),
    until: n('until'),
    sort: sp.get('sort') === 'oldest-first' ? 'oldest-first' : 'newest-first',
    limit: n('limit'),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.json(getWebApi().listRecords(paramsToQuery(url.searchParams)));
}

export async function POST(req: Request) {
  const body = (await req.json()) as { tool?: string; prompt?: string; note?: string; paths?: string[]; recipeId?: string };
  if (!body.tool || !body.paths?.length) {
    return NextResponse.json({ error: 'tool 与 paths 必填' }, { status: 400 });
  }
  try {
    const rec = getWebApi().createManualRecord({ tool: body.tool, prompt: body.prompt, note: body.note, paths: body.paths, recipeId: body.recipeId });
    return NextResponse.json(rec, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
