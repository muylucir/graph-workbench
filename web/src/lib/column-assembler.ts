/**
 * Column Assembler — state model + YAML serializer for the drag-and-drop mode.
 *
 * Each "slot YAML" is built from:
 *   - Nodes:    user-created node definitions, each with pk, props, source table
 *   - Edges:    typed relationships between nodes (source.match_by / target.match_by)
 *   - Derived:  parametric derived edges (CO_VISITED, NEAR_CITY, etc.)
 */

export type NodeKind = 'direct' | 'distinct' | 'json_explode' | 'csv_explode';

export type NodeDef = {
  id: string;                // local node id, e.g. 'n1'
  label: string;             // graph label, e.g. 'City'
  kind: NodeKind;
  source: {
    table: string;
    column?: string;          // for distinct/explode
  };
  pk: string;                 // either column name, $item, or SQL expression
  properties: Array<{ name: string; expr: string }>; // name -> expr
};

export type EdgeDef = {
  id: string;
  type: string;               // e.g. ATTRACTION_IN_CITY
  fromTable: string;          // table driving edge generation
  fromNodeId: string;         // local node id
  toNodeId: string;
  sourceMatchBy: string;      // expr resolving to source vertex id
  targetMatchBy: string;      // expr resolving to target vertex id
  properties?: Array<{ name: string; expr: string }>;
  explodeJson?: string;       // optional column to explode for multi-values
  explodeCsv?: string;
  where?: string;
};

export type DerivedKind =
  | 'attraction_co_occurrence'
  | 'attraction_sequence'
  | 'haversine'
  | 'list_co_occurrence'
  | 'jaccard_similarity'
  | 'declared_fact'
  | 'city_cluster';

export type DerivedDef = {
  id: string;
  type: string;
  kind: DerivedKind;
  params: Record<string, unknown>;
};

export type AssemblerState = {
  name: string;
  description: string;
  slot: 'A' | 'B' | 'C';
  nodes: NodeDef[];
  edges: EdgeDef[];
  derived: DerivedDef[];
};

export function emptyState(slot: 'A' | 'B' | 'C'): AssemblerState {
  return {
    name: 'Custom (컬럼 조립기)',
    description: '드래그앤드롭으로 조립한 매핑',
    slot,
    nodes: [],
    edges: [],
    derived: [],
  };
}

/**
 * Flat 프리셋에 해당하는 초기 상태 — 개발자가 이 위에서 빠르게 실험.
 */
export function flatPresetState(slot: 'A' | 'B' | 'C'): AssemblerState {
  return {
    name: 'Flat에서 시작',
    description: 'Flat 매핑을 출발점으로 놓고 드래그앤드롭으로 변형',
    slot,
    nodes: [
      {
        id: 'n_country',
        label: 'Country',
        kind: 'direct',
        source: { table: 'country' },
        pk: 'code',
        properties: [{ name: 'name', expr: 'name' }],
      },
      {
        id: 'n_city',
        label: 'City',
        kind: 'direct',
        source: { table: 'city' },
        pk: 'city_code',
        properties: [
          { name: 'cityName', expr: 'city_name' },
          { name: 'englishCityName', expr: 'english_city_name' },
          { name: 'lat', expr: 'latitude' },
          { name: 'lng', expr: 'longitude' },
          { name: 'stateCode', expr: 'state_code' },
          { name: 'countryCode', expr: 'country_code' },
        ],
      },
      {
        id: 'n_attraction',
        label: 'Attraction',
        kind: 'direct',
        source: { table: 'package_attraction' },
        pk: 'id',
        properties: [
          { name: 'landmarkNameKo', expr: 'landmarkNameKo' },
          { name: 'cityCode', expr: 'cityCode' },
          { name: 'latitude', expr: 'latitude' },
          { name: 'longitude', expr: 'longitude' },
          { name: 'featureSummaryKo', expr: 'featureSummaryKo' },
        ],
      },
      {
        id: 'n_hotel',
        label: 'Hotel',
        kind: 'direct',
        source: { table: 'package_hotel' },
        pk: 'id',
        properties: [
          { name: 'name', expr: 'name' },
          { name: 'grade', expr: 'grade' },
          { name: 'rating', expr: 'rating' },
          { name: 'address', expr: 'address' },
        ],
      },
      {
        id: 'n_sale',
        label: 'SaleProduct',
        kind: 'direct',
        source: { table: 'package_product_meta' },
        pk: 'saleProdCd',
        properties: [
          { name: 'saleProdNm', expr: 'saleProdNm' },
          { name: 'brndNm', expr: 'brndNm' },
          { name: 'trvlDayCnt', expr: 'trvlDayCnt' },
          { name: 'trvlNgtCnt', expr: 'trvlNgtCnt' },
        ],
      },
    ],
    edges: [
      {
        id: 'e1',
        type: 'IN_COUNTRY',
        fromTable: 'city',
        fromNodeId: 'n_city',
        toNodeId: 'n_country',
        sourceMatchBy: 'city_code',
        targetMatchBy: 'country_code',
        where: 'country_code IS NOT NULL',
      },
      {
        id: 'e2',
        type: 'ATTRACTION_IN_CITY',
        fromTable: 'package_attraction',
        fromNodeId: 'n_attraction',
        toNodeId: 'n_city',
        sourceMatchBy: 'id',
        targetMatchBy: 'cityCode',
        where: 'cityCode IS NOT NULL',
      },
      {
        id: 'e3',
        type: 'ARRIVES_IN',
        fromTable: 'package_product_meta',
        fromNodeId: 'n_sale',
        toNodeId: 'n_city',
        sourceMatchBy: 'saleProdCd',
        targetMatchBy: 'arrCityCd',
        where: 'arrCityCd IS NOT NULL',
      },
    ],
    derived: [],
  };
}

