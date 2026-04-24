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

export async function runQuestion(q: Question, slot: SlotId): Promise<QResult> {
  const cypher = injectSuffix(q.cypher, slot);
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
