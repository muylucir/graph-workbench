/**
 * MD-friendly derived-edge template catalog.
 *
 * Each template exposes a sentence-shaped UI that hides YAML/SQL/kind names.
 * `toDerivedDef` converts a user-filled draft into the canonical DerivedDef
 * that `executor.ts` consumes. `fromDerivedDef` is the reverse — used only to
 * restore editable cards after a preset/snapshot load (bounded one-way flow:
 * preset → cards, never Expert YAML → cards).
 */

import type { DerivedDef, NodeDef, AssemblerState } from './column-assembler';
import type { DerivedMapping } from './mapping/types';

export type TemplateId =
  | 'co_visited'
  | 'near_city'
  | 'next_course'
  | 'similar_place'
  | 'declared'
  | 'cluster'
  | 'often_cotravel';

export type SlotSpec =
  | {
      kind: 'number';
      key: string;
      labelKo: string;
      unit?: string;
      min?: number;
      max?: number;
      defaultValue: number;
    }
  | {
      kind: 'text';
      key: string;
      labelKo: string;
      placeholder?: string;
      defaultValue?: string;
    }
  | {
      kind: 'token_column';
      key: string;
      labelKo: string;
      /** Vertex label whose property carries the token array. */
      vertexLabel: string;
    }
  | {
      kind: 'pair_list';
      key: string;
      labelKo: string;
      /** Vertex label used to lookup ids via autocomplete. */
      vertexLabel: string;
    }
  | {
      kind: 'multi_id_picker';
      key: string;
      labelKo: string;
      vertexLabel: string;
      minItems?: number;
      maxItems?: number;
    };

export type DependencyIssue = { severity: 'error' | 'warning'; message: string };

export type TemplateMeta = {
  id: TemplateId;
  titleKo: string;
  subtitleKo: string;
  exampleKo: string;
  hintKo: string;
  defaultEdgeTypeName: string;
  slots: SlotSpec[];
  /** Check preconditions against the current assembler state. */
  dependencies: (state: AssemblerState) => DependencyIssue[];
  /** Build a canonical DerivedDef from a draft. */
  toDerivedDef: (draft: RuleDraft, state: AssemblerState) => DerivedDef;
  /** Render the sentence shown at the top of a draft card. */
  sentenceKo: (draft: RuleDraft, state: AssemblerState) => string;
  /** Match a DerivedDef back into this template (for preset round-trip). */
  fromDerivedDef: (d: DerivedDef) => RuleDraft | null;
};