/**
 * Serialize the assembler state into the same YAML format that executor.ts consumes.
 */
export function stateToYaml(s: AssemblerState): string {
  const labelOf = (nodeId: string) =>
    s.nodes.find((n) => n.id === nodeId)?.label ?? nodeId;

  const yVertices = s.nodes.map(nodeToYaml).join('\n\n');
  const yEdges =
    s.edges.length > 0
      ? s.edges.map((e) => edgeToYaml(e, labelOf)).join('\n\n')
      : '  []';
  const yDerived = s.derived.length > 0 ? s.derived.map(derivedToYaml).join('\n\n') : '[]';

  return [
    `name: "${escape(s.name)}"`,
    `description: "${escape(s.description)}"`,
    `version: "0.5"`,
    `slot: ${s.slot}`,
    ``,
    `source: { sqlite: "../graph-study/osaka_subset/graph_hotel_info_osaka.sqlite" }`,
    ``,
    `vertices:`,
    yVertices || `  []`,
    ``,
    `edges:`,
    yEdges,
    ``,
    s.derived.length > 0 ? `derived:\n${yDerived}` : `derived: []`,
    ``,
    `options: { batch_size: 100 }`,
  ].join('\n');
}

function escape(v: string): string {
  return v.replace(/"/g, '\\"');
}

function indentProps(list: Array<{ name: string; expr: string }>): string {
  return list
    .map((p) => `      ${p.name}: ${quoteExpr(p.expr)}`)
    .join('\n');
}

function quoteExpr(e: string): string {
  // if expression looks like a plain column name, no quoting; else quote with "
  if (/^[A-Za-z_][\w]*$/.test(e) || e === '$item') return e;
  return `"${e.replace(/"/g, '\\"')}"`;
}

function nodeToYaml(n: NodeDef): string {
  const lines: string[] = [];
  lines.push(`  - label: ${n.label}`);
  if (n.kind === 'direct') {
    lines.push(`    from: { table: ${n.source.table} }`);
  } else if (n.kind === 'distinct') {
    const col = n.source.column ?? n.pk;
    lines.push(
      `    from: { table: ${n.source.table}, distinct: [${col}] }`,
    );
  } else if (n.kind === 'json_explode') {
    const col = n.source.column!;
    lines.push(
      `    from: { table: ${n.source.table}, explode_json: ${col}, distinct: [$item] }`,
    );
  } else if (n.kind === 'csv_explode') {
    const col = n.source.column!;
    lines.push(
      `    from: { table: ${n.source.table}, explode_csv: ${col}, distinct: [$item] }`,
    );
  }
  lines.push(`    id: ${quoteExpr(n.pk)}`);
  if (n.properties.length > 0) {
    lines.push(`    properties:`);
    lines.push(indentProps(n.properties));
  } else {
    lines.push(`    properties: {}`);
  }
  return lines.join('\n');
}

function edgeToYaml(e: EdgeDef, labelOf: (nodeId: string) => string): string {
  const lines: string[] = [];
  lines.push(`  - type: ${e.type}`);
  const fromParts: string[] = [`table: ${e.fromTable}`];
  if (e.where) fromParts.push(`where: "${e.where.replace(/"/g, '\\"')}"`);
  if (e.explodeJson) fromParts.push(`explode_json: ${e.explodeJson}`);
  if (e.explodeCsv) fromParts.push(`explode_csv: ${e.explodeCsv}`);
  lines.push(`    from: { ${fromParts.join(', ')} }`);
  lines.push(
    `    source: { vertex: ${labelOf(e.fromNodeId)}, match_by: ${quoteExpr(e.sourceMatchBy)} }`,
  );
  lines.push(
    `    target: { vertex: ${labelOf(e.toNodeId)}, match_by: ${quoteExpr(e.targetMatchBy)} }`,
  );
  if (e.properties && e.properties.length > 0) {
    lines.push(`    properties:`);
    lines.push(indentProps(e.properties));
  }
  return lines.join('\n');
}

function derivedToYaml(d: DerivedDef): string {
  const params = Object.entries(d.params)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');
  return `  - type: ${d.type}\n    kind: ${d.kind}\n    params: { ${params} }`;
}

/**
 * Estimate which questions the current assembler output can solve.
 * We reuse the component-id mapping from question-requirements.ts.
 */
export function coveredQuestionIds(s: AssemblerState): string[] {
  // Detect well-known components by pattern-matching the state
  const hasNode = (label: string) => s.nodes.some((n) => n.label === label);
  const hasEdge = (type: string) => s.edges.some((e) => e.type === type);
  const hasDerived = (type: string) => s.derived.some((d) => d.type === type);

  const comps = new Set<string>();
  if (hasNode('Theme')) comps.add('theme_vertex');
  if (hasNode('Mood')) comps.add('mood_vertex');
  if (hasNode('Season')) comps.add('season_vertex');
  if (hasNode('Prefecture')) comps.add('prefecture_vertex');
  if (hasDerived('NEAR_CITY')) comps.add('near_city');
  if (hasDerived('OFTEN_COTRAVELED')) comps.add('often_cotraveled');
  if (hasNode('RepresentativeProduct')) comps.add('representative_split');
  if (hasNode('HotelStay')) comps.add('hotel_stay_vertex');
  if (hasNode('FlightSegment')) comps.add('flight_segment_vertex');
  if (hasNode('DepartureMarket')) comps.add('departure_market_vertex');
  if (hasDerived('CO_VISITED')) comps.add('co_visited');
  if (hasDerived('VISITED_AFTER')) comps.add('visited_after');

  // Very rough — mirror the question catalog here (keep in sync with question-requirements.ts)
  const REQ: Record<string, string[]> = {
    Q01: ['prefecture_vertex', 'near_city', 'often_cotraveled'],
    Q02: [],
    Q03: ['hotel_stay_vertex'],
    Q04: [],
    Q05: ['representative_split'],
    Q06: ['representative_split'],
    Q07: ['co_visited'],
    Q08: ['visited_after'],
    Q09: ['mood_vertex', 'prefecture_vertex', 'near_city', 'often_cotraveled'],
    Q10: ['hotel_stay_vertex'],
    Q11: ['flight_segment_vertex', 'departure_market_vertex'],
    Q12: [],
    Q13: [],
    Q14: ['hotel_stay_vertex', 'theme_vertex'],
    Q15: ['season_vertex'],
    Q16: ['co_visited'],
  };

  // Base plane only solves Q with no requires AND requires core vertices
  const hasBasePlane =
    hasNode('City') &&
    hasNode('SaleProduct') &&
    hasNode('Attraction') &&
    hasEdge('ATTRACTION_IN_CITY');

  const covered: string[] = [];
  for (const [qid, req] of Object.entries(REQ)) {
    if (!hasBasePlane) continue;
    if (req.every((r) => comps.has(r))) covered.push(qid);
  }
  return covered;
}

/**
 * Count metrics from the assembler state (for the badge).
 */
export function stateMetrics(s: AssemblerState): {
  vertex: number;
  edge: number;
  derived: number;
  usedTables: number;
} {
  const tables = new Set<string>();
  for (const n of s.nodes) tables.add(n.source.table);
  for (const e of s.edges) tables.add(e.fromTable);
  return {
    vertex: s.nodes.length,
    edge: s.edges.length,
    derived: s.derived.length,
    usedTables: tables.size,
  };
}
