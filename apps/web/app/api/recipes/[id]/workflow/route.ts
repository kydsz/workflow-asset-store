import { NextResponse } from 'next/server';
import { getWebApi } from '../../../../../src/webApi';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const recordId = new URL(req.url).searchParams.get('record_id') ?? undefined;
  try {
    const api = getWebApi();
    api.getRecipe(id);
    const out = api.exportWorkflow(id, recordId ? { recordId } : undefined);
    if (!out) return NextResponse.json({ error: '该配方暂无工作流文件可导出' }, { status: 404 });
    return new NextResponse(out.text, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const form = await req.formData();
  const file = form.get('file');
  if (typeof File === 'undefined' || !(file instanceof File)) {
    return NextResponse.json({ error: '缺少工作流文件' }, { status: 400 });
  }
  try {
    const recipe = await getWebApi().attachWorkflowFile(id, file, file.name);
    return NextResponse.json(recipe);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
