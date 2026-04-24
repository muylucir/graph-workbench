import 'server-only';
import type {
  MappingConfig,
  VertexMapping,
  EdgeMapping,
  DerivedMapping,
} from './types';
import { getDb, select } from '../sqlite/client';
import { runOpenCypher } from '../neptune/client';
import { evalExpression, evalWhere } from './expressions';

export type ExecEvent =
  | { type: 'step'; name: string; note?: string }
  | { type: 'progress'; name: string; processed: number; total: number }
  | { type: 'done'; name: string; inserted: number; elapsedMs: number }
  | { type: 'error'; name?: string; message: string }
  | { type: 'finished'; totalMs: number; vertexCount: number; edgeCount: number };

type Row = Record<string, unknown>;

const SLOT_SUFFIX = (slot: 'A' | 'B' | 'C') => `__${slot}`;

/* ------------------------------------------------------------------ */
/*  Row iteration with explode support                                 */
/* ------------------------------------------------------------------ */

function* iterRows(
  table: string,
  where: string | undefined,
  opts: { distinct?: string[]; explodeJson?: string; explodeCsv?: string } = {},
): Generator<Row, void, unknown> {
  let sql: string;
  if (opts.distinct && opts.distinct.length > 0) {
    const nonMeta = opts.distinct.filter((c) => !c.startsWith('$'));
    if (nonMeta.length === 0) {
      // only $item distinct — just read everything
      sql = `SELECT * FROM "${table}"`;
    } else {
      sql = `SELECT DISTINCT ${nonMeta.map((c) => `"${c}"`).join(', ')} FROM "${table}"`;
    }
  } else {
    sql = `SELECT * FROM "${table}"`;
  }
  const rows = select<Row>(sql);

  for (const row of rows) {
    if (!evalWhere(where, row)) continue;

    if (opts.explodeJson) {
      const raw = row[opts.explodeJson];
      if (raw == null) continue;
      let arr: unknown[];
      try {
        arr = JSON.parse(String(raw));
        if (!Array.isArray(arr)) continue;
      } catch {
        continue;
      }
      for (const item of arr) {
        yield { ...row, $item: item };
      }
    } else if (opts.explodeCsv) {
      const raw = row[opts.explodeCsv];
      if (raw == null) continue;
      const parts = String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const item of parts) {
        yield { ...row, $item: item };
      }
    } else {
      yield row;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Vertex loading                                                     */
/* ------------------------------------------------------------------ */

async function loadVertex(
  slot: 'A' | 'B' | 'C',
  v: VertexMapping,
  send: (e: ExecEvent) => void,
  batchSize: number,
): Promise<number> {
  const suffix = SLOT_SUFFIX(slot);
  const label = `${v.label}${suffix}`;

  const items: Row[] = [];
  const seen = new Set<string>();
  for (const row of iterRows(v.from.table, v.from.where, {
    distinct: v.from.distinct,
    explodeJson: v.from.explode_json,
    explodeCsv: v.from.explode_csv,
  })) {
    const ctx = { item: row.$item };
    let id: unknown;
    try {
      id = evalExpression(v.id, row, ctx);
    } catch (e) {
      send({
        type: 'error',
        name: v.label,
        message: `id expression failed: ${(e as Error).message}`,
      });
      return 0;
    }
    if (id == null || id === '') continue;
    const idStr = String(id);
    if (seen.has(idStr)) continue;
    seen.add(idStr);

    const props: Row = { _id: idStr };
    for (const [key, expr] of Object.entries(v.properties ?? {})) {
      try {
        const val = evalExpression(expr, row, ctx);
        if (val !== undefined && val !== null && val !== '') props[key] = val;
      } catch {
        /* skip bad property */
      }
    }
    items.push(props);
  }

  const total = items.length;
  send({ type: 'step', name: v.label, note: `${total} rows` });
  if (total === 0) {
    send({ type: 'done', name: v.label, inserted: 0, elapsedMs: 0 });
    return 0;
  }

  const start = Date.now();
  for (let i = 0; i < total; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const cypher = `
      UNWIND $batch AS r
      MERGE (n:\`${label}\` {_id: r._id})
      SET n += r
    `;
    try {
      await runOpenCypher(cypher, { batch });
    } catch (e) {
      send({
        type: 'error',
        name: v.label,
        message: `batch ${i}: ${e instanceof Error ? e.message : String(e)}`,
      });
      return i;
    }
    send({ type: 'progress', name: v.label, processed: Math.min(i + batchSize, total), total });
  }
  send({ type: 'done', name: v.label, inserted: total, elapsedMs: Date.now() - start });
  return total;
}

/* ------------------------------------------------------------------ */
/*  Edge loading                                                       */
/* ------------------------------------------------------------------ */

async function loadEdge(
  slot: 'A' | 'B' | 'C',
  e: EdgeMapping,
  vertexMap: Map<string, VertexMapping>,
  send: (ev: ExecEvent) => void,
  batchSize: number,
): Promise<number> {
  const suffix = SLOT_SUFFIX(slot);
  const type = `${e.type}${suffix}`;
  const sourceLabel = `${e.source.vertex}${suffix}`;
  const targetLabel = `${e.target.vertex}${suffix}`;

  const sourceVertex = vertexMap.get(e.source.vertex);
  const targetVertex = vertexMap.get(e.target.vertex);
  if (!sourceVertex || !targetVertex) {
    send({ type: 'error', name: e.type, message: 'source or target vertex not found' });
    return 0;
  }

  const rows: Array<{ src: string; dst: string; props: Row }> = [];
  for (const row of iterRows(e.from.table, e.from.where, {
    explodeJson: e.from.explode_json,
    explodeCsv: e.from.explode_csv,
  })) {
    const ctx = { item: row.$item };

    let srcIdRaw: unknown;
    let dstIdRaw: unknown;
    try {
      srcIdRaw = evalExpression(e.source.match_by, row, ctx);
    } catch (err) {
      send({
        type: 'error',
        name: e.type,
        message: `source match_by '${e.source.match_by}' failed: ${(err as Error).message}`,
      });
      return 0;
    }
    try {
      dstIdRaw = evalExpression(e.target.match_by, row, ctx);
    } catch (err) {
      send({
        type: 'error',
        name: e.type,
        message: `target match_by '${e.target.match_by}' failed: ${(err as Error).message}`,
      });
      return 0;
    }

    if (srcIdRaw == null || srcIdRaw === '' || dstIdRaw == null || dstIdRaw === '') continue;

    // For edges, match_by is often the child table's column referring to another vertex's business key.
    // The vertex's id is a separate expression; we must resolve target id by mapping.
    // Simple path: if match_by resolves to the same value as target's id expression on its own table, we can just use it directly.
    // For Phase 1 style YAMLs this works because target vertex id is a bare column.

    const props: Row = {};
    for (const [key, expr] of Object.entries(e.properties ?? {})) {
      try {
        const val = evalExpression(expr, row, ctx);
        if (val !== undefined && val !== null && val !== '') props[key] = val;
      } catch {
        /* skip */
      }
    }
    rows.push({ src: String(srcIdRaw), dst: String(dstIdRaw), props });
  }

  const total = rows.length;
  send({ type: 'step', name: e.type, note: `${total} rows` });
  if (total === 0) {
    send({ type: 'done', name: e.type, inserted: 0, elapsedMs: 0 });
    return 0;
  }

  const start = Date.now();
  for (let i = 0; i < total; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const cypher = `
      UNWIND $batch AS r
      MATCH (s:\`${sourceLabel}\` {_id: r.src})
      MATCH (t:\`${targetLabel}\` {_id: r.dst})
      MERGE (s)-[rel:\`${type}\`]->(t)
      SET rel += r.props
    `;
    try {
      await runOpenCypher(cypher, { batch });
    } catch (err) {
      send({
        type: 'error',
        name: e.type,
        message: `batch ${i}: ${err instanceof Error ? err.message : String(err)}`,
      });
      return i;
    }
    send({ type: 'progress', name: e.type, processed: Math.min(i + batchSize, total), total });
  }
  send({ type: 'done', name: e.type, inserted: total, elapsedMs: Date.now() - start });
  return total;
}

/* ------------------------------------------------------------------ */
/*  Derived edges                                                      */
/* ------------------------------------------------------------------ */

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Build derived edge rows (without writing to Neptune).
 * Returned shape is fed into `execDerivedEdges`, but is also usable by the
 * `/api/derived/preview` endpoint which only needs counts / samples.
 *
 * For O(N²) kinds (haversine, jaccard), callers pass a sampleLimit so the
 * preview route can cap work on large vertex sets.
 */
export type DerivedPairRow = { a: string; b: string; support: number; note?: string };
export type DerivedPairResult = {
  rows: DerivedPairRow[];
  direction: '-' | '->';
  vertexLabel: string; // without suffix
  supportProp: string;
  warnings: string[];
  estimated?: boolean;
};

export function collectDerivedPairs(
  d: DerivedMapping,
  vertexMap: Map<string, VertexMapping>,
  opts: { sampleLimit?: number } = {},
): DerivedPairResult {
  const warnings: string[] = [];

  if (d.kind === 'attraction_co_occurrence') {
    const { table, group_by, pair_column, support_min } = d.params;
    const rows = select<Row>(
      `SELECT "${group_by}" AS grp, "${pair_column}" AS item FROM "${table}" WHERE "${pair_column}" IS NOT NULL`,
    );
    const pairMap = new Map<string, number>();
    const groups = new Map<string, Set<string>>();
    for (const r of rows) {
      const g = String(r.grp);
      if (!groups.has(g)) groups.set(g, new Set());
      groups.get(g)!.add(String(r.item));
    }
    for (const set of groups.values()) {
      const arr = [...set].sort();
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const k = `${arr[i]}|${arr[j]}`;
          pairMap.set(k, (pairMap.get(k) ?? 0) + 1);
        }
      }
    }
    const out = [...pairMap.entries()]
      .filter(([, s]) => s >= support_min)
      .map(([k, support]) => {
        const [a, b] = k.split('|');
        return { a, b, support };
      });
    return { rows: out, direction: '-', vertexLabel: 'Attraction', supportProp: 'support', warnings };
  }

  if (d.kind === 'attraction_sequence') {
    const { table, partition_by, order_by, item_column, support_min } = d.params;
    const orderCols = [...partition_by, order_by].map((c) => `"${c}"`).join(', ');
    const rows = select<Row>(
      `SELECT * FROM "${table}" WHERE "${item_column}" IS NOT NULL ORDER BY ${orderCols}`,
    );
    const partitionKey = (r: Row) => partition_by.map((p) => String(r[p])).join('|');
    const parts = new Map<string, Array<{ id: string; ord: number }>>();
    for (const r of rows) {
      const key = partitionKey(r);
      if (!parts.has(key)) parts.set(key, []);
      parts.get(key)!.push({ id: String(r[item_column]), ord: Number(r[order_by]) });
    }
    const seq = new Map<string, number>();
    for (const arr of parts.values()) {
      arr.sort((x, y) => x.ord - y.ord);
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (arr[i].id === arr[j].id) continue;
          const k = `${arr[i].id}|${arr[j].id}`;
          seq.set(k, (seq.get(k) ?? 0) + 1);
        }
      }
    }
    const out = [...seq.entries()]
      .filter(([, s]) => s >= support_min)
      .map(([k, support]) => {
        const [a, b] = k.split('|');
        return { a, b, support };
      });
    return { rows: out, direction: '->', vertexLabel: 'Attraction', supportProp: 'support', warnings };
  }

  if (d.kind === 'haversine') {
    const { vertex, lat_prop, lng_prop, threshold_km } = d.params;
    const vm = vertexMap.get(vertex);
    if (!vm) {
      warnings.push(`vertex ${vertex} not found`);
      return { rows: [], direction: '-', vertexLabel: vertex, supportProp: 'distanceKm', warnings };
    }
    const all: Array<{ id: string; lat: number; lng: number }> = [];
    for (const row of iterRows(vm.from.table, vm.from.where, { distinct: vm.from.distinct })) {
      const id = evalExpression(vm.id, row, {});
      const lat = row[lat_prop];
      const lng = row[lng_prop];
      if (id == null || lat == null || lng == null) continue;
      all.push({ id: String(id), lat: Number(lat), lng: Number(lng) });
    }
    let subset = all;
    let estimated = false;
    const sampleLimit = opts.sampleLimit ?? 0;
    if (sampleLimit > 0 && all.length > sampleLimit) {
      subset = all.slice().sort(() => Math.random() - 0.5).slice(0, sampleLimit);
      estimated = true;
      warnings.push(
        `총 ${all.length}개 중 ${sampleLimit}개만 샘플링해 추정했습니다.`,
      );
    }
    const out: Array<DerivedPairRow> = [];
    for (let i = 0; i < subset.length; i++) {
      for (let j = i + 1; j < subset.length; j++) {
        const km = haversineKm(subset[i].lat, subset[i].lng, subset[j].lat, subset[j].lng);
        if (km <= threshold_km) {
          out.push({
            a: subset[i].id,
            b: subset[j].id,
            support: Math.round(km * 10) / 10,
          });
        }
      }
    }
    // scale back up if sampled
    const finalRows = estimated
      ? (() => {
          const ratio = (all.length / subset.length) ** 2;
          const scaled = Math.round(out.length * ratio);
          // return the sample rows as-is; preview API only cares about count + estimated.
          return { sampled: out, scaledCount: scaled };
        })()
      : null;
    return {
      rows: finalRows ? finalRows.sampled : out,
      direction: '-',
      vertexLabel: vertex,
      supportProp: 'distanceKm',
      warnings,
      estimated,
    };
  }

  if (d.kind === 'list_co_occurrence') {
    const { table, list_column, separator, support_min } = d.params;
    const rows = select<Row>(`SELECT "${list_column}" AS list FROM "${table}"`);
    const pairMap = new Map<string, number>();
    for (const r of rows) {
      const parts = String(r.list ?? '')
        .split(separator)
        .map((s) => s.trim())
        .filter(Boolean);
      const uniq = [...new Set(parts)].sort();
      for (let i = 0; i < uniq.length; i++) {
        for (let j = i + 1; j < uniq.length; j++) {
          const k = `${uniq[i]}|${uniq[j]}`;
          pairMap.set(k, (pairMap.get(k) ?? 0) + 1);
        }
      }
    }
    const out = [...pairMap.entries()]
      .filter(([, s]) => s >= support_min)
      .map(([k, support]) => {
        const [a, b] = k.split('|');
        return { a, b, support };
      });
    return { rows: out, direction: '-', vertexLabel: 'City', supportProp: 'support', warnings };
  }

  if (d.kind === 'jaccard_similarity') {
    const {
      vertex,
      table,
      id_column,
      tokens_column,
      item_source,
      separator,
      min_overlap,
      min_jaccard,
    } = d.params;
    const rawRows = select<Row>(
      `SELECT "${id_column}" AS id, "${tokens_column}" AS toks FROM "${table}" WHERE "${tokens_column}" IS NOT NULL`,
    );
    const items: Array<{ id: string; set: Set<string> }> = [];
    let nullish = 0;
    for (const r of rawRows) {
      const raw = r.toks;
      let tokens: string[] = [];
      if (item_source === 'explode_json') {
        try {
          const parsed = JSON.parse(String(raw ?? '[]'));
          if (Array.isArray(parsed)) tokens = parsed.map((x) => String(x).trim()).filter(Boolean);
        } catch {
          nullish++;
          continue;
        }
      } else {
        tokens = String(raw ?? '')
          .split(separator ?? ',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (tokens.length === 0) {
        nullish++;
        continue;
      }
      items.push({ id: String(r.id), set: new Set(tokens) });
    }
    if (rawRows.length > 0 && nullish / rawRows.length > 0.95) {
      warnings.push(`토큰 컬럼 "${tokens_column}"이 대부분 비어 있습니다 (${nullish}/${rawRows.length}).`);
    }
    // O(N²) with optional sampling
    let subset = items;
    let estimated = false;
    const sampleLimit = opts.sampleLimit ?? 0;
    if (sampleLimit > 0 && items.length > sampleLimit) {
      subset = items.slice().sort(() => Math.random() - 0.5).slice(0, sampleLimit);
      estimated = true;
      warnings.push(`총 ${items.length}개 중 ${sampleLimit}개만 샘플링해 추정했습니다.`);
    }
    const out: DerivedPairRow[] = [];
    for (let i = 0; i < subset.length; i++) {
      for (let j = i + 1; j < subset.length; j++) {
        const A = subset[i].set;
        const B = subset[j].set;
        let inter = 0;
        for (const t of A) if (B.has(t)) inter++;
        if (inter < min_overlap) continue;
        const jac = inter / (A.size + B.size - inter);
        if (jac < min_jaccard) continue;
        out.push({ a: subset[i].id, b: subset[j].id, support: Math.round(jac * 1000) / 1000 });
      }
    }
    void vertex; // used only via vertexLabel below
    return {
      rows: out,
      direction: '-',
      vertexLabel: vertex,
      supportProp: 'jaccard',
      warnings,
      estimated,
    };
  }

  if (d.kind === 'declared_fact') {
    const { vertex, pairs, directed } = d.params;
    const seen = new Set<string>();
    const out: DerivedPairRow[] = [];
    for (const p of pairs) {
      const a = String(p.a ?? '').trim();
      const b = String(p.b ?? '').trim();
      if (!a || !b || a === b) continue;
      const key = directed ? `${a}|${b}` : [a, b].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b, support: 1, note: p.note });
    }
    if (out.length === 0) warnings.push('유효한 쌍이 없습니다.');
    return {
      rows: out,
      direction: directed ? '->' : '-',
      vertexLabel: vertex,
      supportProp: 'support',
      warnings,
    };
  }

  if (d.kind === 'city_cluster') {
    const { vertex, cluster_name, members } = d.params;
    if (members.length < 2) {
      warnings.push('도시를 2개 이상 선택해야 합니다.');
      return { rows: [], direction: '-', vertexLabel: vertex, supportProp: 'support', warnings };
    }
    if (members.length > 15) {
      warnings.push(`회원 도시가 ${members.length}개로 많아 엣지 수가 ${(members.length * (members.length - 1)) / 2}개로 폭증합니다.`);
    }
    const seen = new Set<string>();
    const out: DerivedPairRow[] = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = [members[i], members[j]].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ a: members[i], b: members[j], support: 1, note: cluster_name });
      }
    }
    return { rows: out, direction: '-', vertexLabel: vertex, supportProp: 'support', warnings };
  }

  warnings.push(`unknown kind: ${(d as { kind: string }).kind}`);
  return { rows: [], direction: '-', vertexLabel: 'Unknown', supportProp: 'support', warnings };
}

