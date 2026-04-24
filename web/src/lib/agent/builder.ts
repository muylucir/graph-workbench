import 'server-only';
import { Agent, tool } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/bedrock';
import z from 'zod';
import { runOpenCypher, isNeptuneConfigured } from '../neptune/client';
import { injectSuffix, type SlotId } from '../neptune/suffix';
import { parseMapping } from '../mapping/parser';
import type { MappingConfig } from '../mapping/types';
import { getSlot } from '../slot-store';

export type AgentOptions = {
  modelId?: string;
  /**
   * Extended thinking config.
   * Adaptive mode (Claude Opus/Sonnet 4.6+): model dynamically decides whether
   * and how much to think. Bedrock rejects `effort` inside the `thinking`
   * object; at default it runs at `high` effort which is what we want for
   * the demo. If finer control is needed later, add `output_config.effort`
   * at the top level and the `effort-2025-11-24` beta header.
   * See: https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-adaptive-thinking.html
   */
  thinking?: { enabled: boolean };
};

export const DEFAULT_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-6';

export const MODEL_PRESETS = [
  { id: 'global.anthropic.claude-haiku-4-5', label: 'Haiku 4.5', thinking: false },
  { id: 'global.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6', thinking: true },
  { id: 'global.anthropic.claude-opus-4-7', label: 'Opus 4.7', thinking: true },
] as const;

export function supportsThinking(modelId: string): boolean {
  return !modelId.toLowerCase().includes('haiku');
}

function buildBedrockModel(opts?: AgentOptions) {
  const modelId = opts?.modelId ?? DEFAULT_MODEL_ID;
  const enable = !!opts?.thinking?.enabled && supportsThinking(modelId);
  const additionalRequestFields = enable
    ? {
        // Adaptive thinking for Claude Opus 4.7 / Opus 4.6 / Sonnet 4.6.
        // `effort` must NOT be nested inside `thinking` — it lives under
        // top-level `output_config` and requires a beta header, so we omit it.
        thinking: { type: 'adaptive' },
      }
    : undefined;
  return new BedrockModel({
    modelId,
    region: process.env.AWS_REGION ?? 'ap-northeast-2',
    additionalRequestFields,
  });
}

