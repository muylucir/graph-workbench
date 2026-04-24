import { NextResponse } from 'next/server';
import { buildCypherSuggesterForSlot } from '@/lib/agent/builder';
import { getSlot } from '@/lib/slot-store';
import type { SlotId } from '@/lib/neptune/suffix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Body = {
  slot: SlotId;
  naturalLanguage: string;
};

type Suggestion = {
  cypher: string;
  rationale?: string;
  expectedMin?: number;
  expectedMax?: number;
};

function extractJsonObject(text: string): Suggestion | null {
  const fenceStripped = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = fenceStripped.indexOf('{');
  const end = fenceStripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  const slice = fenceStripped.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as Suggestion;
    if (typeof parsed.cypher !== 'string' || !parsed.cypher.trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const { slot, naturalLanguage } = body;
  if (!['A', 'B', 'C'].includes(slot)) {
    return NextResponse.json({ error: 'bad slot' }, { status: 400 });
  }
  if (!naturalLanguage?.trim()) {
    return NextResponse.json(
      { error: 'naturalLanguage required' },
      { status: 400 },
    );
  }
  const state = getSlot(slot);
  if (!state.yaml) {
    return NextResponse.json(
      { error: `slot ${slot} is empty — load a mapping first` },
      { status: 400 },
    );
  }

  try {
    const agent = buildCypherSuggesterForSlot(slot);
    const result = await agent.invoke(naturalLanguage);
    const raw =
      typeof result.lastMessage === 'string'
        ? result.lastMessage
        : extractTextFromMessage(result.lastMessage);
    const suggestion = extractJsonObject(raw);
    if (!suggestion) {
      return NextResponse.json(
        {
          error: 'could not parse suggestion JSON',
          raw,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ slot, suggestion, raw });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

function extractTextFromMessage(msg: unknown): string {
  if (!msg) return '';
  if (typeof msg === 'string') return msg;
  if (typeof msg !== 'object') return String(msg);
  const m = msg as { content?: unknown };
  const content = m.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (block && typeof block === 'object' && 'text' in block) {
          return String((block as { text: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return JSON.stringify(msg);
}
