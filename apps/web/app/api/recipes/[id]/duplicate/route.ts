import { NextResponse } from 'next/server';
import { getWebApi } from '../../../../../src/webApi';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  try {
    const copy = getWebApi().duplicateRecipe(id, body.name);
    return NextResponse.json(copy, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