const READ_ONLY_PATTERN =
  /\b(CREATE|MERGE|DELETE|REMOVE|SET|DETACH|DROP|LOAD\s+CSV|CALL\s+\w+\.\w+\s*\()\b/i;

/**
 * Build a concise schema summary string from a mapping config.
 * The agent system prompt receives this so its Cypher generation stays grounded.
 */
export function summarizeSchema(cfg: MappingConfig): string {
  const vertices = cfg.vertices
    .map((v) => {
      const props = Object.keys(v.properties ?? {}).slice(0, 6).join(', ');
      return `  - ${v.label}(id=${abbreviate(v.id)})${props ? ' props: ' + props : ''}`;
    })
    .join('\n');

  const edges = (cfg.edges ?? [])
    .map((e) => {
      const eprops = Object.keys(e.properties ?? {});
      const propStr = eprops.length ? ` {${eprops.join(', ')}}` : '';
      return `  - (${e.source.vertex})-[:${e.type}${propStr}]->(${e.target.vertex})`;
    })
    .join('\n');

  const derived = (cfg.derived ?? [])
    .map((d) => {
      if (d.kind === 'attraction_co_occurrence')
        return `  - :${d.type}  (CO_VISITED pair on ${d.params.pair_column}, support>=${d.params.support_min})`;
      if (d.kind === 'attraction_sequence')
        return `  - :${d.type}  (sequence on ${d.params.order_by}, support>=${d.params.support_min})`;
      if (d.kind === 'haversine')
        return `  - :${d.type}  (City-City distance <= ${d.params.threshold_km}km)`;
      if (d.kind === 'list_co_occurrence')
        return `  - :${d.type}  (pairs in ${d.params.list_column}, support>=${d.params.support_min})`;
      if (d.kind === 'jaccard_similarity')
        return `  - :${d.type}  (${d.params.vertex} jaccard on ${d.params.tokens_column}, min_jaccard>=${d.params.min_jaccard})`;
      if (d.kind === 'declared_fact')
        return `  - :${d.type}  (${d.params.pairs.length}개 수동 선언 쌍, ${d.params.directed ? 'directed' : 'undirected'})`;
      if (d.kind === 'city_cluster')
        return `  - :${d.type}  (cluster "${d.params.cluster_name}", ${d.params.members.length}개 도시)`;
      return `  - :${(d as { type: string }).type}`;
    })
    .join('\n');

  return [
    `Schema: "${cfg.name}"`,
    cfg.description ? `Description: ${cfg.description}` : '',
    '',
    `Vertices (${cfg.vertices.length}):`,
    vertices,
    '',
    `Edges (${cfg.edges?.length ?? 0}):`,
    edges || '  (none)',
    '',
    `Derived (${cfg.derived?.length ?? 0}):`,
    derived || '  (none)',
  ]
    .filter(Boolean)
    .join('\n');
}

function abbreviate(expr: string): string {
  return expr.length > 32 ? expr.slice(0, 29) + '…' : expr;
}

/**
 * Build an agent for a specific slot. Tools automatically inject the slot's
 * label suffix before hitting Neptune. The system prompt embeds the live
 * schema summary so the LLM writes grounded Cypher.
 */
export function buildAgentForSlot(slot: SlotId, opts?: AgentOptions) {
  const state = getSlot(slot);
  const mapping = state.yaml ? parseMapping(state.yaml) : null;

  const schemaSummary = mapping
    ? summarizeSchema(mapping)
    : '(slot is empty — load a mapping first)';

  const systemPrompt = `당신은 travel-graph-lab의 GraphRAG 에이전트다. 현재 Slot: ${slot}

## 현재 슬롯에 적재된 그래프 스키마

${schemaSummary}

## 역할

1. 사용자의 한국어 자연어 질의를 이해한다.
2. 위 스키마 요약만을 근거로 **openCypher** 쿼리를 작성한다. 스키마에 없는 label/edge type/property를 절대 발명하지 않는다.
3. \`neptune_cypher\` 도구로 쿼리를 실행해 실 데이터를 확인한다.
4. 결과를 한국어로 간결히 요약한다.

## 쿼리 작성 규칙

- label과 edge type은 **순수한 이름으로 작성**한다. 시스템이 자동으로 \`__${slot}\` suffix를 붙여 슬롯을 격리한다.
- 노드 id는 property \`_id\`로 매칭한다. 예: \`MATCH (c:City {_id:'OSA'})\`.
- 모든 쿼리에 \`LIMIT\`를 포함한다 (기본 30).
- Neptune openCypher 방언을 따른다. APOC/Neo4j-only 함수 금지.
- 결과가 비어있을 수 있는 매칭은 \`OPTIONAL MATCH\`를 쓴다.
- 불확실하면 먼저 작은 탐색 쿼리로 ID/이름을 확인한 뒤 본 쿼리를 실행한다.

## 출력 형식

1. **분석** — 질의 해석 (1~2줄)
2. **실행한 Cypher** — \`\`\`cypher 블록
3. **결과** — 표/리스트로 핵심 요약
4. **한계** — 결과가 빈약하거나 스키마 밖이라면 명시

한국어로 답하라.`;

  const neptuneCypher = tool({
    name: 'neptune_cypher',
    description: [
      'Execute a read-only openCypher query on the live Neptune cluster for the current slot.',
      'Write pure label/edge names (like :City) — the system auto-injects the slot suffix.',
      'Use this as the PRIMARY way to answer questions about the graph.',
      'Read-only only: MATCH, OPTIONAL MATCH, WITH, UNWIND, RETURN. No CREATE/MERGE/DELETE/SET.',
      'Always include LIMIT (<= 30 recommended).',
    ].join(' '),
    inputSchema: z.object({
      query: z.string().describe('openCypher query (read-only, pure labels).'),
      rationale: z.string().optional().describe('one-line reason for this query'),
    }),
    callback: async (input) => {
      if (!isNeptuneConfigured()) return 'ERROR: Neptune not configured';
      const q = input.query.trim().replace(/;+\s*$/, '');
      if (READ_ONLY_PATTERN.test(q)) {
        return 'ERROR: only read-only queries allowed (no CREATE/MERGE/DELETE/SET/DETACH/DROP)';
      }
      try {
        const injected = injectSuffix(q, slot);
        const r = await runOpenCypher(injected);
        const rows = (r.raw as { results?: Array<Record<string, unknown>> }).results ?? [];
        const maxRows = 20;
        const sample = rows.slice(0, maxRows).map((row) => clipObject(row));
        return JSON.stringify({
          slot,
          executedCypher: injected,
          rowCount: rows.length,
          rows: sample,
          truncated: rows.length > maxRows,
          elapsedMs: r.elapsedMs,
        });
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  const schemaInspect = tool({
    name: 'schema_inspect',
    description:
      'Return the current slot schema summary (vertex/edge types and properties). Use when unsure what labels exist.',
    inputSchema: z.object({}),
    callback: () => schemaSummary,
  });

  return new Agent({
    model: buildBedrockModel(opts),
    tools: [neptuneCypher, schemaInspect],
    systemPrompt,
    printer: false,
  });
}

/**
 * Build a lightweight agent that, given a Korean natural-language question,
 * returns exactly one openCypher query grounded in the slot's schema.
 * No tool calls — single-shot generation for the custom questionnaire builder.
 */
export function buildCypherSuggesterForSlot(slot: SlotId) {
  const state = getSlot(slot);
  const mapping = state.yaml ? parseMapping(state.yaml) : null;
  const schemaSummary = mapping
    ? summarizeSchema(mapping)
    : '(slot is empty — load a mapping first)';

  const systemPrompt = `당신은 travel-graph-lab의 Cypher 작성 전문가다. 현재 Slot: ${slot}

## 그래프 스키마

${schemaSummary}

## 역할

사용자의 한국어 자연어 질의를 받아, 위 스키마로 답할 수 있는 **openCypher** 쿼리 **정확히 한 개**를 작성한다.

## 규칙

- label과 edge type은 **순수한 이름** (예: \`:City\`, \`[:NEAR_CITY]\`). 시스템이 \`__${slot}\` suffix를 자동 주입한다.
- 노드 id는 \`_id\` property로 매칭. 예: \`{_id:'OSA'}\`.
- \`LIMIT\`을 반드시 포함한다 (20 권장).
- 스키마에 **없는** label/edge type/property는 절대 사용하지 않는다.
- Neptune openCypher 방언만 사용. APOC/Neo4j-only 함수 금지.
- 쿼리에 세미콜론을 붙이지 않는다.

## 출력 형식

반드시 아래 JSON 객체 **하나만** 출력한다. 다른 설명·주석·코드블록 펜스 없이.

{"cypher": "MATCH ... RETURN ... LIMIT 20", "rationale": "한 줄로 설계 의도", "expectedMin": 1, "expectedMax": 50}

- \`expectedMin\`/\`expectedMax\`: 이 질의가 합리적으로 반환할 것으로 기대하는 행 수의 하한/상한. 합리적 범위를 추정.`;

  return new Agent({
    tools: [],
    systemPrompt,
    printer: false,
  });
}

function clipObject(v: unknown, max = 180): unknown {
  if (v == null) return v;
  if (typeof v === 'string') return v.length > max ? v.slice(0, max) + '…' : v;
  if (Array.isArray(v)) return v.slice(0, 15).map((x) => clipObject(x, max));
  if (typeof v !== 'object') return v;
  const obj = v as Record<string, unknown>;
  if (obj['~id'] && (obj['~labels'] || obj['~type'])) {
    const out: Record<string, unknown> = { id: obj['~id'] };
    if (obj['~labels']) {
      const lbl = (obj['~labels'] as string[])[0];
      out.label = lbl.replace(/__[ABC]$/, '');
    }
    if (obj['~type']) out.type = String(obj['~type']).replace(/__[ABC]$/, '');
    if (obj['~start']) out.from = obj['~start'];
    if (obj['~end']) out.to = obj['~end'];
    const props = obj['~properties'] as Record<string, unknown> | undefined;
    if (props) {
      const clipped: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(props)) {
        clipped[k] = typeof val === 'string' && val.length > max ? val.slice(0, max) + '…' : val;
      }
      out.properties = clipped;
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj)) out[k] = clipObject(val, max);
  return out;
}