export type RuleDraft = {
  id: string;
  templateId: TemplateId;
  edgeTypeName: string;
  inputs: Record<string, unknown>;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function newDraftId(): string {
  return `rd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function hasVertex(state: AssemblerState, label: string): NodeDef | undefined {
  return state.nodes.find((n) => n.label === label);
}

function hasProperty(node: NodeDef | undefined, propNames: string[]): boolean {
  if (!node) return false;
  const set = new Set(node.properties.map((p) => p.name));
  return propNames.some((p) => set.has(p));
}

/**
 * Token column aliases — map technical property names to MD-friendly Korean
 * labels for the similar_place (jaccard) template. Only whitelisted names are
 * surfaced in the UI; everything else falls back to its raw name under "기타".
 */
export const tokenColumnAliases: Record<string, string> = {
  themes: '테마',
  theme: '테마',
  moods: '분위기',
  mood: '분위기',
  seasons: '시즌',
  season: '시즌',
  tags: '태그',
};

/**
 * Find candidate token columns on a vertex. Returns [{propName, labelKo}].
 */
export function tokenColumnCandidates(
  state: AssemblerState,
  vertexLabel: string,
): Array<{ propName: string; exprColumn: string; labelKo: string }> {
  const node = hasVertex(state, vertexLabel);
  if (!node) return [];
  const out: Array<{ propName: string; exprColumn: string; labelKo: string }> = [];
  for (const p of node.properties) {
    const lower = p.name.toLowerCase();
    const labelKo =
      tokenColumnAliases[lower] ??
      tokenColumnAliases[p.expr.toLowerCase()] ??
      p.name;
    out.push({ propName: p.name, exprColumn: p.expr || p.name, labelKo });
  }
  // Prioritize aliased ones
  out.sort((a, b) => {
    const aliased = (n: string) =>
      tokenColumnAliases[n.toLowerCase()] !== undefined ? 0 : 1;
    return aliased(a.propName) - aliased(b.propName);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Template catalog                                                   */
/* ------------------------------------------------------------------ */

const CO_VISITED: TemplateMeta = {
  id: 'co_visited',
  titleKo: '자주 함께 간다',
  subtitleKo: '같은 상품에 자주 같이 등장하는 관광지끼리 이어요',
  exampleKo: '"오사카성 + 도톤보리"',
  hintKo: '2박3일 이상 상품이 많을 때 효과가 좋아요',
  defaultEdgeTypeName: 'CO_VISITED',
  slots: [
    {
      kind: 'number',
      key: 'support_min',
      labelKo: '최소 함께 나타난 횟수',
      min: 1,
      max: 100,
      defaultValue: 3,
    },
  ],
  dependencies: (s) => {
    const issues: DependencyIssue[] = [];
    if (!hasVertex(s, 'Attraction'))
      issues.push({
        severity: 'error',
        message: '관광지(Attraction) 노드가 먼저 만들어져야 해요.',
      });
    return issues;
  },
  toDerivedDef: (draft) => ({
    id: draft.id,
    type: draft.edgeTypeName || 'CO_VISITED',
    kind: 'attraction_co_occurrence',
    params: {
      table: 'package_product_schedules',
      group_by: 'saleProdCd',
      pair_column: 'attractionId',
      support_min: Number(draft.inputs.support_min ?? 3),
    },
  }),
  sentenceKo: (d) =>
    `**관광지**끼리, 같은 상품에 최소 **${d.inputs.support_min ?? 3}번** 함께 나오면 "${d.edgeTypeName || 'CO_VISITED'}"로 이어요.`,
  fromDerivedDef: (d) => {
    if (d.kind !== 'attraction_co_occurrence') return null;
    return {
      id: d.id,
      templateId: 'co_visited',
      edgeTypeName: d.type,
      inputs: { support_min: Number(d.params.support_min ?? 3) },
    };
  },
};

const NEAR_CITY: TemplateMeta = {
  id: 'near_city',
  titleKo: '근처 도시',
  subtitleKo: '지도에서 가까이 붙어있는 도시끼리 이어요',
  exampleKo: '"후쿠오카 ↔ 구마모토 140km"',
  hintKo: '도시 노드에 위치 정보(위도·경도)가 있어야 써요',
  defaultEdgeTypeName: 'NEAR_CITY',
  slots: [
    {
      kind: 'number',
      key: 'threshold_km',
      labelKo: '몇 km 이내',
      unit: 'km',
      min: 10,
      max: 500,
      defaultValue: 100,
    },
  ],
  dependencies: (s) => {
    const issues: DependencyIssue[] = [];
    const city = hasVertex(s, 'City');
    if (!city) {
      issues.push({
        severity: 'error',
        message: '도시(City) 노드가 먼저 만들어져야 해요.',
      });
    } else if (!hasProperty(city, ['lat', 'latitude', 'lng', 'longitude'])) {
      issues.push({
        severity: 'error',
        message: '도시 노드에 위도·경도를 먼저 넣어주세요.',
      });
    }
    return issues;
  },
  toDerivedDef: (draft, state) => {
    const city = hasVertex(state, 'City');
    // Pick whatever property names the current mapping uses.
    const latProp = city?.properties.find((p) => /lat/i.test(p.name))?.expr ?? 'latitude';
    const lngProp = city?.properties.find((p) => /l[ong|ng]/i.test(p.name))?.expr ?? 'longitude';
    return {
      id: draft.id,
      type: draft.edgeTypeName || 'NEAR_CITY',
      kind: 'haversine',
      params: {
        vertex: 'City',
        lat_prop: latProp,
        lng_prop: lngProp,
        threshold_km: Number(draft.inputs.threshold_km ?? 100),
      },
    };
  },
  sentenceKo: (d) =>
    `**도시**끼리, **${d.inputs.threshold_km ?? 100}km** 이내에 있으면 "${d.edgeTypeName || 'NEAR_CITY'}"로 이어요.`,
  fromDerivedDef: (d) => {
    if (d.kind !== 'haversine') return null;
    return {
      id: d.id,
      templateId: 'near_city',
      edgeTypeName: d.type,
      inputs: { threshold_km: Number(d.params.threshold_km ?? 100) },
    };
  },
};

const NEXT_COURSE: TemplateMeta = {
  id: 'next_course',
  titleKo: '다음 코스',
  subtitleKo: '하루 일정 안에서 먼저 본 뒤 이어서 가는 관광지 순서',
  exampleKo: '"스카이트리 → 아사쿠사"',
  hintKo: '일정표 순번 데이터가 있어야 써요',
  defaultEdgeTypeName: 'VISITED_AFTER',
  slots: [
    {
      kind: 'number',
      key: 'support_min',
      labelKo: '최소 관찰 횟수',
      min: 1,
      max: 100,
      defaultValue: 3,
    },
  ],
  dependencies: (s) => {
    const issues: DependencyIssue[] = [];
    if (!hasVertex(s, 'Attraction'))
      issues.push({
        severity: 'error',
        message: '관광지(Attraction) 노드가 먼저 만들어져야 해요.',
      });
    return issues;
  },
  toDerivedDef: (draft) => ({
    id: draft.id,
    type: draft.edgeTypeName || 'VISITED_AFTER',
    kind: 'attraction_sequence',
    params: {
      table: 'package_product_schedules',
      partition_by: ['saleProdCd', 'schdDay'],
      order_by: 'schtExprSqc',
      item_column: 'attractionId',
      support_min: Number(draft.inputs.support_min ?? 3),
    },
  }),
  sentenceKo: (d) =>
    `**관광지**의 방문 순서가 최소 **${d.inputs.support_min ?? 3}번** 같으면 "${d.edgeTypeName || 'VISITED_AFTER'}"로 이어요.`,
  fromDerivedDef: (d) => {
    if (d.kind !== 'attraction_sequence') return null;
    return {
      id: d.id,
      templateId: 'next_course',
      edgeTypeName: d.type,
      inputs: { support_min: Number(d.params.support_min ?? 3) },
    };
  },
};

const SIMILAR_PLACE: TemplateMeta = {
  id: 'similar_place',
  titleKo: '비슷한 곳',
  subtitleKo: '테마·분위기가 겹치는 관광지끼리 이어요',
  exampleKo: '"두 곳 다 가족여행·야경 태그를 가지고 있음"',
  hintKo: '관광지에 테마·분위기 정보가 있어야 써요',
  defaultEdgeTypeName: 'SIMILAR_PLACE',
  slots: [
    {
      kind: 'token_column',
      key: 'tokens_column',
      labelKo: '비교할 속성',
      vertexLabel: 'Attraction',
    },
    {
      kind: 'number',
      key: 'min_jaccard',
      labelKo: '최소 유사도 (0~1)',
      min: 0.1,
      max: 1,
      defaultValue: 0.3,
    },
  ],
  dependencies: (s) => {
    const issues: DependencyIssue[] = [];
    const a = hasVertex(s, 'Attraction');
    if (!a) {
      issues.push({
        severity: 'error',
        message: '관광지(Attraction) 노드가 먼저 만들어져야 해요.',
      });
    } else if (
      !a.properties.some((p) =>
        Object.keys(tokenColumnAliases).some((al) => al === p.name.toLowerCase()),
      )
    ) {
      issues.push({
        severity: 'warning',
        message: '테마·분위기·시즌 중 하나를 관광지 속성으로 넣어두면 더 정확해요.',
      });
    }
    return issues;
  },
  toDerivedDef: (draft, state) => {
    const a = hasVertex(state, 'Attraction');
    const propName = (draft.inputs.tokens_column as string) ?? 'themes';
    const exprCol =
      a?.properties.find((p) => p.name === propName)?.expr ?? propName;
    return {
      id: draft.id,
      type: draft.edgeTypeName || 'SIMILAR_PLACE',
      kind: 'jaccard_similarity',
      params: {
        vertex: 'Attraction',
        table: a?.source.table ?? 'package_attraction',
        id_column: a?.pk ?? 'id',
        tokens_column: exprCol,
        item_source: 'explode_json',
        min_overlap: 2,
        min_jaccard: Number(draft.inputs.min_jaccard ?? 0.3),
      },
    };
  },
  sentenceKo: (d) => {
    const col = String(d.inputs.tokens_column ?? '테마');
    const mj = d.inputs.min_jaccard ?? 0.3;
    return `**관광지**끼리 **${col}**가 **${(Number(mj) * 100).toFixed(0)}%** 이상 겹치면 "${d.edgeTypeName || 'SIMILAR_PLACE'}"로 이어요.`;
  },
  fromDerivedDef: (d) => {
    if (d.kind !== 'jaccard_similarity') return null;
    return {
      id: d.id,
      templateId: 'similar_place',
      edgeTypeName: d.type,
      inputs: {
        tokens_column: d.params.tokens_column,
        min_jaccard: Number(d.params.min_jaccard ?? 0.3),
      },
    };
  },
};

const DECLARED: TemplateMeta = {
  id: 'declared',
  titleKo: '추천 조합 (직접 선언)',
  subtitleKo: 'MD가 직접 "이 둘은 묶어야 해" 쌍을 선언해요',
  exampleKo: '"시부야 스크램블 + 하치코 동상"',
  hintKo: '규칙으로는 잡기 어려운 암묵지를 넣을 때',
  defaultEdgeTypeName: 'RECOMMENDED_WITH',
  slots: [
    {
      kind: 'pair_list',
      key: 'pairs',
      labelKo: '이 쌍들을 연결',
      vertexLabel: 'Attraction',
    },
  ],
  dependencies: (s) => {
    const issues: DependencyIssue[] = [];
    if (!hasVertex(s, 'Attraction') && !hasVertex(s, 'City')) {
      issues.push({
        severity: 'error',
        message: '관광지 또는 도시 노드가 먼저 만들어져야 해요.',
      });
    }
    return issues;
  },
  toDerivedDef: (draft) => ({
    id: draft.id,
    type: draft.edgeTypeName || 'RECOMMENDED_WITH',
    kind: 'declared_fact',
    params: {
      vertex: 'Attraction',
      pairs: (draft.inputs.pairs as Array<{ a: string; b: string; note?: string }>) ?? [],
      directed: false,
    },
  }),
  sentenceKo: (d) => {
    const pairs = (d.inputs.pairs as Array<unknown>) ?? [];
    return `**관광지**에 대해 직접 선언한 **${pairs.length}개 쌍**을 "${d.edgeTypeName || 'RECOMMENDED_WITH'}"로 이어요.`;
  },
  fromDerivedDef: (d) => {
    if (d.kind !== 'declared_fact') return null;
    return {
      id: d.id,
      templateId: 'declared',
      edgeTypeName: d.type,
      inputs: { pairs: d.params.pairs ?? [] },
    };
  },
};

const CLUSTER: TemplateMeta = {
  id: 'cluster',
  titleKo: '코스 묶음',
  subtitleKo: '여러 도시를 하나의 여행권역으로 묶어요',
  exampleKo: '"규슈 3도시 패키지 = 후쿠오카·구마모토·가고시마"',
  hintKo: '5~10개 도시를 권장해요 (15개 초과 시 관계 수가 급증)',
  defaultEdgeTypeName: 'CLUSTER_OF',
  slots: [
    {
      kind: 'text',
      key: 'cluster_name',
      labelKo: '묶음 이름',
      placeholder: '예: 간사이 황금 삼각',
      defaultValue: '',
    },
    {
      kind: 'multi_id_picker',
      key: 'members',
      labelKo: '어떤 도시들을 묶을까요',
      vertexLabel: 'City',
      minItems: 2,
      maxItems: 15,
    },
  ],
  dependencies: (s) => {
    const issues: DependencyIssue[] = [];
    if (!hasVertex(s, 'City')) {
      issues.push({
        severity: 'error',
        message: '도시(City) 노드가 먼저 만들어져야 해요.',
      });
    }
    return issues;
  },
  toDerivedDef: (draft) => ({
    id: draft.id,
    type: draft.edgeTypeName || 'CLUSTER_OF',
    kind: 'city_cluster',
    params: {
      vertex: 'City',
      cluster_name: String(draft.inputs.cluster_name ?? '').trim(),
      members: (draft.inputs.members as string[]) ?? [],
    },
  }),
  sentenceKo: (d) => {
    const members = (d.inputs.members as unknown[]) ?? [];
    const nm = String(d.inputs.cluster_name ?? '이름 없음');
    return `**도시 ${members.length}개**를 "${nm}" 권역으로 묶어 "${d.edgeTypeName || 'CLUSTER_OF'}"로 이어요.`;
  },
  fromDerivedDef: (d) => {
    if (d.kind !== 'city_cluster') return null;
    return {
      id: d.id,
      templateId: 'cluster',
      edgeTypeName: d.type,
      inputs: {
        cluster_name: d.params.cluster_name,
        members: d.params.members,
      },
    };
  },
};

const OFTEN_COTRAVEL: TemplateMeta = {
  id: 'often_cotravel',
  titleKo: '자주 같이 가는 도시',
  subtitleKo: '출발시장의 기존 상품에 나란히 등장하는 도시들',
  exampleKo: '"후쿠오카·구마모토를 한 상품에"',
  hintKo: '출발시장 데이터에 방문도시 리스트가 있어야 써요',
  defaultEdgeTypeName: 'OFTEN_COTRAVELED',
  slots: [
    {
      kind: 'number',
      key: 'support_min',
      labelKo: '최소 동반 상품 수',
      min: 1,
      max: 50,
      defaultValue: 2,
    },
  ],
  dependencies: (s) => {
    const issues: DependencyIssue[] = [];
    if (!hasVertex(s, 'City')) {
      issues.push({
        severity: 'error',
        message: '도시(City) 노드가 먼저 만들어져야 해요.',
      });
    }
    return issues;
  },
  toDerivedDef: (draft) => ({
    id: draft.id,
    type: draft.edgeTypeName || 'OFTEN_COTRAVELED',
    kind: 'list_co_occurrence',
    params: {
      table: 'package_product_meta',
      list_column: 'vistCity',
      separator: ',',
      support_min: Number(draft.inputs.support_min ?? 2),
    },
  }),
  sentenceKo: (d) =>
    `**도시**가 **${d.inputs.support_min ?? 2}개 이상의 상품**에 함께 등장하면 "${d.edgeTypeName || 'OFTEN_COTRAVELED'}"로 이어요.`,
  fromDerivedDef: (d) => {
    if (d.kind !== 'list_co_occurrence') return null;
    return {
      id: d.id,
      templateId: 'often_cotravel',
      edgeTypeName: d.type,
      inputs: { support_min: Number(d.params.support_min ?? 2) },
    };
  },
};

export const TEMPLATES: TemplateMeta[] = [
  CO_VISITED,
  NEAR_CITY,
  NEXT_COURSE,
  SIMILAR_PLACE,
  DECLARED,
  CLUSTER,
  OFTEN_COTRAVEL,
];

export function getTemplate(id: TemplateId): TemplateMeta {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template id: ${id}`);
  return t;
}

