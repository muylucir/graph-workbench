import { NextResponse } from 'next/server';
import { loadQuestions, runAllQuestions } from '@/lib/questionnaire/runner';
import { calculateScorecard } from '@/lib/scorecard/calculate';
import { parseMapping } from '@/lib/mapping/parser';
import { setSlot, getSlot } from '@/lib/slot-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

export async function POST(req: Request) {
  const { slot } = (await req.json()) as { slot: 'A' | 'B' | 'C' };
  if (!['A', 'B', 'C'].includes(slot)) {
    return NextResponse.json({ error: 'bad slot' }, { status: 400 });
  }
  const state = getSlot(slot);
  if (!state.yaml) {
    return NextResponse.json({ error: 'slot is empty' }, { status: 400 });
  }
  const cfg = parseMapping(state.yaml);
  const questions = loadQuestions();
  const results = await runAllQuestions(slot);

  const avgMs =
    results.length === 0
      ? 0
      : Math.round(results.reduce((acc, r) => acc + r.elapsedMs, 0) / results.length);

  const stats = state.stats
    ? { ...state.stats, avgMs }
    : { vertexCount: 0, edgeCount: 0, avgMs };

  const card = calculateScorecard(cfg, questions, results, stats);
  setSlot(slot, {
    lastResults: results.map((r) => ({ id: r.id, passed: r.passed, elapsedMs: r.elapsedMs })),
  });

  return NextResponse.json({ slot, results, scorecard: card });
}
