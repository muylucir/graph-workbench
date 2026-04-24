'use client';

import { useEffect, useMemo, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Input from '@cloudscape-design/components/input';
import Textarea from '@cloudscape-design/components/textarea';
import FormField from '@cloudscape-design/components/form-field';
import Toggle from '@cloudscape-design/components/toggle';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Modal from '@cloudscape-design/components/modal';
import Popover from '@cloudscape-design/components/popover';
import Tabs from '@cloudscape-design/components/tabs';
import Spinner from '@cloudscape-design/components/spinner';

type SlotId = 'A' | 'B' | 'C';

type CustomQuestion = {
  id: string;
  title: string;
  naturalLanguage: string;
  tags: string[];
  cypher: string;
  expected: { rowCountRange?: [number, number] };
  planningRelevant: boolean;
  updatedAt: number;
};

type QResult = {
  id: string;
  passed: boolean;
  stage: 'ok' | 'execute_error' | 'validation_fail';
  rowCount: number;
  elapsedMs: number;
  error?: string;
  preview?: unknown[];
};

type SlotState = {
  slot: SlotId;
  mappingName: string | null;
  stats: { vertexCount: number; edgeCount: number } | null;
};

const STORAGE_KEY = 'travel-graph-lab/custom-questions/v1';

function genId(): string {
  return `CQ_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function emptyQuestion(): CustomQuestion {
  return {
    id: genId(),
    title: '',
    naturalLanguage: '',
    tags: ['custom'],
    cypher: '',
    expected: { rowCountRange: [1, 100] },
    planningRelevant: false,
    updatedAt: Date.now(),
  };
}

function loadLocal(): CustomQuestion[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { questions?: CustomQuestion[] };
    return parsed.questions ?? [];
  } catch {
    return [];
  }
}

function saveLocal(questions: CustomQuestion[]) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 'v1', questions }),
  );
}

export default function QuestionnairePage() {
  const [questions, setQuestions] = useState<CustomQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomQuestion | null>(null);
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<SlotId>('A');
  const [results, setResults] = useState<Record<string, QResult | undefined>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [editorTab, setEditorTab] = useState<'nl' | 'expert'>('nl');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [lastRationale, setLastRationale] = useState<string | null>(null);

  useEffect(() => {
    const qs = loadLocal();
    setQuestions(qs);
    if (qs.length > 0) {
      setSelectedId(qs[0].id);
      setDraft(qs[0]);
    }
    fetch('/api/slot/status')
      .then((r) => r.json())
      .then((d) => {
        const ss = (d.slots ?? []) as SlotState[];
        setSlots(ss);
        const firstActive = ss.find((s) => s.stats !== null);
        if (firstActive) setSelectedSlot(firstActive.slot);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (questions.length === 0) return;
    saveLocal(questions);
  }, [questions]);

  const active = questions.find((q) => q.id === selectedId) ?? null;
  const dirty =
    draft !== null &&
    active !== null &&
    JSON.stringify(draft) !== JSON.stringify(active);
  const isNewDraft = draft !== null && !questions.some((q) => q.id === draft.id);

  function selectQuestion(q: CustomQuestion) {
    if (dirty && !confirm('수정 중인 내용이 있습니다. 버리고 이동할까요?')) return;
    setSelectedId(q.id);
    setDraft(q);
  }

  function newQuestion() {
    if (dirty && !confirm('수정 중인 내용이 있습니다. 버리고 새로 만들까요?')) return;
    const q = emptyQuestion();
    setDraft(q);
    setSelectedId(q.id);
  }

  function saveDraft() {
    if (!draft) return;
    if (!draft.title.trim() || !draft.cypher.trim()) {
      setError('제목과 Cypher는 필수입니다.');
      return;
    }
    const next: CustomQuestion = { ...draft, updatedAt: Date.now() };
    setQuestions((prev) => {
      const exists = prev.some((q) => q.id === next.id);
      if (exists) return prev.map((q) => (q.id === next.id ? next : q));
      return [...prev, next];
    });
    setDraft(next);
    setSelectedId(next.id);
    setError(null);
  }

  function deleteQuestion(id: string) {
    if (!confirm('이 질문을 삭제할까요?')) return;
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    setResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedId === id) {
      setSelectedId(null);
      setDraft(null);
    }
  }

  function duplicate(id: string) {
    const src = questions.find((q) => q.id === id);
    if (!src) return;
    const copy: CustomQuestion = {
      ...src,
      id: genId(),
      title: `${src.title} (copy)`,
      updatedAt: Date.now(),
    };
    setQuestions((prev) => [...prev, copy]);
    setSelectedId(copy.id);
    setDraft(copy);
  }

  async function validate(q: CustomQuestion) {
    setBusyId(q.id);
    setError(null);
    try {
      const res = await fetch('/api/questionnaire/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot: selectedSlot,
          question: {
            id: q.id,
            title: q.title,
            naturalLanguage: q.naturalLanguage,
            tags: q.tags,
            cypher: q.cypher,
            expected: q.expected,
            planningRelevant: q.planningRelevant,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResults((prev) => ({ ...prev, [q.id]: data.result as QResult }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function validateAll() {
    for (const q of questions) {
      await validate(q);
    }
  }

  async function suggestCypher(alsoValidate: boolean) {
    if (!draft) return;
    const nl = draft.naturalLanguage.trim();
    if (!nl) {
      setSuggestError('자연어 설명을 먼저 입력하세요.');
      return;
    }
    setSuggesting(true);
    setSuggestError(null);
    setLastRationale(null);
    try {
      const res = await fetch('/api/questionnaire/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: selectedSlot, naturalLanguage: nl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const s = data.suggestion as {
        cypher: string;
        rationale?: string;
        expectedMin?: number;
        expectedMax?: number;
      };
      const lo =
        typeof s.expectedMin === 'number'
          ? s.expectedMin
          : draft.expected.rowCountRange?.[0] ?? 1;
      const hi =
        typeof s.expectedMax === 'number'
          ? s.expectedMax
          : draft.expected.rowCountRange?.[1] ?? 100;
      const updated: CustomQuestion = {
        ...draft,
        cypher: s.cypher,
        title: draft.title || nl.slice(0, 40),
        expected: { ...draft.expected, rowCountRange: [lo, hi] },
      };
      setDraft(updated);
      setLastRationale(s.rationale ?? null);
      if (alsoValidate) {
        await validate(updated);
      }
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggesting(false);
    }
  }

  function exportJson() {
    const blob = new Blob(
      [JSON.stringify({ version: 'v1', questions }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom-questions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson() {
    try {
      const parsed = JSON.parse(importText) as { questions?: CustomQuestion[] };
      const incoming = parsed.questions ?? [];
      if (!Array.isArray(incoming)) throw new Error('questions 배열이 아닙니다');
      setQuestions((prev) => {
        const byId = new Map(prev.map((q) => [q.id, q]));
        for (const q of incoming) {
          if (q && typeof q === 'object' && q.id && q.cypher) {
            byId.set(q.id, { ...q, updatedAt: Date.now() });
          }
        }
        return Array.from(byId.values());
      });
      setImportOpen(false);
      setImportText('');
      setError(null);
    } catch (e) {
      setError(`import 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const activeSlots = slots.filter((s) => s.stats !== null);
  const passCount = useMemo(
    () =>
      questions.reduce(
        (acc, q) => acc + (results[q.id]?.passed ? 1 : 0),
        0,
      ),
    [questions, results],
  );

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="개발자 전용 커스텀 질문 편집 및 검증. 로컬 브라우저에 저장됩니다(localStorage)."
          counter={
            questions.length > 0
              ? `(${passCount}/${questions.length} 통과)`
              : undefined
          }
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setImportOpen(true)}>Import</Button>
              <Button
                disabled={questions.length === 0}
                onClick={exportJson}
              >
                Export
              </Button>
              <Button
                disabled={questions.length === 0 || activeSlots.length === 0}
                loading={busyId !== null}
                onClick={validateAll}
              >
                ▶ 전체 검증
              </Button>
              <Button variant="primary" onClick={newQuestion}>
                + 새 질문
              </Button>
            </SpaceBetween>
          }
        >
          Custom Questionnaire
        </Header>
      }
    >
      <SpaceBetween size="l">
        {error && (
          <Alert type="error" dismissible onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}

        {activeSlots.length === 0 ? (
          <Alert type="warning">
            활성 슬롯이 없습니다. 먼저 한 슬롯에 매핑을 적재하세요.
          </Alert>
        ) : (
          <Container
            header={
              <Header variant="h3" description="검증을 실행할 대상 슬롯">
                검증 슬롯
              </Header>
            }
          >
            <SegmentedControl
              selectedId={selectedSlot}
              onChange={({ detail }) =>
                setSelectedSlot(detail.selectedId as SlotId)
              }
              options={activeSlots.map((s) => ({
                id: s.slot,
                text: `Slot ${s.slot} · ${s.mappingName ?? '-'}`,
              }))}
            />
          </Container>
        )}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 360px) 1fr',
            gap: 16,
            alignItems: 'start',
          }}
        >
          <Container
            header={
              <Header
                variant="h3"
                counter={`(${questions.length})`}
              >
                질문 목록
              </Header>
            }
          >
            {questions.length === 0 ? (
              <Box color="text-status-inactive" textAlign="center" padding="m">
                아직 질문이 없습니다. 우측에서 새 질문을 추가하세요.
              </Box>
            ) : (
              <SpaceBetween size="xs">
                {questions.map((q) => {
                  const res = results[q.id];
                  const isSelected = selectedId === q.id;
                  return (
                    <div
                      key={q.id}
                      onClick={() => selectQuestion(q)}
                      style={{
                        cursor: 'pointer',
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: `1px solid ${isSelected ? '#0972d3' : '#e9ebed'}`,
                        background: isSelected ? '#f2f8fd' : 'white',
                      }}
                    >
                      <SpaceBetween size="xxs">
                        <Box fontSize="body-s">
                          <b>{q.title || '(제목 없음)'}</b>
                        </Box>
                        <Box
                          fontSize="body-s"
                          color="text-status-inactive"
                        >
                          {q.naturalLanguage || '—'}
                        </Box>
                        {res ? (
                          res.passed ? (
                            <StatusIndicator type="success">
                              pass · {res.rowCount}행 · {res.elapsedMs}ms
                            </StatusIndicator>
                          ) : res.stage === 'execute_error' ? (
                            <StatusIndicator type="error">error</StatusIndicator>
                          ) : (
                            <StatusIndicator type="warning">
                              fail · {res.rowCount}행
                            </StatusIndicator>
                          )
                        ) : (
                          <Box
                            fontSize="body-s"
                            color="text-status-inactive"
                          >
                            미검증
                          </Box>
                        )}
                      </SpaceBetween>
                    </div>
                  );
                })}
              </SpaceBetween>
            )}
          </Container>

          <Container
            header={
              <Header
                variant="h3"
                actions={
                  draft && (
                    <SpaceBetween direction="horizontal" size="xs">
                      {!isNewDraft && (
                        <Button onClick={() => duplicate(draft.id)}>복제</Button>
                      )}
                      {!isNewDraft && (
                        <Button onClick={() => deleteQuestion(draft.id)}>
                          삭제
                        </Button>
                      )}
                      <Button
                        disabled={!dirty && !isNewDraft}
                        onClick={saveDraft}
                      >
                        저장
                      </Button>
                      <Button
                        variant="primary"
                        loading={busyId === draft.id}
                        disabled={
                          !draft.cypher.trim() || activeSlots.length === 0
                        }
                        onClick={() => validate(draft)}
                      >
                        ▶ 검증 (Slot {selectedSlot})
                      </Button>
                    </SpaceBetween>
                  )
                }
              >
                {draft ? (isNewDraft ? '새 질문' : '질문 편집') : '선택된 질문 없음'}
              </Header>
            }
          >
            {!draft ? (
              <Box color="text-status-inactive" textAlign="center" padding="m">
                좌측에서 질문을 선택하거나 <b>+ 새 질문</b>을 누르세요.
              </Box>
            ) : (
              <SpaceBetween size="m">
                <FormField
                  label="제목"
                  description="질문의 짧은 타이틀 (필수)"
                >
                  <Input
                    value={draft.title}
                    onChange={({ detail }) =>
                      setDraft({ ...draft, title: detail.value })
                    }
                    placeholder="예: 오사카 야간 명소 탐색"
                  />
                </FormField>

                <FormField
                  label="태그"
                  description="쉼표로 구분. 예: geo, discovery, custom"
                >
                  <Input
                    value={draft.tags.join(', ')}
                    onChange={({ detail }) =>
                      setDraft({
                        ...draft,
                        tags: detail.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </FormField>

                <Tabs
                  activeTabId={editorTab}
                  onChange={({ detail }) =>
                    setEditorTab(detail.activeTabId as 'nl' | 'expert')
                  }
                  tabs={[
                    {
                      id: 'nl',
                      label: '자연어 (쉬움)',
                      content: (
                        <SpaceBetween size="m">
                          <FormField
                            label="자연어 질문"
                            description="한국어로 묻고 싶은 내용을 그대로 쓰세요. 현재 슬롯 스키마를 기반으로 LLM이 Cypher를 생성합니다."
                          >
                            <Textarea
                              rows={3}
                              value={draft.naturalLanguage}
                              onChange={({ detail }) =>
                                setDraft({
                                  ...draft,
                                  naturalLanguage: detail.value,
                                })
                              }
                              placeholder="예: 오사카에서 저녁 이후 방문하기 좋은 관광지는?"
                            />
                          </FormField>

                          <SpaceBetween direction="horizontal" size="xs">
                            <Button
                              loading={suggesting}
                              disabled={
                                !draft.naturalLanguage.trim() ||
                                activeSlots.length === 0
                              }
                              onClick={() => suggestCypher(false)}
                            >
                              Cypher 생성
                            </Button>
                            <Button
                              variant="primary"
                              loading={suggesting || busyId === draft.id}
                              disabled={
                                !draft.naturalLanguage.trim() ||
                                activeSlots.length === 0
                              }
                              onClick={() => suggestCypher(true)}
                            >
                              생성 & 검증 (Slot {selectedSlot})
                            </Button>
                            <Box
                              color="text-status-inactive"
                              fontSize="body-s"
                            >
                              {suggesting && (
                                <>
                                  <Spinner /> 스키마 기반 Cypher 작성 중…
                                </>
                              )}
                            </Box>
                          </SpaceBetween>

                          {suggestError && (
                            <Alert
                              type="error"
                              dismissible
                              onDismiss={() => setSuggestError(null)}
                            >
                              {suggestError}
                            </Alert>
                          )}

                          {lastRationale && (
                            <Alert type="info">
                              <b>LLM 설계 의도:</b> {lastRationale}
                            </Alert>
                          )}

                          {draft.cypher && (
                            <FormField
                              label="생성된 Cypher"
                              description="읽기 전용 미리보기. 수정하려면 Expert 탭으로 이동."
                            >
                              <pre
                                style={{
                                  margin: 0,
                                  padding: 12,
                                  background: '#272b33',
                                  color: '#f8f8f2',
                                  borderRadius: 6,
                                  fontSize: 12,
                                  lineHeight: 1.5,
                                  whiteSpace: 'pre-wrap',
                                  overflowX: 'auto',
                                }}
                              >
                                {draft.cypher}
                              </pre>
                            </FormField>
                          )}
                        </SpaceBetween>
                      ),
                    },
                    {
                      id: 'expert',
                      label: 'Expert (Cypher 직접 편집)',
                      content: (
                        <SpaceBetween size="m">
                          <FormField
                            label={
                              <Popover
                                dismissButton={false}
                                position="top"
                                triggerType="custom"
                                header="Cypher 작성 규칙"
                                content={
                                  <Box fontSize="body-s">
                                    <b>:Label</b>, <b>[r:TYPE]</b> 형태로 쓰면
                                    실행 시점에 선택한 슬롯의
                                    suffix(__A/__B/__C)가 자동 주입됩니다.
                                    LIMIT을 포함하는 것을 권장합니다.
                                  </Box>
                                }
                              >
                                <span
                                  style={{
                                    cursor: 'help',
                                    borderBottom: '1px dotted #888',
                                  }}
                                >
                                  openCypher ⓘ
                                </span>
                              </Popover>
                            }
                            description="실행 시 선택 슬롯의 label suffix가 자동 주입됩니다."
                          >
                            <Textarea
                              rows={10}
                              value={draft.cypher}
                              onChange={({ detail }) =>
                                setDraft({ ...draft, cypher: detail.value })
                              }
                              placeholder={`MATCH (a:Attraction)-[:ATTRACTION_IN_CITY]->(c:City {_id:'OSA'})\nRETURN a._id AS id, a.landmarkNameKo AS name\nLIMIT 20`}
                            />
                          </FormField>
                          <FormField
                            label="자연어 설명 (선택)"
                            description="이 Cypher가 답하려는 질문"
                          >
                            <Input
                              value={draft.naturalLanguage}
                              onChange={({ detail }) =>
                                setDraft({
                                  ...draft,
                                  naturalLanguage: detail.value,
                                })
                              }
                            />
                          </FormField>
                        </SpaceBetween>
                      ),
                    },
                  ]}
                />

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                  }}
                >
                  <FormField
                    label="기대 행 수 — 최소"
                    description="rowCount가 이 값 이상이어야 pass"
                  >
                    <Input
                      type="number"
                      value={String(
                        draft.expected.rowCountRange?.[0] ?? 0,
                      )}
                      onChange={({ detail }) => {
                        const lo = Number(detail.value);
                        const hi =
                          draft.expected.rowCountRange?.[1] ?? 100;
                        setDraft({
                          ...draft,
                          expected: {
                            ...draft.expected,
                            rowCountRange: [
                              Number.isFinite(lo) ? lo : 0,
                              hi,
                            ],
                          },
                        });
                      }}
                    />
                  </FormField>
                  <FormField
                    label="기대 행 수 — 최대"
                    description="rowCount가 이 값 이하여야 pass"
                  >
                    <Input
                      type="number"
                      value={String(
                        draft.expected.rowCountRange?.[1] ?? 100,
                      )}
                      onChange={({ detail }) => {
                        const hi = Number(detail.value);
                        const lo =
                          draft.expected.rowCountRange?.[0] ?? 0;
                        setDraft({
                          ...draft,
                          expected: {
                            ...draft.expected,
                            rowCountRange: [
                              lo,
                              Number.isFinite(hi) ? hi : 100,
                            ],
                          },
                        });
                      }}
                    />
                  </FormField>
                </div>

                <Toggle
                  checked={draft.planningRelevant}
                  onChange={({ detail }) =>
                    setDraft({ ...draft, planningRelevant: detail.checked })
                  }
                >
                  상품 기획 관련 (축 5 점수에 반영될 후보)
                </Toggle>

                <ResultPanel result={results[draft.id]} />
              </SpaceBetween>
            )}
          </Container>
        </div>
      </SpaceBetween>

      <Modal
        visible={importOpen}
        onDismiss={() => setImportOpen(false)}
        header="JSON 가져오기"
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={() => setImportOpen(false)}>취소</Button>
              <Button variant="primary" onClick={importJson}>
                가져오기
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="s">
          <Box fontSize="body-s">
            {`{ "version": "v1", "questions": [...] }`} 형식. 같은 id는 덮어씁니다.
          </Box>
          <Textarea
            rows={12}
            value={importText}
            onChange={({ detail }) => setImportText(detail.value)}
            placeholder='{"version":"v1","questions":[{...}]}'
          />
        </SpaceBetween>
      </Modal>
    </ContentLayout>
  );
}

