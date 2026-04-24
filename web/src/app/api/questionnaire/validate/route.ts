import { NextResponse } from 'next/server';
import { runQuestion, type Question } from '@/lib/questionnaire/runner';
import { getSlot } from '@/lib/slot-store';
import type { SlotId } from '@/lib/neptune/suffix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  slot: SlotId;
  question: {
    id?: string;
    title?: string;
    naturalLanguage?: string;
    tags?: string[];
    cypher: string;
    expected?: {
      rowCountRange?: [number, number];
    };
    planningRelevant?: boolean;
  };
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const { slot, question } = body;
  if (!['A', 'B', 'C'].includes(slot)) {
    return NextResponse.json({ error: 'bad slot' }, { status: 400 });
  }
  if (!question?.cypher?.trim()) {
    return NextResponse.json({ error: 'cypher required' }, { status: 400 });
  }
  const state = getSlot(slot);
  if (!state.yaml) {
    return NextResponse.json({ error: `slot ${slot} is empty` }, { status: 400 });
  }
  const q: Question = {
    id: question.id ?? 'CUSTOM',
    title: question.title ?? 'custom question',
    naturalLanguage: question.naturalLanguage ?? '',
    tags: question.tags ?? ['custom'],
    cypher: question.cypher,
    expected: question.expected ?? {},
    planningRelevant: !!question.planningRelevant,
  };
  const result = await runQuestion(q, slot);
  return NextResponse.json({ slot, result });
}
