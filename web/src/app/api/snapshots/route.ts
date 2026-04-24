import { NextResponse } from 'next/server';
import { listSnapshots, saveSnapshot } from '@/lib/snapshots/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const snapshots = await listSnapshots();
    return NextResponse.json({ snapshots });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

type PostBody = {
  id?: string;
  name?: string;
  description?: string;
  yaml?: string;
  sourcePreset?: string;
};

export async function POST(req: Request) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }
  if (!body.yaml?.trim()) {
    return NextResponse.json({ error: 'yaml required' }, { status: 400 });
  }
  try {
    const snap = await saveSnapshot({
      id: body.id,
      name: body.name.trim(),
      description: body.description?.trim() || undefined,
      yaml: body.yaml,
      sourcePreset: body.sourcePreset,
    });
    return NextResponse.json({ snapshot: snap });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
