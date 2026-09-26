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
