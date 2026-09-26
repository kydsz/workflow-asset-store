import { NextResponse } from 'next/server';
import { getWebApi } from '../../../src/webApi';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const s = (k: string) => url.searchParams.get(k) ?? undefined;
  return NextResponse.json(getWebApi().listRecipes({ kind: s('kind'), tool: s('tool'), q: s('q') }));
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    name?: string;
    kind?: 'workflow-file' | 'prompt-template' | 'param-preset';
    tool?: string;
    prompt?: string;
    params?: Record<string, unknown>;
  };
  if (!body.name?.trim()) return NextResponse.json({ error: '配方需要名称' }, { status: 400 });
  try {
    const recipe = getWebApi().createRecipe({
      name: body.name.trim(),
      kind: body.kind ?? 'workflow-file',
      tool: body.tool?.trim(),
      prompt: body.prompt,
      params: body.params,
    });
    return NextResponse.json(recipe, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
