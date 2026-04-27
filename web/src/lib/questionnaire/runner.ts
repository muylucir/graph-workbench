import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { runOpenCypher } from '../neptune/client';
import { injectSuffix, type SlotId } from '../neptune/suffix';

export type Question = {
  id: string;
  title: string;
  naturalLanguage: string;
  tags: string[];
  cypher: string;
  expected: {
    rowCountRange?: [number, number];
    mustContain?: string[];
  };
  planningRelevant: boolean;
};

const LAB_ROOT = process.env.GRAPH_LAB_ROOT ?? '/home/ec2-user/project/travel-graph-lab';

let cache: Question[] | null = null;
export function loadQuestions(): Question[] {
  if (cache) return cache;
  const p = path.join(LAB_ROOT, 'questionnaire', 'v2.json');
  const raw = fs.readFileSync(p, 'utf-8');
  cache = JSON.parse(raw).questions;
  return cache!;
}

export type QResult = {
  id: string;
  passed: boolean;
  stage: 'ok' | 'execute_error' | 'validation_fail';
  rowCount: number;
  elapsedMs: number;
  error?: string;
  preview?: unknown[];
};

/**
 * Rewrite common LLM mistakes that Neptune's openCypher rejects.
 * Neptune's `round()` takes exactly one argument — `round(x, N)` (Neo4j-style)
 * must be expanded to `round(x * 10^N) / 10^N`.
 */
export function sanitizeCypher(src: string): string {
  // round(expr, N) → (round((expr) * 10^N) / 10^N). We match balanced parens
  // for the first arg using a small hand-rolled scanner, since regex alone
  // cannot handle nested parens robustly.
  let out = '';
  let i = 0;
  while (i < src.length) {
    const head = src.slice(i, i + 6).toLowerCase();
    if (head !== 'round(') {
      out += src[i++];
      continue;
    }
    // find matching ')'
    let depth = 1;
    let j = i + 6;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth !== 0) {
      out += src.slice(i);
      break;
    }
    const inner = src.slice(i + 6, j);
    // split inner on top-level comma
    const parts = splitTopLevelComma(inner);
    if (parts.length === 2) {
      const expr = parts[0].trim();
      const n = Number(parts[1].trim());
      if (Number.isFinite(n) && n >= 0 && n <= 6) {
        const scale = Math.pow(10, n);
        out += `(round((${expr}) * ${scale}) / ${scale})`;
        i = j + 1;
        continue;
      }
    }
    // no rewrite — pass through as-is
    out += src.slice(i, j + 1);
    i = j + 1;
  }
  return out;
}

function splitTopLevelComma(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, k));
      start = k + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

export async function runQuestion(q: Question, slot: SlotId): Promise<QResult> {
  const cypher = injectSuffix(sanitizeCypher(q.cypher), slot);
  const start = Date.now();
  try {
    const r = await runOpenCypher(cypher);
    const rowCount = r.rows.length;
    const elapsedMs = Date.now() - start;
    const [lo, hi] = q.expected.rowCountRange ?? [0, Number.POSITIVE_INFINITY];
    const passed = rowCount >= lo && rowCount <= hi;
    return {
      id: q.id,
      passed,
      stage: passed ? 'ok' : 'validation_fail',
      rowCount,
      elapsedMs,
      preview: r.rows.slice(0, 3),
    };
  } catch (e) {
    return {
      id: q.id,
      passed: false,
      stage: 'execute_error',
      rowCount: 0,
      elapsedMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runAllQuestions(slot: SlotId): Promise<QResult[]> {
  const qs = loadQuestions();
  const results: QResult[] = [];
  for (const q of qs) {
    results.push(await runQuestion(q, slot));
  }
  return results;
}
