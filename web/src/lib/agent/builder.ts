import 'server-only';
import { Agent, tool } from '@strands-agents/sdk';
import { BedrockModel } from '@strands-agents/sdk/bedrock';
import z from 'zod';
import { runOpenCypher, isNeptuneConfigured } from '../neptune/client';
import { injectSuffix, type SlotId } from '../neptune/suffix';
import { parseMapping } from '../mapping/parser';
import type { MappingConfig, DerivedMapping, VertexMapping } from '../mapping/types';
import { getSlot } from '../slot-store';
import { collectDerivedPairs } from '../mapping/executor';
import { getDb, listTables } from '../sqlite/client';

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
- **round() 는 인자 1개만 받는다** (\`round(x)\`). 소수점 자릿수를 줄이려면
  \`round(x * 10) / 10\` 같은 수식으로 분리한다. \`round(x, 2)\` 사용 금지.
- \`datetime()\`/\`duration()\` 등 날짜 함수는 사용 금지 (원본이 문자열로 저장됨).
- **좌표 기반 거리 계산 금지**. Neptune은 \`point()\`, \`point.distance()\`,
  \`haversin()\`, \`sin\`/\`cos\`/\`asin\`/\`sqrt\`/\`radians\`/\`degrees\`/\`pi\` 등을
  지원하지 않는다. \`lat\`/\`lng\` 로 직접 거리 공식을 만들지 말 것. 거리 질의는 오직
  \`:NEAR_CITY { distanceKm }\` edge 의 property 로만 처리한다. 그 edge 가 스키마에
  없으면 거리 질의를 거절하라.
- **WITH/RETURN 변수 스코프**: \`WITH\`나 \`RETURN\`에 \`DISTINCT\` 또는 집계
  (\`COUNT\`/\`AVG\`/\`SUM\`/\`MIN\`/\`MAX\`/\`COLLECT\`)가 들어가면 그 앞의 변수들이
  **모두 드롭된다**. 뒤에서 쓰려는 값은 반드시 해당 \`WITH\`/\`RETURN\` 절에 별칭으로
  포함시켜라. 예: \`WITH DISTINCT a, b, r.distanceKm AS distance ORDER BY distance\`.
  또는 \`DISTINCT\` 없이 \`WITH a, b, r, r.distanceKm AS distance\`.

## 출력 형식

1. **분석** — 질의 해석 (1~2줄)
2. **실행한 Cypher** — \`\`\`cypher 블록
3. **결과** — 표/리스트로 핵심 요약
4. **한계** — 결과가 빈약하거나 스키마 밖이라면 명시

## 언어

- **최종 답변은 한국어로 작성한다.**
- **내부 추론(reasoning / thinking)도 한국어로 작성한다.** 영어로 생각하고 한국어로
  답하지 말 것. 한국어로 사고하라. (단, Cypher 쿼리·식별자·코드 토큰은 원문 유지.)`;

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
- **round() 는 인자 1개만 받는다** (\`round(x)\`). 소수점 자릿수를 줄이려면
  \`round(x * 10) / 10\` 같은 수식으로 분리한다. \`round(x, 2)\` 금지.
- \`toInteger()\`, \`toFloat()\`, \`split()\`, \`coalesce()\`, \`collect()\`, \`size()\`,
  기본 수학(\`+\`, \`-\`, \`*\`, \`/\`), 문자열(\`toLower()\`, \`toUpper()\`, \`trim()\`) 만 안전하다.
- \`datetime()\` / \`duration()\` 등 날짜 함수는 사용 금지 (데이터가 문자열로 저장됨).
- **좌표 기반 거리 계산은 일절 금지**. Neptune은 \`point()\`, \`point.distance()\`,
  \`distance()\`, \`haversin()\`, \`sin()\`, \`cos()\`, \`asin()\`, \`sqrt()\`, \`radians()\`,
  \`degrees()\`, \`pi()\` 등 **삼각·지리 함수 전체를 지원하지 않는다**. \`lat\`/\`lng\`
  property 로 임의의 거리 공식을 만들려 하지 말 것. 실패한다.
- 거리/근접도 질의는 오직 사전 계산된 파생 edge \`:NEAR_CITY { distanceKm }\` 로만
  처리한다. 예: \`MATCH (a:City)-[r:NEAR_CITY]->(b:City) WHERE r.distanceKm <= 100\`.
  그 edge 가 스키마에 없으면 "현재 슬롯은 도시 거리 정보를 제공하지 않는다"라고
  한계를 명시하고, 좌표 수식을 발명하지 말 것.
- **WITH / RETURN 변수 스코프 규칙**: \`WITH\` 또는 \`RETURN\` 에 \`DISTINCT\` 혹은 집계
  함수(\`COUNT\`, \`AVG\`, \`SUM\`, \`MIN\`, \`MAX\`, \`COLLECT\`)가 들어가는 순간, **그 절
  앞에서 선언한 변수는 모두 드롭된다**. 이후에 쓰려는 변수는 반드시 그 \`WITH\`/\`RETURN\`
  에 명시적으로 포함시켜야 한다. 예를 들어 \`MATCH (a)-[r:NEAR_CITY]->(b)\` 뒤에
  \`r.distanceKm\` 을 \`ORDER BY\` 에 쓰려면 \`WITH DISTINCT a, b, r.distanceKm AS distance\`
  처럼 별칭까지 같은 \`WITH\` 절에 올려야 한다. 안전하지 않으면 \`DISTINCT\` 대신
  \`WITH a, b, r, r.distanceKm AS distance ORDER BY distance\` 처럼 풀어 쓰라.

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

/**
 * Templates the interviewer can suggest. Kept in sync with
 * `web/src/lib/derived-templates.ts` — any change there should be reflected
 * in the catalog string below so the LLM proposes valid template ids.
 */
const DERIVED_TEMPLATE_CATALOG = `
1) co_visited
   - 뜻: 같은 여행상품에 함께 등장하는 **관광지** 쌍 연결 (CO_VISITED).
   - 전제: :Attraction vertex.
   - inputs: { support_min: number }  (최소 동시 등장 상품 수, 권장 2~5)
2) near_city
   - 뜻: 위경도상 **도시** 사이 거리가 임계값 이하면 연결 (NEAR_CITY).
   - 전제: :City vertex + lat/lng 속성.
   - inputs: { threshold_km: number }  (권장 50~200)
