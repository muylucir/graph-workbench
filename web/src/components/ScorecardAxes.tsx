'use client';

import Box from '@cloudscape-design/components/box';
import Popover from '@cloudscape-design/components/popover';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import SpaceBetween from '@cloudscape-design/components/space-between';

export type Scorecard = {
  axis1: number;
  axis2: number;
  axis3: number;
  axis4: number;
  axis5: number;
  axis6: number;
  total: number;
  details: Record<string, string>;
};

type AxisKey = 'axis1' | 'axis2' | 'axis3' | 'axis4' | 'axis5' | 'axis6';

type AxisMeta = {
  key: AxisKey;
  label: string;
  short: string;
  what: string;
  formula: string;
  interpretation: string;
};

export const AXIS_META: AxisMeta[] = [
  {
    key: 'axis1',
    label: '축 1 · 입력 제약',
    short: '입력',
    what: '매핑이 원천 RDB의 11개 테이블 중 몇 개를 활용하는가. 커버리지가 낮으면 그래프에 정보 자체가 부재해 LLM이 답할 수 없는 질문이 많아진다.',
    formula: '(사용 테이블 수 / 11) × 100',
    interpretation: '80+ 원천을 거의 다 활용 · 50~79 절반 이상 · 50 미만 부분 커버(정보 부재로 실패 질의가 많아질 가능성).',
  },
  {
    key: 'axis2',
    label: '축 2 · L3 변환',
    short: '변환',
    what: 'L1(RDB)→L3(그래프) 변환의 구조적 풍부함. vertex·edge 종류 수와 파생 엣지 개수로 측정. 같은 테이블이라도 얼마나 잘게 분리해 관계로 표현했는가.',
    formula: '(v/15)×40 + (e/20)×40 + min(d,5)×4 · 상한 100',
    interpretation: '80+ 다층 구조(Phase1급) · 40~79 중간 · 40 미만 Flat에 가까움.',
  },
  {
    key: 'axis3',
    label: '축 3 · LLM 편의성',
    short: 'LLM',
    what: '16개 질문지 중 몇 개를 Cypher로 답할 수 있는가(rowCount 범위 통과). LLM 입장에서 질의 가능한 스키마인지를 가장 직접적으로 측정.',
    formula: '(통과 질문 수 / 전체 질문 수) × 100',
    interpretation: '80+ 거의 모든 질문 대응 · 50~79 절반 · 50 미만 많은 질문이 실패(보통 관계·파생 부족).',
  },
  {
    key: 'axis4',
    label: '축 4 · 추론 지원',
    short: '추론',
    what: '단순 조회를 넘어 파생 관계(CO_VISITED / SEQUENCE / HAVERSINE)가 있어 "비슷한 여행지", "근처 도시" 같은 추론 질의가 가능한가.',
    formula: 'CO_VISITED:30 + SEQUENCE:20 + HAVERSINE:15 + (Q01·07·09·16 통과/4)×35',
    interpretation: '70+ 파생 3종 + 추론 질의 통과 · 40~69 파생 일부 · 40 미만 파생 없음(GraphRAG 강점 없음).',
  },
  {
    key: 'axis5',
    label: '축 5 · 상품 기획',
    short: '기획',
    what: '상품기획에 직접 쓰이는 질문(planningRelevant=true)만 집계. 최종 유즈케이스인 상품 기획 관점의 실용도.',
    formula: '(기획 관련 통과 / 기획 관련 전체) × 100',
    interpretation: '이 축은 상품 기획 유즈케이스 대비 매핑의 즉시 활용도를 의미. 80+가 시연의 핵심 숫자.',
  },
  {
    key: 'axis6',
    label: '축 6 · 운영 비용',
    short: '운영',
    what: '그래프 크기(엣지 수)와 평균 질의 응답 시간의 부담. 같은 품질이면 더 작고 빠른 쪽이 운영상 유리.',
    formula: '100 − min(30, edgeCount×0.008) − min(30, avgMs×0.05)',
    interpretation: '80+ 가볍고 빠름 · 50~79 중간 · 50 미만 엣지 폭증 또는 응답 지연(최적화 여지).',
  },
];

function scoreColor(score: number): string {
  if (score >= 80) return '#1d8102';
  if (score >= 50) return '#b25000';
  return '#d91515';
}

