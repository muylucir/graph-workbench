/**
 * Label suffix injection for schema slot isolation.
 *
 * We run multiple schemas (A, B, C) on the same Neptune cluster by
 * suffixing every vertex label and edge type with __A / __B / __C.
 *
 * User writes plain Cypher: MATCH (a:Attraction)-[:ATTRACTION_IN_CITY]->(c:City)
 * System rewrites to:       MATCH (a:Attraction__B)-[:ATTRACTION_IN_CITY__B]->(c:City__B)
 */

export type SlotId = 'A' | 'B' | 'C';

// Node labels: ":Foo" or ":Foo|Bar"  → ":Foo__X" etc. (preceded by `(`, `,`, `|`, `:`, `]`, space)
// Relationship types: "[:FOO]" or "[r:FOO]" or "[r:FOO|BAR*1..3]"
//
// Strategy: rewrite the two common positions explicitly rather than
// do full Cypher AST parsing (too heavy for V0.5).

// Node labels inside `(...)` or `()<-[...]->(...)` patterns.
// Match `:Label` after an identifier or `(`, followed by end, space, `{`, `)`, `|`, `,`.
// Skip when preceded by `{` (property key like `{_id: ...}`) or by `"`/`'`.
const LABEL_RE = /([(,|]\s*[A-Za-z_]?[\w]*)(:)([A-Za-z_][\w]*)(?=\s*[){|,]|\s*$)/g;
// Relationship types inside `[...]`:  [r:FOO], [:FOO], [:FOO|BAR]
const REL_TYPE_RE = /\[\s*([A-Za-z_][\w]*\s*)?:(\s*!?\s*)([A-Za-z_][\w|]*)/g;
// [r:FOO] or [:FOO] or [:FOO|BAR]; variable-length [*1..3] stays intact

/**
 * Inject slot suffix into a Cypher query.
 * Idempotent-ish: if a label already has __<slot>, we don't double-append.
 */
export function injectSuffix(query: string, slot: SlotId): string {
  const suf = `__${slot}`;

  // Skip injection inside string literals. Quick split approach.
  // Splits by ' or " while preserving delimiters.
  const parts = query.split(/(['"][^'"]*['"])/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // inside quotes — leave alone
      let out = part;
      // Rewrite relationship type first (narrower pattern)
      out = out.replace(REL_TYPE_RE, (_m, maybeVar, neg, typesRaw) => {
        const types = typesRaw
          .split('|')
          .map((t: string) => (t.endsWith(suf) ? t : `${t}${suf}`))
          .join('|');
        return `[${maybeVar ?? ''}:${neg}${types}`;
      });
      // Then node labels. Handle chained labels like `:Foo:Bar` by running in loop.
      for (let pass = 0; pass < 3; pass++) {
        const before = out;
        out = out.replace(LABEL_RE, (_match, prefix, colon, label) => {
          if (label.endsWith(suf)) return `${prefix}${colon}${label}`;
          return `${prefix}${colon}${label}${suf}`;
        });
        if (out === before) break;
      }
      return out;
    })
    .join('');
}

/** Strip any __A/__B/__C suffix; used for display. */
export function stripSuffix(label: string): string {
  return label.replace(/__[ABC]$/, '');
}

/** Return labels/types that belong to a given slot by scanning a list. */
export function filterBySlot<T extends { label: string }>(items: T[], slot: SlotId): T[] {
  const suf = `__${slot}`;
  return items.filter((x) => x.label.endsWith(suf));
}
