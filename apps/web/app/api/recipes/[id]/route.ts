import { NextResponse } from 'next/server';
import { getWebApi } from '../../../../src/webApi';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    return NextResponse.json(getWebApi().getRecipe(id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
