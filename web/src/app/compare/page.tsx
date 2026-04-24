'use client';

import { useEffect, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Table from '@cloudscape-design/components/table';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Checkbox from '@cloudscape-design/components/checkbox';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Popover from '@cloudscape-design/components/popover';
import {
  AXIS_META,
  AxisCard,
  ScorecardRadar,
} from '@/components/ScorecardAxes';

type SlotState = {
  slot: 'A' | 'B' | 'C';
  mappingName: string | null;
  stats: { vertexCount: number; edgeCount: number } | null;
};

type Scorecard = {
  axis1: number;
  axis2: number;
  axis3: number;
  axis4: number;
  axis5: number;
  axis6: number;
  total: number;
  details: Record<string, string>;
};

type QResult = {
  id: string;
  passed: boolean;
  stage: string;
  rowCount: number;
  elapsedMs: number;
  error?: string;
  preview?: unknown[];
};

type SlotRun = {
  slot: 'A' | 'B' | 'C';
  scorecard: Scorecard;
  results: QResult[];
};

type QuestionMeta = {
  id: string;
  title: string;
  naturalLanguage: string;
  tags: string[];
  cypher: string;
  planningRelevant: boolean;
  expected?: { rowCountRange?: [number, number] };
};

const CATEGORY_META: Record<string, { emoji: string; label: string }> = {
  geo: { emoji: '🌏', label: '지리' },
  discovery: { emoji: '🔍', label: '탐색' },
  filter: { emoji: '🔎', label: '필터' },
  fact: { emoji: '📋', label: '사실' },
  lookup: { emoji: '📎', label: '조회' },
  stats: { emoji: '📊', label: '통계' },
  planning: { emoji: '🎯', label: '기획' },
  template: { emoji: '🧩', label: '템플릿' },
  comparison: { emoji: '⚖️', label: '비교' },
  internal_diagnostic: { emoji: '🧪', label: '내부진단' },
  reverse: { emoji: '⟲', label: '역탐색' },
  constraint: { emoji: '⛓', label: '제약' },
  combo: { emoji: '🔗', label: '조합' },
  counterfactual: { emoji: '❗', label: '반증' },
  tag: { emoji: '🏷', label: '태그' },
  trend: { emoji: '📈', label: '트렌드' },
};

function TagChip({ tag }: { tag: string }) {
  const meta = CATEGORY_META[tag];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 10,
        background: '#eef1f3',
        fontSize: 11,
        marginRight: 4,
      }}
    >
      {meta ? `${meta.emoji} ${meta.label}` : tag}
    </span>
  );
}

function QuestionHeaderCell({
  meta,
  expectedRange,
}: {
  meta?: QuestionMeta;
  expectedRange?: string;
}) {
  if (!meta) return null;
  return (
    <SpaceBetween size="xxs">
      <Box fontSize="body-s">
        <b>{meta.title}</b>
      </Box>
      <Box fontSize="body-s" color="text-status-inactive">
        &ldquo;{meta.naturalLanguage}&rdquo;
      </Box>
      <div>
        {meta.tags.map((t) => (
          <TagChip key={t} tag={t} />
        ))}
        {expectedRange && (
          <span style={{ fontSize: 11, color: '#555', marginLeft: 4 }}>
            기대 행 수: {expectedRange}
          </span>
        )}
        {meta.planningRelevant && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 8,
              background: '#d4edda',
              color: '#0f5132',
              marginLeft: 4,
            }}
          >
            기획용 ★
          </span>
        )}
      </div>
    </SpaceBetween>
  );
}

function CypherBlock({ cypher }: { cypher: string }) {
  return (
    <ExpandableSection headerText="실행 Cypher" variant="footer" defaultExpanded={false}>
      <pre
        style={{
          fontSize: 11,
          margin: 0,
          background: '#272b33',
          color: '#f8f8f2',
          padding: '8px 10px',
          borderRadius: 6,
          overflowX: 'auto',
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
        }}
      >
        {cypher}
      </pre>
    </ExpandableSection>
  );
}