async function loadDerived(
  slot: 'A' | 'B' | 'C',
  d: DerivedMapping,
  vertexMap: Map<string, VertexMapping>,
  send: (e: ExecEvent) => void,
  batchSize: number,
): Promise<number> {
  const suffix = SLOT_SUFFIX(slot);
  const type = `${d.type}${suffix}`;

  const result = collectDerivedPairs(d, vertexMap);
  for (const w of result.warnings) {
    send({ type: 'error', name: d.type, message: w });
  }

  // declared_fact carries optional `note` per row — bundle it into support column
  // for simplicity; Neptune adapter stores the given supportProp value.
  const vertexLabelWithSuffix = `${result.vertexLabel}${suffix}`;
  const extraProps = result.rows.some((r) => r.note !== undefined);
  if (extraProps) {
    // Store `note` as an additional edge property in a per-row dict.
    return execDerivedEdgesWithNotes(
      d.type,
      type,
      vertexLabelWithSuffix,
      result.rows,
      result.direction,
      send,
      batchSize,
      result.supportProp,
    );
  }
  return execDerivedEdges(
    d.type,
    type,
    vertexLabelWithSuffix,
    result.rows.map((r) => ({ a: r.a, b: r.b, support: r.support })),
    result.direction,
    send,
    batchSize,
    result.supportProp,
  );
}


