import { NextResponse } from 'next/server';
import { getWebApi, type TrashKind } from '../../../src/webApi';

export const dynamic = 'force-dynamic';

export async function GET() {
  const api = getWebApi();
  return NextResponse.json({ entries: api.listTrash(), counts: api.trashCounts() });
}

/** { action: 'restore' | 'purge' | 'empty', kind?: 'record' | 'recipe', id? } */
export async function POST(req: Request) {
  const api = getWebApi();
  const body = (await req.json()) as { action?: string; kind?: TrashKind; id?: string };
  const kind = body.kind === 'recipe' ? 'recipe' : 'record';
  try {
    if (body.action === 'empty') return NextResponse.json({ ok: true, ...api.emptyTrash() });
    if (!body.id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    if (body.action === 'restore') return NextResponse.json({ ok: true, entry: api.restoreTrash(kind, body.id) });
    if (body.action === 'purge') {
      api.purgeTrash(kind, body.id);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: `未知操作: ${String(body.action)}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