function ResultPanel({ result }: { result?: QResult }) {
  if (!result) {
    return (
      <Box color="text-status-inactive" fontSize="body-s">
        아직 검증되지 않았습니다. 우측 상단 <b>▶ 검증</b> 버튼을 누르세요.
      </Box>
    );
  }
  return (
    <Container
      header={
        <Header variant="h3">
          검증 결과{' '}
          {result.passed ? (
            <StatusIndicator type="success">pass</StatusIndicator>
          ) : result.stage === 'execute_error' ? (
            <StatusIndicator type="error">error</StatusIndicator>
          ) : (
            <StatusIndicator type="warning">fail</StatusIndicator>
          )}
        </Header>
      }
    >
      <SpaceBetween size="s">
        <Box fontSize="body-s">
          rowCount: <b>{result.rowCount}</b> · elapsed: <b>{result.elapsedMs}ms</b> · stage: {result.stage}
        </Box>
        {result.error && (
          <Alert type="error">
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontSize: 11,
              }}
            >
              {result.error}
            </pre>
          </Alert>
        )}
        {result.preview && result.preview.length > 0 && (
          <ExpandableSection
            headerText={`${result.preview.length} row preview`}
            variant="inline"
          >
            <pre
              style={{
                fontSize: 11,
                margin: 0,
                maxHeight: 240,
                overflow: 'auto',
                background: '#f8f9fa',
                padding: 8,
                borderRadius: 4,
              }}
            >
              {JSON.stringify(result.preview, null, 2)}
            </pre>
          </ExpandableSection>
        )}
      </SpaceBetween>
    </Container>
  );
}
