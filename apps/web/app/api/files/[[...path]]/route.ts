import { NextResponse } from 'next/server';
import { getWebApi } from '../../../../src/webApi';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path } = await ctx.params;
  const seg = decodeURIComponent((path ?? []).join('/'));
  const hit = getWebApi().resolveFileParam(seg);
  if (!hit) return new NextResponse('not found', { status: 404 });
  return new NextResponse(new Uint8Array(hit.bytes), {
    headers: { 'content-type': hit.contentType, 'cache-control': 'private, max-age=86400' },
  });
}
