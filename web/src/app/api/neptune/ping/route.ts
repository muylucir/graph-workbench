import { NextResponse } from 'next/server';
import { ping } from '@/lib/neptune/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(await ping());
}
