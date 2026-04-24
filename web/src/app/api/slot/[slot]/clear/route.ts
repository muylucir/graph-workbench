import { NextResponse } from 'next/server';
import { resetSlot } from '@/lib/mapping/executor';
import { setSlot } from '@/lib/slot-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const { slot } = await params;
  if (!['A', 'B', 'C'].includes(slot)) return NextResponse.json({ error: 'bad slot' }, { status: 400 });
  const events: string[] = [];
  await resetSlot(slot as 'A' | 'B' | 'C', (e) => events.push(e.type));
  setSlot(slot as 'A' | 'B' | 'C', {
    yaml: null,
    mappingName: null,
    loadedAt: null,
    stats: null,
    lastResults: null,
  });
  return NextResponse.json({ ok: true, events });
}
