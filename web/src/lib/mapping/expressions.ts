/**
 * Evaluate limited expressions used in mapping YAML `id` and `properties` fields.
 * Supported:
 *   - plain column name: returns row[col]
 *   - $item: returns the exploded item
 *   - string concat with +: 'Label:' + col1 + ':' + col2
 *   - IS NOT NULL / != '' boolean: col IS NOT NULL AND col != ''
 *   - expr:func(...) — reserved for registered helpers
 *   - CAST(col AS DOUBLE)
 */

const FUNC_REGISTRY: Record<string, (...args: unknown[]) => unknown> = {
  time_band: (order: unknown, total: unknown) => {
    const o = Number(order);
    const t = Math.max(1, Number(total));
    const pos = (o - 0.5) / t;
    if (pos < 0.34) return 'MORNING';
    if (pos < 0.67) return 'AFTERNOON';
    return 'EVENING';
  },
  theme_label_ko: (code: unknown) => {
    const map: Record<string, string> = {
      HISTORY: '역사',
      LANDMARK: '랜드마크',
      CULTURE: '문화',
      NATURE: '자연',
      SHOPPING: '쇼핑',
      RELIGIOUS: '종교',
      VIEWPOINT: '전망',
      PHOTO_SPOT: '포토스팟',
      WATERFRONT: '해안',
      FOOD: '미식',
      THEMEPARK: '테마파크',
      WELLNESS: '힐링',
    };
    return map[String(code)] ?? String(code);
  },
  onsen_from_desc: (desc: unknown, nearBy: unknown, name: unknown) => {
    const s = [desc, nearBy, name]
      .map((x) => (x == null ? '' : String(x)))
      .join(' ')
      .toLowerCase();
    return /(onsen|hot\s*spring|温泉|온천)/.test(s);
  },
  city_code_from_address: (d1: unknown, d2: unknown) => {
    const merged = [d1, d2].filter(Boolean).join(' ').toLowerCase();
    if (merged.includes('kyoto')) return 'UKY';
    if (merged.includes('kobe') || merged.includes('hyogo')) return 'UKB';
    if (merged.includes('nara')) return 'ARN';
    if (merged.includes('wakayama')) return 'QKY';
    if (merged.includes('shirahama')) return 'SHM';
    if (merged.includes('izumisano')) return 'CR8';
    if (merged.includes('kushimoto')) return 'AQ0';
    if (merged.includes('uji')) return 'HH8';
    if (merged.includes('osaka')) return 'OSA';
    return null;
  },
};

export function evalExpression(
  expr: string,
  row: Record<string, unknown>,
  context: { item?: unknown; dayCount?: number } = {},
): unknown {
  const trimmed = expr.trim();

  // expr:func(a, b)
  const funcMatch = /^expr:(\w+)\s*\((.*)\)$/s.exec(trimmed);
  if (funcMatch) {
    const [, name, argsRaw] = funcMatch;
    const fn = FUNC_REGISTRY[name];
    if (!fn) throw new Error(`unknown expr function: ${name}`);
    const args = splitArgs(argsRaw).map((a) => evalExpression(a, row, context));
    return fn(...args);
  }

  // CAST(col AS TYPE)
  const castMatch = /^CAST\s*\(\s*([A-Za-z_][\w]*)\s+AS\s+(\w+)\s*\)$/i.exec(trimmed);
  if (castMatch) {
    const [, col, type] = castMatch;
    const v = row[col];
    if (v == null || v === '') return null;
    if (/DOUBLE|FLOAT|REAL/i.test(type)) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (/INT/i.test(type)) {
      const n = parseInt(String(v), 10);
      return Number.isFinite(n) ? n : null;
    }
    return String(v);
  }

  // IS NOT NULL / != ''  boolean expression
  if (/IS\s+NOT\s+NULL/i.test(trimmed) || /!=\s*['"]['"]/.test(trimmed)) {
    return evalBooleanExpr(trimmed, row);
  }

  // Quoted literal
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }

  // $item
  if (trimmed === '$item') return context.item;

  // String concat:  'A' + col + ':' + col2
  if (trimmed.includes('+')) {
    return splitByPlus(trimmed)
      .map((part) => {
        const v = evalExpression(part, row, context);
        return v == null ? '' : String(v);
      })
      .join('');
  }

  // Plain column
  if (/^[A-Za-z_][\w]*$/.test(trimmed)) {
    return row[trimmed];
  }

  // Bare number
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }

  throw new Error(`cannot evaluate expression: ${expr}`);
}

function evalBooleanExpr(expr: string, row: Record<string, unknown>): boolean {
  // Very limited: conjunctions of simple clauses separated by AND
  const clauses = expr.split(/\s+AND\s+/i);
  return clauses.every((c) => evalClause(c.trim(), row));
}

function evalClause(clause: string, row: Record<string, unknown>): boolean {
  let m = /^([A-Za-z_][\w]*)\s+IS\s+NOT\s+NULL$/i.exec(clause);
  if (m) return row[m[1]] != null;
  m = /^([A-Za-z_][\w]*)\s+IS\s+NULL$/i.exec(clause);
  if (m) return row[m[1]] == null;
  m = /^([A-Za-z_][\w]*)\s*!=\s*['"]([^'"]*)['"]$/.exec(clause);
  if (m) return String(row[m[1]] ?? '') !== m[2];
  m = /^([A-Za-z_][\w]*)\s*=\s*['"]([^'"]*)['"]$/.exec(clause);
  if (m) return String(row[m[1]] ?? '') === m[2];
  throw new Error(`unsupported boolean clause: ${clause}`);
}

function splitByPlus(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  let inQuote: string | null = null;
  for (const ch of expr) {
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '+' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function splitArgs(argsRaw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  let inQuote: string | null = null;
  for (const ch of argsRaw) {
    if (inQuote) {
      buf += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

export function evalWhere(where: string | undefined, row: Record<string, unknown>): boolean {
  if (!where) return true;
  try {
    return Boolean(evalExpression(where, row));
  } catch {
    return evalBooleanExpr(where, row);
  }
}