async function execDerivedEdges(
  label: string,
  typeWithSuffix: string,
  vertexLabelWithSuffix: string,
  rows: Array<{ a: string; b: string; support: number }>,
  direction: '-' | '->',
  send: (e: ExecEvent) => void,
  batchSize: number,
  supportProp = 'support',
): Promise<number> {
  const total = rows.length;
  send({ type: 'step', name: label, note: `${total} rows` });
  if (total === 0) {
    send({ type: 'done', name: label, inserted: 0, elapsedMs: 0 });
    return 0;
  }
  const merge =
    direction === '->'
      ? `MERGE (s)-[rel:\`${typeWithSuffix}\`]->(t)`
      : `MERGE (s)-[rel:\`${typeWithSuffix}\`]-(t)`;
  const start = Date.now();
  for (let i = 0; i < total; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const cypher = `
      UNWIND $batch AS r
      MATCH (s:\`${vertexLabelWithSuffix}\` {_id: r.a})
      MATCH (t:\`${vertexLabelWithSuffix}\` {_id: r.b})
      ${merge}
      SET rel.${supportProp} = r.support
    `;
    try {
      await runOpenCypher(cypher, { batch });
    } catch (err) {
      send({
        type: 'error',
        name: label,
        message: `batch ${i}: ${err instanceof Error ? err.message : String(err)}`,
      });
      return i;
    }
    send({ type: 'progress', name: label, processed: Math.min(i + batchSize, total), total });
  }
  send({ type: 'done', name: label, inserted: total, elapsedMs: Date.now() - start });
  return total;
}

