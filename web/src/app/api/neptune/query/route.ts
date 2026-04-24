import { NextResponse } from 'next/server';
import { runOpenCypher, isNeptuneConfigured } from '@/lib/neptune/client';
import { injectSuffix, type SlotId } from '@/lib/neptune/suffix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isNeptuneConfigured()) {
    return NextResponse.json({ error: 'NEPTUNE_ENDPOINT not configured' }, { status: 503 });
  }
  try {
    const body = (await req.json()) as { query: string; slot?: SlotId };
    if (!body.query) return NextResponse.json({ error: 'query required' }, { status: 400 });
    const q = body.slot ? injectSuffix(body.query, body.slot) : body.query;
    const r = await runOpenCypher(q);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
