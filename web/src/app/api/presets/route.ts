import { NextResponse } from 'next/server';
import { listPresets } from '@/lib/schemas/presets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const presets = listPresets();
    return NextResponse.json({ presets });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
