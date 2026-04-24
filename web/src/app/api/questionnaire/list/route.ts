import { NextResponse } from 'next/server';
import { loadQuestions } from '@/lib/questionnaire/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const qs = loadQuestions();
    return NextResponse.json({
      questions: qs.map((q) => ({
        id: q.id,
        title: q.title,
        naturalLanguage: q.naturalLanguage,
        tags: q.tags,
        cypher: q.cypher,
        planningRelevant: q.planningRelevant,
        expected: q.expected,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