export default function ComparePage() {
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [runs, setRuns] = useState<Record<string, SlotRun>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedSlots, setSelectedSlots] = useState<Set<'A' | 'B' | 'C'>>(new Set());
  const [questions, setQuestions] = useState<Record<string, QuestionMeta>>({});

  useEffect(() => {
    fetch('/api/slot/status')
      .then((r) => r.json())
      .then((d) => {
        setSlots(d.slots ?? []);
        const active = (d.slots ?? []).filter((s: SlotState) => s.stats !== null);
        setSelectedSlots(new Set(active.map((s: SlotState) => s.slot)));
      });
    fetch('/api/questionnaire/list')
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, QuestionMeta> = {};
        for (const q of d.questions ?? []) map[q.id] = q;
        setQuestions(map);
      });
  }, []);

  async function runOne(slot: 'A' | 'B' | 'C') {
    setBusy((b) => ({ ...b, [slot]: true }));
    setError(null);
    try {
      const res = await fetch('/api/questionnaire/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `slot ${slot} failed`);
      setRuns((r) => ({ ...r, [slot]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy((b) => ({ ...b, [slot]: false }));
    }
  }

  async function runSelected() {
    for (const s of selectedSlots) {
      await runOne(s);
    }
  }

  const activeSlots = slots.filter((s) => s.stats !== null);
  const runSlotIds = (['A', 'B', 'C'] as const).filter((id) => runs[id]);
  const allQs: string[] = runSlotIds[0] ? runs[runSlotIds[0]]!.results.map((r) => r.id) : [];
  const isMulti = runSlotIds.length >= 2;
  const busyAny = Object.values(busy).some(Boolean);
  const noneSelected = selectedSlots.size === 0;

  // baseline: highest total when multi
  const baselineSlot = isMulti
    ? runSlotIds.reduce((acc, cur) =>
        runs[cur]!.scorecard.total > (runs[acc]?.scorecard.total ?? 0) ? cur : acc,
      )
    : null;

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={
            isMulti
              ? '여러 슬롯의 6축 스코어와 질문별 결과를 나란히 비교'
              : '선택한 슬롯에 16개 질문지를 실행하고 6축 스코어를 확인'
          }
          actions={
            <Button
              variant="primary"
              onClick={runSelected}
              loading={busyAny}
              disabled={noneSelected}
            >
              ▶ 선택한 슬롯 실행 ({selectedSlots.size})
            </Button>
          }
        >
          Comparison Dashboard
        </Header>
      }
    >
      <SpaceBetween size="l">
        {activeSlots.length === 0 && (
          <Alert type="info">먼저 최소 한 슬롯에 매핑을 적재하세요.</Alert>
        )}
        {error && <Alert type="error">{error}</Alert>}

        {activeSlots.length > 0 && (
          <Container header={<Header variant="h2">슬롯 선택</Header>}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.min(activeSlots.length, 3)}, 1fr)`,
                gap: 12,
              }}
            >
              {activeSlots.map((s) => {
                const checked = selectedSlots.has(s.slot);
                const run = runs[s.slot];
                return (
                  <Container
                    key={s.slot}
                    header={
                      <Header
                        variant="h3"
                        actions={
                          <Button
                            variant="normal"
                            iconName="caret-right-filled"
                            loading={busy[s.slot]}
                            onClick={() => runOne(s.slot)}
                          >
                            실행
                          </Button>
                        }
                      >
                        <Checkbox
                          checked={checked}
                          onChange={({ detail }) => {
                            setSelectedSlots((prev) => {
                              const next = new Set(prev);
                              if (detail.checked) next.add(s.slot);
                              else next.delete(s.slot);
                              return next;
                            });
                          }}
                        >
                          Slot {s.slot}
                        </Checkbox>
                      </Header>
                    }
                  >
                    <SpaceBetween size="xs">
                      <Box>
                        <b>{s.mappingName ?? '-'}</b>
                      </Box>
                      <Box fontSize="body-s" color="text-status-inactive">
                        Vertex {s.stats!.vertexCount} · Edge {s.stats!.edgeCount}
                      </Box>
                      {run && (
                        <Box fontSize="body-s">
                          <StatusIndicator
                            type={
                              run.scorecard.total >= 80
                                ? 'success'
                                : run.scorecard.total >= 50
                                ? 'warning'
                                : 'error'
                            }
                          >
                            총점 {run.scorecard.total} ·{' '}
                            {run.results.filter((r) => r.passed).length}/{run.results.length} 통과
                          </StatusIndicator>
                        </Box>
                      )}
                    </SpaceBetween>
                  </Container>
                );
              })}
            </div>
          </Container>
        )}

        {/* ───────── 단일 슬롯 상세 뷰 ───────── */}
        {runSlotIds.length === 1 && (
          <SingleSlotDetail run={runs[runSlotIds[0]]!} questions={questions} />
        )}

        {/* ───────── 다중 슬롯 비교 뷰 ───────── */}
        {isMulti && (
          <MultiCompare
            runSlotIds={runSlotIds}
            runs={runs}
            allQs={allQs}
            baselineSlot={baselineSlot}
            questions={questions}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}

// ─────────────────────────────────────────────────────────
// Single slot detail
// ─────────────────────────────────────────────────────────
function SingleSlotDetail({
  run,
  questions,
}: {
  run: SlotRun;
  questions: Record<string, QuestionMeta>;
}) {
  const passed = run.results.filter((r) => r.passed).length;
  const total = run.results.length;
  const passRate = total === 0 ? 0 : (passed / total) * 100;
  const avgMs =
    run.results.length > 0
      ? Math.round(
          run.results.reduce((acc, r) => acc + r.elapsedMs, 0) / run.results.length,
        )
      : 0;

  return (
    <SpaceBetween size="l">
      <Container
        header={<Header variant="h2">Slot {run.slot} · 6축 스코어</Header>}
      >
        <SpaceBetween size="m">
          <div
            style={{
              display: 'flex',
              gap: 16,
              alignItems: 'baseline',
              padding: '8px 0',
            }}
          >
            <div
              style={{
                fontSize: 48,
                fontWeight: 'bold',
                color:
                  run.scorecard.total >= 80
                    ? '#1d8102'
                    : run.scorecard.total >= 50
                    ? '#b25000'
                    : '#d91515',
              }}
            >
              {run.scorecard.total}
            </div>
            <Box color="text-status-inactive">총점 · {passed}/{total} 통과 · 평균 {avgMs}ms</Box>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {AXIS_META.map((a) => (
              <AxisCard
                key={a.key}
                meta={a}
                score={run.scorecard[a.key] as number}
                detail={run.scorecard.details[a.key]}
              />
            ))}
          </div>
        </SpaceBetween>
      </Container>

      <Container
        header={
          <Header
            variant="h2"
            counter={`(${passed}/${total} 통과 · ${Math.round(passRate)}%)`}
          >
            질문지 결과
          </Header>
        }
      >
        <Table
          variant="embedded"
          items={run.results}
          wrapLines
          columnDefinitions={[
            {
              id: 'id',
              header: 'Q',
              width: 60,
              cell: (r) => <b>{r.id}</b>,
            },
            {
              id: 'question',
              header: '질문',
              minWidth: 320,
              cell: (r) => {
                const meta = questions[r.id];
                if (!meta)
                  return <Box color="text-status-inactive">{r.id}</Box>;
                const range = meta.expected?.rowCountRange
                  ? `${meta.expected.rowCountRange[0]}~${meta.expected.rowCountRange[1]}`
                  : undefined;
                return (
                  <SpaceBetween size="xxs">
                    <QuestionHeaderCell meta={meta} expectedRange={range} />
                    <CypherBlock cypher={meta.cypher} />
                  </SpaceBetween>
                );
              },
            },
            {
              id: 'status',
              header: 'Status',
              width: 140,
              cell: (r) => {
                if (r.passed) return <StatusIndicator type="success">pass</StatusIndicator>;
                if (r.stage === 'execute_error')
                  return <StatusIndicator type="error">error</StatusIndicator>;
                return <StatusIndicator type="warning">fail</StatusIndicator>;
              },
            },
            {
              id: 'rows',
              header: 'Rows',
              width: 80,
              cell: (r) => <span style={{ fontFamily: 'monospace' }}>{r.rowCount}</span>,
            },
            {
              id: 'ms',
              header: 'Time',
              width: 80,
              cell: (r) => <span style={{ fontFamily: 'monospace' }}>{r.elapsedMs}ms</span>,
            },
            {
              id: 'preview',
              header: 'Preview',
              minWidth: 220,
              cell: (r) =>
                r.error ? (
                  <Box color="text-status-error" fontSize="body-s">
                    {r.error.slice(0, 200)}
                  </Box>
                ) : r.preview && r.preview.length > 0 ? (
                  <ExpandableSection
                    headerText={`${r.preview.length} row preview`}
                    variant="inline"
                  >
                    <pre
                      style={{
                        fontSize: 11,
                        margin: 0,
                        maxHeight: 140,
                        overflow: 'auto',
                        background: '#f8f9fa',
                        padding: 6,
                        borderRadius: 4,
                      }}
                    >
                      {JSON.stringify(r.preview, null, 2)}
                    </pre>
                  </ExpandableSection>
                ) : (
                  <Box color="text-status-inactive" fontSize="body-s">
                    —
                  </Box>
                ),
            },
          ]}
        />
      </Container>
    </SpaceBetween>
  );
}

// ─────────────────────────────────────────────────────────
// Multi-slot compare
// ─────────────────────────────────────────────────────────
function MultiCompare({
  runSlotIds,
  runs,
  allQs,
  baselineSlot,
  questions,
}: {
  runSlotIds: Array<'A' | 'B' | 'C'>;
  runs: Record<string, SlotRun>;
  allQs: string[];
  baselineSlot: 'A' | 'B' | 'C' | null;
  questions: Record<string, QuestionMeta>;
}) {
  const radarSlots = runSlotIds.map((sid) => ({
    slot: sid,
    scorecard: runs[sid]!.scorecard,
  }));

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">6축 스코어카드 (나란히)</Header>}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(360px, 400px) 1fr',
            gap: 24,
            alignItems: 'start',
          }}
        >
          <div>
            <ScorecardRadar slots={radarSlots} size={380} />
            <Box
              textAlign="center"
              fontSize="body-s"
              color="text-status-inactive"
              padding="xs"
            >
              면적이 클수록 모든 축에서 고르게 높은 매핑
            </Box>
          </div>
          <Table
            variant="embedded"
            items={AXIS_META}
            columnDefinitions={[
              {
                id: 'axis',
                header: 'Axis',
                width: 220,
                cell: (a) => (
                  <Popover
                    dismissButton={false}
                    position="right"
                    size="large"
                    triggerType="custom"
                    header={a.label}
                    content={
                      <SpaceBetween size="s">
                        <Box variant="p">{a.what}</Box>
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
                              {a.formula}
                            </code>
                          </Box>
                        </Box>
                        <Box>
                          <Box variant="awsui-key-label">점수대 해석</Box>
                          <Box fontSize="body-s">{a.interpretation}</Box>
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
                      {a.label} ⓘ
                    </span>
                  </Popover>
                ),
              },
              ...runSlotIds.map((sid) => ({
                id: sid,
                header: `Slot ${sid}`,
                cell: (a: (typeof AXIS_META)[number]) => {
                  const score = runs[sid]?.scorecard[a.key] as
                    | number
                    | undefined;
                  const detail = runs[sid]?.scorecard.details?.[a.key];
                  const isBaseline = sid === baselineSlot;
                  return (
                    <SpaceBetween size="xxs">
                      <Box
                        fontSize="heading-m"
                        fontWeight="bold"
                        color={isBaseline ? 'text-status-success' : 'inherit'}
                      >
                        {score ?? '-'}
                        {isBaseline ? ' ★' : ''}
                      </Box>
                      <Box fontSize="body-s" color="text-status-inactive">
                        {detail ?? ''}
                      </Box>
                    </SpaceBetween>
                  );
                },
              })),
            ]}
          />
        </div>
        <Box padding="m">
          <KeyValuePairs
            columns={runSlotIds.length}
            items={runSlotIds.map((sid) => ({
              label: `Slot ${sid} — Total${sid === baselineSlot ? ' (★ baseline)' : ''}`,
              value: String(runs[sid]?.scorecard.total ?? '-'),
            }))}
          />
        </Box>
      </Container>

      <Container header={<Header variant="h2">질문지 결과</Header>}>
        <Table
          variant="embedded"
          items={allQs.map((qid) => ({ id: qid }))}
          wrapLines
          columnDefinitions={[
            {
              id: 'qid',
              header: 'Q',
              width: 60,
              cell: (q) => <b>{q.id}</b>,
            },
            {
              id: 'question',
              header: '질문',
              minWidth: 320,
              cell: (q: { id: string }) => {
                const meta = questions[q.id];
                if (!meta)
                  return <Box color="text-status-inactive">{q.id}</Box>;
                const range = meta.expected?.rowCountRange
                  ? `${meta.expected.rowCountRange[0]}~${meta.expected.rowCountRange[1]}`
                  : undefined;
                return (
                  <SpaceBetween size="xxs">
                    <QuestionHeaderCell meta={meta} expectedRange={range} />
                    <CypherBlock cypher={meta.cypher} />
                  </SpaceBetween>
                );
              },
            },
            ...runSlotIds.map((sid) => ({
              id: sid,
              header: `Slot ${sid}`,
              width: 180,
              cell: (q: { id: string }) => {
                const r = runs[sid]?.results.find((x) => x.id === q.id);
                if (!r) return '-';
                return r.passed ? (
                  <StatusIndicator type="success">
                    pass · {r.rowCount}행 · {r.elapsedMs}ms
                  </StatusIndicator>
                ) : r.stage === 'execute_error' ? (
                  <StatusIndicator type="error">error</StatusIndicator>
                ) : (
                  <StatusIndicator type="warning">fail · {r.rowCount}행</StatusIndicator>
                );
              },
            })),
          ]}
        />
      </Container>
    </SpaceBetween>
  );
}
