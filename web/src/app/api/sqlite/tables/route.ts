import { NextResponse } from 'next/server';
import { listTables, sampleRows } from '@/lib/sqlite/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sample = url.searchParams.get('sample');
  try {
    if (sample) {
      return NextResponse.json({ rows: sampleRows(sample, 5) });
    }
    return NextResponse.json({ tables: listTables() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