3) next_course
   - 뜻: 하루 일정 안에서 먼저 들른 뒤 이어서 가는 **관광지** 순서 (VISITED_AFTER, directed).
   - 전제: :Attraction vertex + 일정 순서 테이블(package_product_schedules).
   - inputs: { support_min: number }  (권장 2~5)
4) similar_place
   - 뜻: 테마/분위기 토큰이 **관광지**끼리 일정 비율 이상 겹치면 연결 (SIMILAR_PLACE).
   - 전제: :Attraction vertex + tokens(themes/moods/seasons/tags 등) 속성.
   - inputs: { tokens_column: string, min_jaccard: number(0~1) }
5) declared
   - 뜻: 도메인 전문가가 직접 선언한 쌍 (RECOMMENDED_WITH).
   - 전제: :Attraction 또는 :City vertex.
   - inputs: { pairs: [{a,b,note?}...] }  — 인터뷰에서는 권장하지 말 것(수동 입력 전용).
6) cluster
   - 뜻: 여러 :City를 하나의 권역으로 묶음 (CLUSTER_OF).
   - inputs: { cluster_name: string, members: string[] }  — 인터뷰에서는 권장하지 말 것.
7) often_cotravel
   - 뜻: 상품 메타의 방문도시 리스트(vistCity)에서 함께 나타나는 **도시** 쌍 (OFTEN_COTRAVELED).
   - 전제: :City vertex + package_product_meta.vistCity 리스트.
   - inputs: { support_min: number }  (권장 2~4)
`.trim();

function buildInterviewSystemPrompt(slot: SlotId, schemaSummary: string): string {
  return `당신은 travel-graph-lab의 **파생 관계 인터뷰어**다. 현재 Slot: ${slot}

## 현재 슬롯 스키마

${schemaSummary}

## 사용 가능한 파생 관계 템플릿

${DERIVED_TEMPLATE_CATALOG}

## 역할

원본 RDB에는 없지만 도메인 전문가의 암묵지로 만들 수 있는 **파생 관계(edge)** 를
함께 찾아낸다. 다음 절차를 따른다.