/**
 * Variant of execDerivedEdges that also stores a per-row `note` property.
 * Used by declared_fact / city_cluster which carry a textual label.
 */
async function execDerivedEdgesWithNotes(
  label: string,
  typeWithSuffix: string,
  vertexLabelWithSuffix: string,
  rows: Array<{ a: string; b: string; support: number; note?: string }>,
  direction: '-' | '->',
  send: (e: ExecEvent) => void,
  batchSize: number,
  supportProp: string,
): Promise<number> {
  const total = rows.length;
  send({ type: 'step', name: label, note: `${total} rows` });
  if (total === 0) {
    send({ type: 'done', name: label, inserted: 0, elapsedMs: 0 });
    return 0;
  }
  const merge =
    direction === '->'
      ? `MERGE (s)-[rel:\`${typeWithSuffix}\`]->(t)`
      : `MERGE (s)-[rel:\`${typeWithSuffix}\`]-(t)`;
  const start = Date.now();
  for (let i = 0; i < total; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map((r) => ({
      a: r.a,
      b: r.b,
      support: r.support,
      note: r.note ?? '',
    }));
    const cypher = `
      UNWIND $batch AS r
      MATCH (s:\`${vertexLabelWithSuffix}\` {_id: r.a})
      MATCH (t:\`${vertexLabelWithSuffix}\` {_id: r.b})
      ${merge}
      SET rel.${supportProp} = r.support, rel.note = r.note
    `;
    try {
      await runOpenCypher(cypher, { batch });
    } catch (err) {
      send({
        type: 'error',
        name: label,
        message: `batch ${i}: ${err instanceof Error ? err.message : String(err)}`,
      });
      return i;
    }
    send({ type: 'progress', name: label, processed: Math.min(i + batchSize, total), total });
  }
  send({ type: 'done', name: label, inserted: total, elapsedMs: Date.now() - start });
  return total;
}

