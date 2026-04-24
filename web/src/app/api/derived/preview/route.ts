import { NextResponse } from 'next/server';
import { parseMapping } from '@/lib/mapping/parser';
import { collectDerivedPairs } from '@/lib/mapping/executor';
import type { DerivedMapping, VertexMapping } from '@/lib/mapping/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const SAMPLE_LIMIT_THRESHOLD = 2000; // above this vertex count, sample 500
const SAMPLE_SIZE = 500;

type Body = {
  /** Full current mapping YAML (so we can build a vertex map). */
  yaml?: string;
  /** The single derived rule to preview. */
  derived?: DerivedMapping;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (!body.yaml || typeof body.yaml !== 'string') {
    return NextResponse.json({ error: 'yaml required' }, { status: 400 });
  }
  if (!body.derived || typeof body.derived !== 'object') {
    return NextResponse.json({ error: 'derived required' }, { status: 400 });
  }

  try {
    const cfg = parseMapping(body.yaml);
    const vertexMap = new Map<string, VertexMapping>();
    for (const v of cfg.vertices ?? []) vertexMap.set(v.label, v);

    // For O(N²) kinds with large input, ask collectDerivedPairs to sample.
    const start = Date.now();
    const result = collectDerivedPairs(body.derived, vertexMap, {
      sampleLimit:
        body.derived.kind === 'haversine' || body.derived.kind === 'jaccard_similarity'
          ? SAMPLE_SIZE
          : undefined,
    });

    // If sampling was applied, scale count back up quadratically.
    let count = result.rows.length;
    if (result.estimated) {
      // we don't know the original N here; collectDerivedPairs already pushed a warning
      // with the real/sampled counts. For a rough UI number we leave count as-is
      // and surface `estimated: true` so the UI can label "≈".
    }

    return NextResponse.json({
      count,
      estimated: !!result.estimated,
      warnings: result.warnings,
      elapsedMs: Date.now() - start,
      supportProp: result.supportProp,
      direction: result.direction,
      vertexLabel: result.vertexLabel,
      sampleLimitThreshold: SAMPLE_LIMIT_THRESHOLD,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
