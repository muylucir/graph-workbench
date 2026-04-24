import { parse as parseYaml } from 'yaml';
import type { MappingConfig } from './types';

export function parseMapping(yamlText: string): MappingConfig {
  const doc = parseYaml(yamlText);
  if (!doc || typeof doc !== 'object') {
    throw new Error('Empty or invalid YAML');
  }
  return doc as MappingConfig;
}

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function validateMapping(
  cfg: MappingConfig,
  tableInfo: Array<{ name: string; columns: Array<{ name: string }> }>,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!cfg.name) errors.push('name is required');
  if (!cfg.slot || !['A', 'B', 'C'].includes(cfg.slot)) {
    errors.push('slot must be one of A, B, C');
  }
  if (!Array.isArray(cfg.vertices) || cfg.vertices.length === 0) {
    errors.push('vertices must be a non-empty array');
  }
  if (!Array.isArray(cfg.edges)) cfg.edges = [];

  const tableMap = new Map(tableInfo.map((t) => [t.name, new Set(t.columns.map((c) => c.name))]));

  // Validate vertices
  const vertexLabels = new Set<string>();
  for (const v of cfg.vertices ?? []) {
    if (!v.label) errors.push('vertex: label missing');
    if (vertexLabels.has(v.label)) errors.push(`vertex: duplicate label ${v.label}`);
    vertexLabels.add(v.label);

    const table = v.from?.table;
    if (!table) {
      errors.push(`vertex ${v.label}: from.table missing`);
      continue;
    }
    if (!tableMap.has(table)) {
      errors.push(`vertex ${v.label}: table '${table}' not found in SQLite`);
      continue;
    }
    const cols = tableMap.get(table)!;
    // lightweight column existence check for `properties`
    for (const [, expr] of Object.entries(v.properties ?? {})) {
      const colCandidate = expr.trim();
      if (/^[A-Za-z_][\w]*$/.test(colCandidate) && !cols.has(colCandidate) && colCandidate !== '$item') {
        warnings.push(`vertex ${v.label}: property refers to unknown column '${colCandidate}' in ${table}`);
      }
    }
    if (v.from.explode_json && !cols.has(v.from.explode_json)) {
      errors.push(`vertex ${v.label}: explode_json '${v.from.explode_json}' not in ${table}`);
    }
    if (v.from.explode_csv && !cols.has(v.from.explode_csv)) {
      errors.push(`vertex ${v.label}: explode_csv '${v.from.explode_csv}' not in ${table}`);
    }
  }

  // Validate edges
  for (const e of cfg.edges ?? []) {
    if (!e.type) errors.push('edge: type missing');
    if (!vertexLabels.has(e.source?.vertex)) {
      errors.push(`edge ${e.type}: source vertex '${e.source?.vertex}' not defined`);
    }
    if (!vertexLabels.has(e.target?.vertex)) {
      errors.push(`edge ${e.type}: target vertex '${e.target?.vertex}' not defined`);
    }
    if (e.from?.table && !tableMap.has(e.from.table)) {
      errors.push(`edge ${e.type}: table '${e.from.table}' not found`);
    }
  }

  // Derived
  for (const d of cfg.derived ?? []) {
    if (!d.type || !d.kind) {
      errors.push('derived: type or kind missing');
      continue;
    }
    if (d.kind === 'jaccard_similarity') {
      const p = d.params;
      if (!p?.vertex || !p?.table || !p?.tokens_column) {
        errors.push(`derived ${d.type}: jaccard_similarity requires vertex, table, tokens_column`);
      }
      if (typeof p?.min_jaccard !== 'number') {
        warnings.push(`derived ${d.type}: min_jaccard missing, defaulting to 0.3`);
      }
    } else if (d.kind === 'declared_fact') {
      const p = d.params;
      if (!Array.isArray(p?.pairs)) {
        errors.push(`derived ${d.type}: declared_fact requires pairs array`);
      }
    } else if (d.kind === 'city_cluster') {
      const p = d.params;
      if (!Array.isArray(p?.members) || p.members.length < 2) {
        errors.push(`derived ${d.type}: city_cluster requires members array with >= 2 items`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