1. 사용자의 의도를 파악하기 위해 **짧은 질문 1개**를 먼저 건다.
   (예: "어떤 종류의 '자주 함께 간다'를 원하세요 — 같은 상품 내 동시 등장인가요,
    일정 순서 기반인가요?")
2. 필요하면 도구로 근거를 확보한다. **도구 호출 예산을 최소화**하라:
   - 컬럼을 탐색해야 하면 먼저 \`sqlite_schema\` 를 **단 한 번** 호출해 전 테이블의
     컬럼 목록을 한꺼번에 받는다. 테이블별로 \`column_stats\` 를 반복 호출하지 말 것.
   - 후보 컬럼을 이미 스키마로 좁힌 뒤에만 \`column_stats\` 로 분포(널율·유니크 수·상위값)를 확인한다.
     \`column_stats\` 호출은 인터뷰 한 번당 최대 3회까지만.
   - 파라미터(support_min, threshold_km 등)를 정할 때는 \`derived_preview\` 를 2~3회만
     호출해 count 범위를 좁힌다.
3. 제안은 **반드시 아래 JSON 한 블록**을 포함한다 (코드펜스 \`\`\`json 안에).
   사용자가 이 블록을 UI에서 "규칙 추가" 버튼으로 바로 받을 수 있도록.

\`\`\`json
{
  "suggestion": {
    "templateId": "co_visited",
    "edgeTypeName": "CO_VISITED",
    "inputs": { "support_min": 3 },
    "rationale": "같은 상품 안에서 3회 이상 동반 등장하는 관광지 쌍은 …",
    "previewCount": 128
  }
}
\`\`\`

## 규칙

- 한국어로 간결히 대화. 설명은 2~4줄.
- 전제조건(위 카탈로그의 "전제")이 **현재 스키마에서 충족되지 않으면** 먼저 그것을
  지적하고 대안 템플릿을 제안한다. 억지로 제안하지 말 것.
- \`declared\` / \`cluster\` 는 수동 입력 전용이므로 인터뷰에서 직접 제안하지 않는다.
  대신 "직접 선언하고 싶은 쌍이 있나요?" 하고 되묻는다.
- 파라미터는 근거 기반으로 제시: 예컨대 \`support_min\` 은 \`derived_preview\` 를
  2~3회 호출해 count 범위를 좁혀서 결정.
- \`edgeTypeName\` 은 대문자+언더스코어만.
- JSON 블록의 \`inputs\` 키 이름은 위 카탈로그에 명시된 것과 정확히 일치해야 한다.
- 한 번에 한 개의 \`suggestion\` 만. 여러 개면 사용자가 수락할 때까지 기다려라.

## 언어

- **최종 답변은 한국어로 작성한다.**
- **내부 추론(reasoning / thinking)도 한국어로 작성한다.** 영어로 생각하지 말고
  한국어로 사고하라. (단, 코드·JSON·컬럼명 등 식별자는 원문 유지.)`;
}

/**
 * Interviewer agent that helps a user discover and parameterize derived edges
 * by asking questions and previewing counts. Shares the core Bedrock model
 * config with `buildAgentForSlot` but with a different tool set and prompt.
 *
 * `yamlSnapshot` lets the caller pass the in-progress (unsaved) mapping, so
 * the agent's schema summary and `derived_preview` reflect current edits.
 */
