import { parseMapping, validateMapping } from '@/lib/mapping/parser';
import { executeMapping, resetSlot } from '@/lib/mapping/executor';
import { listTables } from '@/lib/sqlite/client';
import { setSlot } from '@/lib/slot-store';
import type { ExecEvent } from '@/lib/mapping/executor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slot: string }> },
) {
  const { slot } = await params;
  if (!['A', 'B', 'C'].includes(slot)) {
    return new Response('invalid slot', { status: 400 });
  }
  const body = (await req.json()) as { yaml: string; reset?: boolean };
  if (!body.yaml) return new Response('yaml required', { status: 400 });

  const cfg = parseMapping(body.yaml);
  cfg.slot = slot as 'A' | 'B' | 'C';

  const tables = listTables();
  const validation = validateMapping(cfg, tables);
  if (!validation.ok) {
    return new Response(JSON.stringify({ error: 'validation failed', details: validation.errors }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: ExecEvent) => controller.enqueue(encoder.encode(sse(e.type, e)));
      try {
        if (body.reset) await resetSlot(cfg.slot, send);
        let vc = 0;
        let ec = 0;
        await executeMapping(
          cfg,
          (e) => {
            send(e);
            if (e.type === 'finished') {
              vc = e.vertexCount;
              ec = e.edgeCount;
            }
          },
          { reset: false }, // already done above
        );
        setSlot(cfg.slot, {
          yaml: body.yaml,
          mappingName: cfg.name,
          loadedAt: new Date().toISOString(),
          stats: { vertexCount: vc, edgeCount: ec },
        });
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
