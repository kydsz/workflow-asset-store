import { NextResponse } from 'next/server';
import { getWebApi } from '../../../src/webApi';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData();
  try {
    const result = await getWebApi().ingestUpload(form);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