export function AxisCard({
  meta,
  score,
  detail,
}: {
  meta: AxisMeta;
  score: number;
  detail?: string;
}) {
  return (
    <div
      style={{
        border: '1px solid #e9ebed',
        borderRadius: 8,
        padding: 12,
        background: 'white',
      }}
    >
      <SpaceBetween size="xxs">
        <Box>
          <Popover
            dismissButton={false}
            position="top"
            size="large"
            triggerType="custom"
            header={meta.label}
            content={
              <SpaceBetween size="s">
                <Box variant="p">{meta.what}</Box>
                <Box>
                  <Box variant="awsui-key-label">공식</Box>
                  <Box fontSize="body-s">
                    <code
                      style={{
                        background: '#f4f4f4',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 12,
                      }}
                    >
                      {meta.formula}
                    </code>
                  </Box>
                </Box>
                <Box>
                  <Box variant="awsui-key-label">현재 값</Box>
                  <Box fontSize="body-s">{detail ?? '-'}</Box>
                </Box>
                <Box>
                  <Box variant="awsui-key-label">점수대 해석</Box>
                  <Box fontSize="body-s">{meta.interpretation}</Box>
                </Box>
              </SpaceBetween>
            }
          >
            <span
              style={{
                fontWeight: 'bold',
                cursor: 'help',
                borderBottom: '1px dotted #888',
              }}
            >
              {meta.label} ⓘ
            </span>
          </Popover>
        </Box>
        <Box>
          <span
            style={{
              fontSize: 28,
              fontWeight: 'bold',
              color: scoreColor(score),
            }}
          >
            {score}
          </span>
        </Box>
        <ProgressBar value={score} />
        <Box fontSize="body-s" color="text-status-inactive">
          {detail ?? ''}
        </Box>
      </SpaceBetween>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Radar chart (SVG, no dependency)
// ─────────────────────────────────────────────────────────
const SLOT_COLORS: Record<'A' | 'B' | 'C', string> = {
  A: '#0972d3',
  B: '#1d8102',
  C: '#9b59b6',
};

export function ScorecardRadar({
  slots,
  size = 360,
}: {
  slots: Array<{ slot: 'A' | 'B' | 'C'; scorecard: Scorecard }>;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 60;
  const axes = AXIS_META;
  const n = axes.length;

  const anglesRad = axes.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / n);

  function point(value: number, i: number): [number, number] {
    const r = (Math.max(0, Math.min(100, value)) / 100) * radius;
    return [cx + r * Math.cos(anglesRad[i]), cy + r * Math.sin(anglesRad[i])];
  }

  function labelPoint(i: number): [number, number] {
    const r = radius + 28;
    return [cx + r * Math.cos(anglesRad[i]), cy + r * Math.sin(anglesRad[i])];
  }

  const rings = [20, 40, 60, 80, 100];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="6축 스코어카드 레이더 차트"
      >
        {rings.map((v) => {
          const pts = axes
            .map((_, i) => point(v, i))
            .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join(' ');
          return (
            <polygon
              key={v}
              points={pts}
              fill="none"
              stroke="#d5dbdb"
              strokeWidth={v === 100 ? 1.2 : 0.6}
              strokeDasharray={v === 100 ? '0' : '2 3'}
            />
          );
        })}

        {axes.map((_, i) => {
          const [x, y] = point(100, i);
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="#d5dbdb"
              strokeWidth={0.6}
            />
          );
        })}

        {slots.map(({ slot, scorecard }) => {
          const color = SLOT_COLORS[slot];
          const pts = axes
            .map((a, i) => point(scorecard[a.key] as number, i))
            .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
            .join(' ');
          return (
            <g key={slot}>
              <polygon
                points={pts}
                fill={color}
                fillOpacity={0.14}
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
              />
              {axes.map((a, i) => {
                const v = scorecard[a.key] as number;
                const [x, y] = point(v, i);
                return (
                  <circle key={a.key} cx={x} cy={y} r={3} fill={color} />
                );
              })}
            </g>
          );
        })}

        {axes.map((a, i) => {
          const [lx, ly] = labelPoint(i);
          const anchor =
            Math.abs(lx - cx) < 4 ? 'middle' : lx > cx ? 'start' : 'end';
          return (
            <g key={a.key}>
              <text
                x={lx}
                y={ly}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={12}
                fontWeight={600}
                fill="#16191f"
              >
                {a.short}
              </text>
              <text
                x={lx}
                y={ly + 14}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={10}
                fill="#687078"
              >
                {a.label.split(' · ')[1] ?? ''}
              </text>
            </g>
          );
        })}

        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fontSize={10}
          fill="#aab7b8"
        >
          0
        </text>
      </svg>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
        {slots.map(({ slot, scorecard }) => (
          <div
            key={slot}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: 2,
                background: SLOT_COLORS[slot],
              }}
            />
            <span style={{ fontSize: 13 }}>
              Slot {slot} · 총점 <b>{scorecard.total}</b>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