export function buildDerivedInterviewerForSlot(
  slot: SlotId,
  opts?: AgentOptions & { yamlSnapshot?: string },
) {
  const state = getSlot(slot);
  const yaml = opts?.yamlSnapshot ?? state.yaml ?? '';
  const mapping = yaml ? safeParse(yaml) : null;

  const schemaSummary = mapping
    ? summarizeSchema(mapping)
    : '(slot is empty — 먼저 vertex/edge 를 만들어야 파생 관계를 제안할 수 있습니다.)';

  const systemPrompt = buildInterviewSystemPrompt(slot, schemaSummary);

  const schemaInspect = tool({
    name: 'schema_inspect',
    description:
      'Return the current slot schema summary (vertex/edge types and properties). Use when unsure what labels/props exist.',
    inputSchema: z.object({}),
    callback: () => schemaSummary,
  });

  const sqliteSchema = tool({
    name: 'sqlite_schema',
    description: [
      'Return the FULL SQLite schema in one call: every table with its row count and all column names.',
      'Call this ONCE when you need to find a column (e.g., a theme/mood/season column) — do not probe tables one by one with column_stats.',
      'Use column_stats only AFTER you have narrowed down to a specific table.column.',
    ].join(' '),
    inputSchema: z.object({}),
    callback: () => {
      try {
        const tables = listTables();
        const compact = tables.map((t) => ({
          table: t.name,
          rows: t.rowCount,
          columns: t.columns.map((c) => c.name),
        }));
        return JSON.stringify({ tableCount: compact.length, tables: compact });
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  const columnStats = tool({
    name: 'column_stats',
    description: [
      'Inspect basic statistics of a SQLite column in the source database.',
      'Returns count, distinct count, null ratio, and the top-10 most frequent values.',
      'Use this to judge reasonable thresholds (e.g. support_min) before proposing parameters.',
    ].join(' '),
    inputSchema: z.object({
      table: z.string().describe('SQLite table name'),
      column: z.string().describe('column name'),
      topK: z.number().int().min(1).max(30).optional().describe('top values to return (default 10)'),
    }),
    callback: (input) => {
      try {
        const db = getDb();
        const t = input.table;
        const c = input.column;
        // Validate identifiers — only allow [A-Za-z0-9_] to prevent SQL injection.
        if (!/^[A-Za-z0-9_]+$/.test(t) || !/^[A-Za-z0-9_]+$/.test(c)) {
          return 'ERROR: invalid identifier (only A-Z a-z 0-9 _ allowed)';
        }
        const total = (db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get() as { c: number }).c;
        const nulls = (
          db.prepare(`SELECT COUNT(*) AS c FROM "${t}" WHERE "${c}" IS NULL`).get() as { c: number }
        ).c;
        const distinct = (
          db.prepare(`SELECT COUNT(DISTINCT "${c}") AS c FROM "${t}"`).get() as { c: number }
        ).c;
        const k = input.topK ?? 10;
        const top = db
          .prepare(
            `SELECT "${c}" AS value, COUNT(*) AS count FROM "${t}" WHERE "${c}" IS NOT NULL
             GROUP BY "${c}" ORDER BY count DESC LIMIT ${k}`,
          )
          .all() as Array<{ value: unknown; count: number }>;
        return JSON.stringify({
          table: t,
          column: c,
          rowCount: total,
          nullCount: nulls,
          nullRatio: total > 0 ? Math.round((nulls / total) * 1000) / 1000 : 0,
          distinctCount: distinct,
          topValues: top.slice(0, k),
        });
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  // zod shape for DerivedMapping — permissive, we trust downstream parser.
  const derivedInputSchema = z.object({
    type: z.string().describe('edge type name (UPPER_SNAKE)'),
    kind: z.enum([
      'attraction_co_occurrence',
      'attraction_sequence',
      'haversine',
      'list_co_occurrence',
      'jaccard_similarity',
      'declared_fact',
      'city_cluster',
    ]),
    params: z.record(z.string(), z.any()),
  });

  const derivedPreview = tool({
    name: 'derived_preview',
    description: [
      'Preview the number of edges a proposed derived rule would produce, plus the top 10 sample pairs.',
      'Takes the canonical DerivedMapping shape. Call this BEFORE proposing parameters to validate the count is sensible.',
      'For O(N^2) kinds (haversine, jaccard_similarity), the result is sampled and marked estimated=true.',
    ].join(' '),
    inputSchema: derivedInputSchema,
    callback: (input) => {
      if (!mapping) return 'ERROR: slot has no mapping yet — add vertices/edges first.';
      try {
        const vertexMap = new Map<string, VertexMapping>();
        for (const v of mapping.vertices ?? []) vertexMap.set(v.label, v);
        const needSample =
          input.kind === 'haversine' || input.kind === 'jaccard_similarity';
        const result = collectDerivedPairs(input as DerivedMapping, vertexMap, {
          sampleLimit: needSample ? 500 : undefined,
        });
        return JSON.stringify({
          count: result.rows.length,
          estimated: !!result.estimated,
          direction: result.direction,
          vertexLabel: result.vertexLabel,
          supportProp: result.supportProp,
          warnings: result.warnings,
          topPairs: result.rows.slice(0, 10),
        });
      } catch (e) {
        return `ERROR: ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });

  return new Agent({
    model: buildBedrockModel(opts),
    tools: [schemaInspect, sqliteSchema, columnStats, derivedPreview],
    systemPrompt,
    printer: false,
  });
}

function safeParse(yaml: string): MappingConfig | null {
  try {
    return parseMapping(yaml);
  } catch {
    return null;
  }
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