/** Create a draft pre-populated with template defaults. */
export function createDraftFromTemplate(templateId: TemplateId): RuleDraft {
  const t = getTemplate(templateId);
  const inputs: Record<string, unknown> = {};
  for (const slot of t.slots) {
    if (slot.kind === 'number') inputs[slot.key] = slot.defaultValue;
    else if (slot.kind === 'text') inputs[slot.key] = slot.defaultValue ?? '';
    else if (slot.kind === 'token_column') inputs[slot.key] = 'themes';
    else if (slot.kind === 'pair_list') inputs[slot.key] = [];
    else if (slot.kind === 'multi_id_picker') inputs[slot.key] = [];
  }
  return {
    id: newDraftId(),
    templateId,
    edgeTypeName: t.defaultEdgeTypeName,
    inputs,
  };
}

/** Reverse-match each DerivedDef to its template for editable card restore. */
export function draftsFromDeriveds(
  deriveds: DerivedDef[],
): { drafts: RuleDraft[]; unmatched: DerivedDef[] } {
  const drafts: RuleDraft[] = [];
  const unmatched: DerivedDef[] = [];
  for (const d of deriveds) {
    let matched: RuleDraft | null = null;
    for (const t of TEMPLATES) {
      const r = t.fromDerivedDef(d);
      if (r) {
        matched = r;
        break;
      }
    }
    if (matched) drafts.push(matched);
    else unmatched.push(d);
  }
  return { drafts, unmatched };
}

