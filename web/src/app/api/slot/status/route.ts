import { NextResponse } from 'next/server';
import { getAllSlots } from '@/lib/slot-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ slots: getAllSlots() });
}
