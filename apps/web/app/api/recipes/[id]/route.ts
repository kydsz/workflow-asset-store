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

/** 重命名配方：body { name } */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { name?: string };
  try {
    return NextResponse.json(getWebApi().renameRecipe(id, body.name ?? ''));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/** 默认移入回收站；?purge=1 直接彻底删除（含独占工作流文件回收） */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const purge = new URL(req.url).searchParams.get('purge') === '1';
  const api = getWebApi();
  try {
    if (purge) api.purgeTrash('recipe', id);
    else if (api.trashRecipe(id) === 0) return NextResponse.json({ error: `配方不存在: ${id}` }, { status: 404 });
    return NextResponse.json({ ok: true, id, purged: purge });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