/* ------------------------------------------------------------------ */
/*  Reset & orchestrator                                               */
/* ------------------------------------------------------------------ */

export async function resetSlot(slot: 'A' | 'B' | 'C', send: (e: ExecEvent) => void): Promise<void> {
  send({ type: 'step', name: 'reset', note: `DETACH DELETE all nodes in slot ${slot}` });
  const start = Date.now();
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Neptune openCypher: match any node, filter by label ending with __slot via labels()[0]
      const r = await runOpenCypher(
        `MATCH (n) WHERE labels(n)[0] ENDS WITH '__${slot}' WITH n LIMIT 5000 DETACH DELETE n RETURN count(*) AS deleted`,
      );
      const deleted = (r.rows[0]?.[0] as number | undefined) ?? 0;
      if (deleted === 0) break;
      send({ type: 'progress', name: 'reset', processed: deleted, total: deleted });
    }
    send({ type: 'done', name: 'reset', inserted: 0, elapsedMs: Date.now() - start });
  } catch (e) {
    send({ type: 'error', name: 'reset', message: e instanceof Error ? e.message : String(e) });
  }
}

export async function executeMapping(
  cfg: MappingConfig,
  send: (e: ExecEvent) => void,
  opts: { reset?: boolean } = {},
): Promise<void> {
  getDb(); // warm sqlite connection
  const batchSize = cfg.options?.batch_size ?? 100;
  const overallStart = Date.now();
  let vertexCount = 0;
  let edgeCount = 0;

  try {
    if (opts.reset) {
      await resetSlot(cfg.slot, send);
    }

    const vertexMap = new Map<string, VertexMapping>();
    for (const v of cfg.vertices) {
      vertexMap.set(v.label, v);
      const n = await loadVertex(cfg.slot, v, send, batchSize);
      vertexCount += n;
    }

    for (const e of cfg.edges ?? []) {
      const n = await loadEdge(cfg.slot, e, vertexMap, send, batchSize);
      edgeCount += n;
    }

    for (const d of cfg.derived ?? []) {
      const n = await loadDerived(cfg.slot, d, vertexMap, send, batchSize);
      edgeCount += n;
    }

    send({ type: 'finished', totalMs: Date.now() - overallStart, vertexCount, edgeCount });
  } catch (e) {
    send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
