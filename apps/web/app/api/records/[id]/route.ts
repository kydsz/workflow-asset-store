import { NextResponse } from 'next/server';
import { getWebApi } from '../../../../src/webApi';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rec = getWebApi().getRecordSafe(id);
  if (!rec) return NextResponse.json({ error: `生成记录不存在: ${id}` }, { status: 404 });
  return NextResponse.json(rec);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { tool?: string; prompt?: string; note?: string; resolve?: string[] };
  try {
    const rec = getWebApi().patchRecord(id, body);
    return NextResponse.json(rec);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/** 默认移入回收站；?purge=1 直接彻底删除（含库内文件回收） */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const purge = new URL(req.url).searchParams.get('purge') === '1';
  const api = getWebApi();
  try {
    if (purge) api.purgeTrash('record', id);
    else if (api.trashRecords([id]) === 0) return NextResponse.json({ error: `生成记录不存在: ${id}` }, { status: 404 });
    return NextResponse.json({ ok: true, id, purged: purge });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
