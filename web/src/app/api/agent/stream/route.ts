import { buildAgentForSlot, MODEL_PRESETS, DEFAULT_MODEL_ID } from '@/lib/agent/builder';
import type { SlotId } from '@/lib/neptune/suffix';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const ALLOWED_MODELS = new Set<string>(MODEL_PRESETS.map((m) => m.id));

type Body = {
  message?: string;
  slot?: SlotId;
  modelId?: string;
  thinking?: { enabled?: boolean };
};

export async function POST(req: Request) {
  const { message, slot, modelId, thinking } = (await req.json()) as Body;
  if (!message) return new Response(JSON.stringify({ error: 'message required' }), { status: 400 });
  if (!slot || !['A', 'B', 'C'].includes(slot)) {
    return new Response(JSON.stringify({ error: 'slot A|B|C required' }), { status: 400 });
  }
  const resolvedModelId =
    modelId && ALLOWED_MODELS.has(modelId) ? modelId : DEFAULT_MODEL_ID;
  const thinkingOpts = thinking?.enabled ? { enabled: true } : { enabled: false };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const push = (event: string, data: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(sse(event, data)));
      try {
        push('status', { state: 'started', slot, modelId: resolvedModelId });
        const agent = buildAgentForSlot(slot, {
          modelId: resolvedModelId,
          thinking: thinkingOpts,
        });

        // Minification safe: detect event type by shape, not by constructor.name.
        // Minifier mangles class names in production builds → ctor-based checks fail silently.
        const toolStartSent = new Set<string>();

        for await (const ev of agent.stream(message)) {
          const anyEv = ev as unknown as Record<string, unknown>;

          // 1) Streamed content block delta — discriminated union of
          //    textDelta | toolUseInputDelta | reasoningContentDelta.
          //    MUST branch on `delta.type`; all three can carry `.text`, so
          //    a naive `delta.text` check would mix reasoning into the answer
          //    when extended thinking is enabled.
          const delta = anyEv.delta as
            | { type?: string; text?: string; toolUse?: unknown }
            | undefined;
          if (delta?.type === 'textDelta' && typeof delta.text === 'string' && delta.text.length > 0) {
            push('delta', { text: delta.text });
            continue;
          }
          if (
            delta?.type === 'reasoningContentDelta' &&
            typeof delta.text === 'string' &&
            delta.text.length > 0
          ) {
            push('reasoning_delta', { text: delta.text });
            continue;
          }
          if (delta?.type === 'toolUseInputDelta') {
            // Tool input chunks are surfaced via tool_start/tool_end below.
            continue;
          }

          // 2) Tool lifecycle — BeforeToolCallEvent / AfterToolCallEvent have {toolUse: {...}, result?}
          const toolUse = anyEv.toolUse as
            | { name?: string; input?: unknown; toolUseId?: string }
            | undefined;
          if (toolUse && typeof toolUse.name === 'string') {
            const id = toolUse.toolUseId ?? toolUse.name;
            if ('result' in anyEv) {
              push('tool_end', { name: toolUse.name });
            } else if (!toolStartSent.has(id)) {
              toolStartSent.add(id);
              push('tool_start', { name: toolUse.name, input: toolUse.input });
            }
            continue;
          }

          // 3) ToolUseBlock content blocks also announce the call — top-level {name, input, toolUseId}
          if (
            typeof anyEv.name === 'string' &&
            typeof anyEv.toolUseId === 'string' &&
            'input' in anyEv
          ) {
            const id = anyEv.toolUseId as string;
            if (!toolStartSent.has(id)) {
              toolStartSent.add(id);
              push('tool_start', { name: anyEv.name as string, input: anyEv.input });
            }
            continue;
          }

          // 4) Message added — {message: {role, content}}
          const msg = anyEv.message as { role?: string } | undefined;
          if (msg && typeof msg.role === 'string') {
            push('message', { role: msg.role });
            continue;
          }

          // 5) Final AgentResult — {lastMessage, messages}
          if ('lastMessage' in anyEv && Array.isArray(anyEv.messages)) {
            push('final', {});
            continue;
          }
        }
        push('done', {});
      } catch (e) {
        push('error', { message: e instanceof Error ? e.message : String(e) });
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
