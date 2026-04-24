'use client';

import { useEffect, useMemo, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Checkbox from '@cloudscape-design/components/checkbox';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import Button from '@cloudscape-design/components/button';
import {
  QUESTIONS,
  COMPONENT_META,
  ALL_COMPONENT_IDS,
  computeRequiredComponents,
  whichQuestionsUseComponent,
  type ComponentId,
  type QuestionRequirement,
} from '@/lib/question-requirements';
import { buildYamlFromComponents } from '@/lib/yaml-builder';

function estimateMetricsLocal(comps: Set<ComponentId>) {
  let v = 5;
  if (comps.has('prefecture_vertex')) v++;
  if (comps.has('departure_market_vertex')) v++;
  if (comps.has('representative_split')) v++;
  if (comps.has('hotel_stay_vertex')) v++;
  if (comps.has('flight_segment_vertex')) v += 3;
  if (comps.has('theme_vertex')) v++;
  if (comps.has('mood_vertex')) v++;
  if (comps.has('season_vertex')) v++;

  let e = 5;
  if (comps.has('prefecture_vertex')) e++;
  if (comps.has('representative_split')) e++;
  if (comps.has('departure_market_vertex')) e++;
  if (comps.has('hotel_stay_vertex')) e += 2;
  if (comps.has('flight_segment_vertex')) e += 4;
  if (comps.has('theme_vertex')) e++;
  if (comps.has('mood_vertex')) e++;
  if (comps.has('season_vertex')) e++;

  let d = 0;
  if (comps.has('co_visited')) d++;
  if (comps.has('visited_after')) d++;
  if (comps.has('near_city')) d++;
  if (comps.has('often_cotraveled')) d++;

  return { vertex: v, edge: e, derived: d };
}

const CATEGORY_META: Record<
  string,
  { label: string; emoji: string; hint: string }
> = {
  discovery: { label: '탐색', emoji: '🔍', hint: 'MD가 "어떤 데이터가 있나" 찾는 질의' },
  fact: { label: '사실 조회', emoji: '📋', hint: '특정 레코드의 정확한 값 조회' },
  planning: {
    label: '상품 기획',
    emoji: '🎯',
    hint: '신상품 설계·레퍼런스 재사용·제약 검증 등 MD의 핵심 업무',
  },
  internal: { label: '분석 · 내부 진단', emoji: '🧪', hint: '그래프 자체 검증용, 사용자 질의는 아님' },
};

const ALL_CATEGORIES: Array<'discovery' | 'fact' | 'planning' | 'internal'> = [
  'discovery',
  'fact',
  'planning',
  'internal',
];

type Props = {
  slot: 'A' | 'B' | 'C';
  name: string;
  description: string;
  initialSelectedQuestions?: string[];
  initialCoSupport?: number;
  initialNearKm?: number;
  /** Incremented by parent whenever a preset is loaded. Triggers full state resync. */
  presetVersion?: number;
  onChange: (payload: {
    yaml: string;
    selectedQuestions: string[];
    components: ComponentId[];
  }) => void;
};

export default function QuestionDrivenEditor({
  slot,
  name,
  description,
  initialSelectedQuestions,
  initialCoSupport,
  initialNearKm,
  presetVersion,
  onChange,
}: Props) {
  const [nameState, setNameState] = useState(name);
  const [descState, setDescState] = useState(description);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedQuestions ?? []),
  );
  const [coSupport, setCoSupport] = useState<number>(initialCoSupport ?? 3);
  const [nearKm, setNearKm] = useState<number>(initialNearKm ?? 100);

  // When parent signals a new preset load, resync internal state from props.
  useEffect(() => {
    if (presetVersion == null) return;
    setNameState(name);
    setDescState(description);
    setSelected(new Set(initialSelectedQuestions ?? []));
    if (initialCoSupport != null) setCoSupport(initialCoSupport);
    if (initialNearKm != null) setNearKm(initialNearKm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetVersion]);

  const activeComponents = useMemo(
    () => computeRequiredComponents([...selected]),
    [selected],
  );
  const metrics = useMemo(() => estimateMetricsLocal(activeComponents), [activeComponents]);

  // Propagate up whenever anything changes
  useEffect(() => {
    const yaml = buildYamlFromComponents({
      name: nameState,
      description: descState,
      slot,
      components: activeComponents,
      coVisitedSupport: coSupport,
      nearCityKm: nearKm,
    });
    onChange({
      yaml,
      selectedQuestions: [...selected],
      components: [...activeComponents],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameState, descState, slot, selected, coSupport, nearKm]);

  function toggleQuestion(qid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid);
      else next.add(qid);
      return next;
    });
  }

  function selectAllInCategory(cat: string) {
    const ids = QUESTIONS.filter((q) => q.category === cat).map((q) => q.id);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  return (
    <SpaceBetween size="l">
      {/* ─────────── 기본 정보 ─────────── */}
      <Container header={<Header variant="h3">기본 정보</Header>}>
        <SpaceBetween size="s">
          <FormField label="스키마 이름">
            <Input value={nameState} onChange={({ detail }) => setNameState(detail.value)} />
          </FormField>
          <FormField label="설명">
            <Input value={descState} onChange={({ detail }) => setDescState(detail.value)} />
          </FormField>
        </SpaceBetween>
      </Container>

      {/* ─────────── 좌측 질문 · 우측 컴포넌트 ─────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
        {/* 좌측 */}
        <Container
          header={
            <Header
              variant="h3"
              description="이 슬롯으로 LLM 에이전트가 풀길 원하는 질의를 고르세요. 필요한 매핑 컴포넌트가 오른쪽에 자동으로 켜집니다."
              actions={
                <SpaceBetween direction="horizontal" size="xs">
                  <Button onClick={clearAll} disabled={selected.size === 0}>
                    전체 해제
                  </Button>
                </SpaceBetween>
              }
            >
              풀고 싶은 질의 ({selected.size}/{QUESTIONS.length})
            </Header>
          }
        >
          <SpaceBetween size="m">
            {ALL_CATEGORIES.map((cat) => {
              const qs = QUESTIONS.filter((q) => q.category === cat);
              const meta = CATEGORY_META[cat];
              const allSelected = qs.every((q) => selected.has(q.id));
              return (
                <Box key={cat}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <Box fontWeight="bold">
                      {meta.emoji} {meta.label}
                    </Box>
                    <Button
                      variant="inline-link"
                      onClick={() => selectAllInCategory(cat)}
                      disabled={allSelected}
                    >
                      모두 선택
                    </Button>
                  </div>
                  <Box fontSize="body-s" color="text-status-inactive" padding={{ bottom: 'xs' }}>
                    {meta.hint}
                  </Box>
                  <SpaceBetween size="xxs">
                    {qs.map((q) => {
                      const isSel = selected.has(q.id);
                      return (
                        <div
                          key={q.id}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 6,
                            background: isSel ? '#e8f4fd' : 'transparent',
                            borderLeft: isSel ? '3px solid #0972d3' : '3px solid transparent',
                          }}
                        >
                          <Checkbox
                            checked={isSel}
                            onChange={() => toggleQuestion(q.id)}
                          >
                            <b>{q.id}</b> · {q.title}
                          </Checkbox>
                          <Box
                            fontSize="body-s"
                            color="text-status-inactive"
                            padding={{ left: 'l' }}
                          >
                            {q.naturalLanguage}
                          </Box>
                          {isSel && q.requires.length > 0 && (
                            <Box padding={{ left: 'l', top: 'xxs' }}>
                              <div
                                style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
                              >
                                {q.requires.map((c) => (
                                  <span
                                    key={c}
                                    style={{
                                      fontSize: 11,
                                      padding: '2px 6px',
                                      borderRadius: 4,
                                      background: '#d1ecf7',
                                      color: '#033160',
                                    }}
                                  >
                                    +{COMPONENT_META[c].label}
                                  </span>
                                ))}
                              </div>
                            </Box>
                          )}
                          {isSel && q.requires.length === 0 && (
                            <Box
                              fontSize="body-s"
                              color="text-status-success"
                              padding={{ left: 'l' }}
                            >
                              ✓ 기본 매핑만으로 풀림
                            </Box>
                          )}
                        </div>
                      );
                    })}
                  </SpaceBetween>
                </Box>
              );
            })}
          </SpaceBetween>
        </Container>

        {/* 우측 */}
        <Container
          header={
            <Header
              variant="h3"
              description="왼쪽 질의 선택에 따라 자동으로 켜지는 매핑 컴포넌트. 수동 편집은 Expert 모드에서."
            >
              필요한 매핑 컴포넌트
            </Header>
          }
        >
          <SpaceBetween size="m">
            <Alert type="info">
              <b>Vertex {metrics.vertex}</b> · <b>Edge {metrics.edge}</b> ·{' '}
              <b>Derived {metrics.derived}</b>
              <br />
              <Box fontSize="body-s" color="text-status-inactive">
                기본 매핑(Country·City·SaleProduct·Attraction·Hotel + 기본 edge) 위에 아래가 추가됨
              </Box>
            </Alert>

            <SpaceBetween size="xxs">
              <Box fontWeight="bold">활성화된 컴포넌트 ({activeComponents.size})</Box>
              {activeComponents.size === 0 && (
                <Box color="text-status-inactive" padding={{ left: 's' }}>
                  (없음 — 기본 매핑만 사용)
                </Box>
              )}
              {[...activeComponents].map((c) => {
                const info = COMPONENT_META[c];
                const drivenBy = whichQuestionsUseComponent(c)
                  .filter((q) => selected.has(q.id))
                  .map((q) => q.id);
                return (
                  <div
                    key={c}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: '#f0f9ff',
                      borderLeft: '3px solid #16a34a',
                    }}
                  >
                    <div>
                      <StatusIndicator type="success" />
                      <b style={{ marginLeft: 4 }}>{info.label}</b>
                      <span
                        style={{
                          marginLeft: 6,
                          fontSize: 11,
                          color: '#6b7280',
                        }}
                      >
                        ({info.impact})
                      </span>
                    </div>
                    <Box fontSize="body-s" color="text-status-inactive" padding={{ left: 'l' }}>
                      {info.note}
                    </Box>
                    <Box fontSize="body-s" color="text-body-secondary" padding={{ left: 'l' }}>
                      ← {drivenBy.join(', ')}
                    </Box>
                  </div>
                );
              })}
            </SpaceBetween>

            <SpaceBetween size="xxs">
              <Box fontWeight="bold">비활성화된 컴포넌트 (관련 질의 선택 시 자동 활성화)</Box>
              {ALL_COMPONENT_IDS.filter((c) => !activeComponents.has(c)).map((c) => {
                const info = COMPONENT_META[c];
                const unlocks = whichQuestionsUseComponent(c).map((q) => q.id);
                return (
                  <div
                    key={c}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: '#fafafa',
                      borderLeft: '3px solid #d1d5db',
                      opacity: 0.85,
                    }}
                  >
                    <div>
                      <StatusIndicator type="stopped" />
                      <span style={{ marginLeft: 4, color: '#6b7280' }}>
                        {info.label}{' '}
                        <span style={{ fontSize: 11 }}>({info.impact})</span>
                      </span>
                    </div>
                    {unlocks.length > 0 && (
                      <Box fontSize="body-s" color="text-body-secondary" padding={{ left: 'l' }}>
                        이걸 켜면 열리는 질의: <b>{unlocks.join(', ')}</b>
                      </Box>
                    )}
                  </div>
                );
              })}
            </SpaceBetween>

            {(activeComponents.has('co_visited') || activeComponents.has('visited_after')) && (
              <FormField label="공동방문 support threshold">
                <Input
                  type="number"
                  value={String(coSupport)}
                  onChange={({ detail }) => setCoSupport(Number(detail.value) || 3)}
                />
              </FormField>
            )}
            {activeComponents.has('near_city') && (
              <FormField label="NEAR_CITY 거리 (km)">
                <Input
                  type="number"
                  value={String(nearKm)}
                  onChange={({ detail }) => setNearKm(Number(detail.value) || 100)}
                />
              </FormField>
            )}
          </SpaceBetween>
        </Container>
      </div>
    </SpaceBetween>
  );
}

export function qsToComponentIds(selectedIds: string[]): ComponentId[] {
  return [...computeRequiredComponents(selectedIds)];
}

export function questionsFromComponents(components: ComponentId[]): string[] {
  // Reverse inference: find questions whose requirements are all present
  const componentSet = new Set(components);
  return QUESTIONS.filter((q) =>
    q.requires.length === 0 ? false : q.requires.every((r) => componentSet.has(r)),
  ).map((q) => q.id);
}

export const ALL_QUESTIONS: QuestionRequirement[] = QUESTIONS;
