import type { MappingConfig } from '../mapping/types';
import type { QResult, Question } from '../questionnaire/runner';

export type Scorecard = {
  axis1: number; // 입력 제약
  axis2: number; // L3 변환
  axis3: number; // LLM 편의성
  axis4: number; // 추론 지원
  axis5: number; // 상품 기획 도움
  axis6: number; // 운영 비용
  total: number;
  details: Record<string, string>;
};

export function calculateScorecard(
  cfg: MappingConfig,
  questions: Question[],
  results: QResult[],
  stats: { vertexCount: number; edgeCount: number; avgMs: number } | null,
): Scorecard {
  const tableUsed = new Set<string>();
  cfg.vertices.forEach((v) => tableUsed.add(v.from.table));
  cfg.edges?.forEach((e) => tableUsed.add(e.from.table));
  const totalTables = 11; // osaka_subset 고정
  const axis1 = Math.round((Math.min(tableUsed.size, totalTables) / totalTables) * 100);

  const derivedCount = cfg.derived?.length ?? 0;
  const vertexCount = cfg.vertices.length;
  const edgeCount = cfg.edges?.length ?? 0;
  const axis2 = Math.min(
    100,
    Math.round(
      (vertexCount / 15) * 40 + (edgeCount / 20) * 40 + Math.min(derivedCount, 5) * 4,
    ),
  );

  const totalQs = results.length || 1;
  const passCount = results.filter((r) => r.passed).length;
  const axis3 = Math.round((passCount / totalQs) * 100);

  const hasCoVisited = cfg.derived?.some((d) => d.kind === 'attraction_co_occurrence') ?? false;
  const hasSequence = cfg.derived?.some((d) => d.kind === 'attraction_sequence') ?? false;
  const hasHaversine = cfg.derived?.some((d) => d.kind === 'haversine') ?? false;
  const derivedPass = results
    .filter((r) => ['Q01', 'Q07', 'Q09', 'Q16'].includes(r.id))
    .filter((r) => r.passed).length;
  const axis4 = Math.round(
    (hasCoVisited ? 30 : 0) +
      (hasSequence ? 20 : 0) +
      (hasHaversine ? 15 : 0) +
      (derivedPass / 4) * 35,
  );

  const planningQs = questions.filter((q) => q.planningRelevant);
  const planningIds = new Set(planningQs.map((q) => q.id));
  const planningResults = results.filter((r) => planningIds.has(r.id));
  const planningPass = planningResults.filter((r) => r.passed).length;
  const axis5 =
    planningResults.length === 0
      ? 0
      : Math.round((planningPass / planningResults.length) * 100);

  let axis6 = 100;
  if (stats) {
    const edgeBurden = Math.min(30, stats.edgeCount * 0.008);
    const timeBurden = Math.min(30, stats.avgMs * 0.05);
    axis6 = Math.max(0, Math.round(100 - edgeBurden - timeBurden));
  }

  const total = Math.round((axis1 + axis2 + axis3 + axis4 + axis5 + axis6) / 6);

  return {
    axis1,
    axis2,
    axis3,
    axis4,
    axis5,
    axis6,
    total,
    details: {
      axis1: `${tableUsed.size}/${totalTables} tables used`,
      axis2: `${vertexCount}v / ${edgeCount}e / ${derivedCount}d`,
      axis3: `${passCount}/${totalQs} questions passed`,
      axis4: `derived(${hasCoVisited ? 'CO' : '-'}${hasSequence ? '/SEQ' : ''}${hasHaversine ? '/HAV' : ''}) + Q pass ${derivedPass}/4`,
      axis5: `planning ${planningPass}/${planningResults.length}`,
      axis6: stats
        ? `${stats.vertexCount}v + ${stats.edgeCount}e, avg ${stats.avgMs}ms`
        : 'no stats',
    },
  };
}
