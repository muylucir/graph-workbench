import { NextResponse } from 'next/server';
import { getSlot } from '@/lib/slot-store';
import { parseMapping } from '@/lib/mapping/parser';
import { summarizeSchema } from '@/lib/agent/builder';
import type { SlotId } from '@/lib/neptune/suffix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const slot = url.searchParams.get('slot') as SlotId | null;
  if (!slot || !['A', 'B', 'C'].includes(slot)) {
    return NextResponse.json({ error: 'slot required' }, { status: 400 });
  }
  const state = getSlot(slot);
  if (!state.yaml) {
    return NextResponse.json({ slot, summary: '(slot empty)', empty: true });
  }
  const cfg = parseMapping(state.yaml);
  return NextResponse.json({
    slot,
    name: cfg.name,
    summary: summarizeSchema(cfg),
    vertexCount: cfg.vertices.length,
    edgeCount: cfg.edges?.length ?? 0,
    derivedCount: cfg.derived?.length ?? 0,
  });
}