/** Convert drafts to DerivedDefs for writing back into AssemblerState. */
export function draftsToDeriveds(
  drafts: RuleDraft[],
  state: AssemblerState,
): { deriveds: DerivedDef[]; errors: Array<{ draftId: string; message: string }> } {
  const out: DerivedDef[] = [];
  const errors: Array<{ draftId: string; message: string }> = [];
  for (const d of drafts) {
    const t = TEMPLATES.find((x) => x.id === d.templateId);
    if (!t) {
      errors.push({ draftId: d.id, message: `unknown template ${d.templateId}` });
      continue;
    }
    const deps = t.dependencies(state).filter((x) => x.severity === 'error');
    if (deps.length > 0) {
      errors.push({ draftId: d.id, message: deps.map((x) => x.message).join(' / ') });
      continue;
    }
    out.push(t.toDerivedDef(d, state));
  }
  return { deriveds: out, errors };
}

/** Coerce a canonical DerivedDef.params to a minimal DerivedMapping for the preview API. */
export function draftToDerivedMapping(
  draft: RuleDraft,
  state: AssemblerState,
): DerivedMapping {
  const t = getTemplate(draft.templateId);
  const def = t.toDerivedDef(draft, state);
  return {
    type: def.type,
    kind: def.kind,
    params: def.params,
  } as DerivedMapping;
}
