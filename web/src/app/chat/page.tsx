'use client';

import { useEffect, useRef, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import PromptInput from '@cloudscape-design/components/prompt-input';
import LiveRegion from '@cloudscape-design/components/live-region';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Spinner from '@cloudscape-design/components/spinner';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Toggle from '@cloudscape-design/components/toggle';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import MarkdownStream from '@/components/MarkdownStream';

type ToolTrace = {
  id: string;
  turn: number;
  name: string;
  input?: unknown;
  startedAt: number;
  endedAt?: number;
  reasoningSnippet?: string;
};

type Message = {
  role: 'user' | 'assistant';
  slot?: 'A' | 'B' | 'C';
  modelId?: string;
  content: string;
  reasoning?: string;
  turn: number;
  streaming?: boolean;
};

const CHAT_MODELS: Array<{ id: string; label: string; thinking: boolean }> = [
  { id: 'global.anthropic.claude-haiku-4-5', label: 'Haiku 4.5 (빠름·저렴)', thinking: false },
  { id: 'global.anthropic.claude-sonnet-4-6', label: 'Sonnet 4.6 (균형·기본)', thinking: true },
  { id: 'global.anthropic.claude-opus-4-7', label: 'Opus 4.7 (최강 추론)', thinking: true },
];

function modelSupportsThinking(id: string): boolean {
  const m = CHAT_MODELS.find((x) => x.id === id);
  return !!m?.thinking;
}

function shortModelLabel(id?: string): string {
  if (!id) return '';
  const m = CHAT_MODELS.find((x) => x.id === id);
  return m?.label.split(' ')[0] ?? id;
}

type SchemaInfo = {
  slot: string;
  name?: string;
  summary: string;
  empty?: boolean;
  vertexCount?: number;
  edgeCount?: number;
  derivedCount?: number;
};

const SUGGESTED = [
  { id: 's1', text: '오사카 근교 관광지를 알려줘' },
  { id: 's2', text: '오사카성과 같은 상품에 자주 등장하는 관광지 상위 5개' },
  { id: 's3', text: 'JOP1302603307CS 상품의 일차별 숙박 호텔' },
  { id: 's4', text: '로맨틱 분위기의 관광지 중 교토에 있는 것' },
  { id: 's5', text: '이 그래프에 벚꽃 시즌 관광지가 몇 개 있는지' },
];

function SuggestedPrompts({
  onPick,
  disabled,
}: {
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <Box>
      <Box variant="awsui-key-label" padding={{ bottom: 'xs' }}>
        추천 질의 (클릭하면 입력창에 채워짐)
      </Box>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {SUGGESTED.map((s) => (
          <Button key={s.id} onClick={() => onPick(s.text)} disabled={disabled}>
            {s.text}
          </Button>
        ))}
      </div>
    </Box>
  );
}

function Bubble({ msg, streaming }: { msg: Message; streaming?: boolean }) {
  const isUser = msg.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
      }}
    >
      <div
        style={{
          maxWidth: '88%',
          padding: '10px 14px',
          borderRadius: 12,
          background: isUser ? '#0972d3' : '#f2f3f3',
          color: isUser ? '#fff' : '#000',
        }}
      >
        <Box
          color={isUser ? 'inherit' : 'text-body-secondary'}
          fontSize="body-s"
          fontWeight="bold"
        >
          {isUser
            ? '사용자'
            : `에이전트 · Slot ${msg.slot ?? '?'}${
                msg.modelId ? ` · ${shortModelLabel(msg.modelId)}` : ''
              }`}
        </Box>
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55 }}>
            {msg.content}
          </div>
        ) : (
          <div>
            {msg.reasoning && (
              <div style={{ marginBottom: 8 }}>
                <ExpandableSection
                  headerText={`🧠 Reasoning${streaming ? ' · 생각하는 중' : ''}`}
                  variant="footer"
                  defaultExpanded={streaming}
                >
                  <div
                    style={{
                      fontSize: 12,
                      lineHeight: 1.55,
                      color: '#555',
                      fontStyle: 'italic',
                      whiteSpace: 'pre-wrap',
                      background: '#f8f9fa',
                      padding: 8,
                      borderRadius: 6,
                      maxHeight: 260,
                      overflowY: 'auto',
                    }}
                  >
                    {msg.reasoning}
                  </div>
                </ExpandableSection>
              </div>
            )}
            <MarkdownStream text={msg.content} />
            {streaming && <span style={{ opacity: 0.6 }}>▍</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolPanel({ traces }: { traces: ToolTrace[] }) {
  return (
    <Container
      header={
        <Header variant="h3" counter={`(${traces.length})`}>
          도구 호출 이력
        </Header>
      }
    >
      {traces.length === 0 ? (
        <Box color="text-status-inactive">대화 시작 시 에이전트가 사용한 도구가 여기에 나타납니다.</Box>
      ) : (
        <SpaceBetween size="xs">
          {traces.map((t) => {
            const ms = t.endedAt ? t.endedAt - t.startedAt : undefined;
            return (
              <div
                key={t.id}
                style={{
                  border: '1px solid #e9ebed',
                  borderRadius: 6,
                  padding: 8,
                  background: t.endedAt ? '#fff' : '#fef9e7',
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>
                    <StatusIndicator type={t.endedAt ? 'success' : 'in-progress'}>
                      <code>{t.name}</code>
                    </StatusIndicator>
                    <span
                      style={{ marginLeft: 8, fontSize: 11, color: '#777' }}
                    >
                      turn {t.turn}
                    </span>
                  </div>
                  {ms != null && (
                    <Box fontSize="body-s" color="text-status-inactive">
                      {ms} ms
                    </Box>
                  )}
                </div>
                {t.reasoningSnippet && (
                  <ExpandableSection
                    headerText="🧠 호출 직전 reasoning"
                    variant="footer"
                    defaultExpanded={false}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontStyle: 'italic',
                        color: '#555',
                        whiteSpace: 'pre-wrap',
                        background: '#f8f9fa',
                        padding: 6,
                        borderRadius: 4,
                        maxHeight: 180,
                        overflowY: 'auto',
                      }}
                    >
                      {t.reasoningSnippet}
                    </div>
                  </ExpandableSection>
                )}
                {t.input != null ? (
                  <ExpandableSection
                    headerText="input"
                    variant="footer"
                    defaultExpanded={false}
                  >
                    <pre
                      style={{
                        fontSize: 11,
                        margin: 0,
                        maxHeight: 220,
                        overflow: 'auto',
                        background: '#f8f9fa',
                        padding: 6,
                        borderRadius: 4,
                      }}
                    >
                      {JSON.stringify(t.input, null, 2)}
                    </pre>
                  </ExpandableSection>
                ) : null}
              </div>
            );
          })}
        </SpaceBetween>
      )}
    </Container>
  );
}

export default function ChatPage() {
  const [slot, setSlot] = useState<'A' | 'B' | 'C'>('B');
  const [schema, setSchema] = useState<SchemaInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tools, setTools] = useState<ToolTrace[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string>('global.anthropic.claude-sonnet-4-6');
  const [thinkingOn, setThinkingOn] = useState<boolean>(true);
  const turnRef = useRef(0);
  const reasoningCursorRef = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  const modelSupports = modelSupportsThinking(modelId);
  const effectiveThinking = thinkingOn && modelSupports;

  useEffect(() => {
    fetch(`/api/agent/schema?slot=${slot}`)
      .then((r) => r.json())
      .then(setSchema)
      .catch((e) => setError(String(e)));
  }, [slot]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  function updateAssistant(fn: (m: Message) => Message) {
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          next[i] = fn(next[i]);
          break;
        }
      }
      return next;
    });
  }

  async function send(raw: string) {
    const value = raw.trim();
    if (!value || loading) return;
    setError(null);
    setInput('');
    turnRef.current += 1;
    const turn = turnRef.current;
    setMessages((p) => [
      ...p,
      { role: 'user', content: value, turn },
      { role: 'assistant', slot, modelId, content: '', turn, streaming: true },
    ]);
    setLoading(true);
    reasoningCursorRef.current = 0;

    try {
      const res = await fetch('/api/agent/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: value,
          slot,
          modelId,
          thinking: { enabled: effectiveThinking },
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buf += decoder.decode(chunk, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const raw of parts) {
          const lines = raw.split('\n');
          let ev = '', data = '';
          for (const l of lines) {
            if (l.startsWith('event:')) ev = l.slice(6).trim();
            else if (l.startsWith('data:')) data = l.slice(5).trim();
          }
          if (!data) continue;
          let d: Record<string, unknown> = {};
          try { d = JSON.parse(data); } catch { continue; }

          if (ev === 'delta' && typeof d.text === 'string') {
            const t = d.text as string;
            updateAssistant((m) => ({ ...m, content: m.content + t }));
          } else if (ev === 'reasoning_delta' && typeof d.text === 'string') {
            const t = d.text as string;
            updateAssistant((m) => ({ ...m, reasoning: (m.reasoning ?? '') + t }));
          } else if (ev === 'tool_start' && typeof d.name === 'string') {
            // Attribute reasoning accumulated since the last cursor to this tool call.
            let snippet: string | undefined;
            setMessages((prev) => {
              for (let i = prev.length - 1; i >= 0; i--) {
                if (prev[i].role === 'assistant') {
                  const full = prev[i].reasoning ?? '';
                  const slice = full.slice(reasoningCursorRef.current).trim();
                  if (slice.length > 0) snippet = slice;
                  reasoningCursorRef.current = full.length;
                  break;
                }
              }
              return prev;
            });
            const id = `${turn}-${d.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            setTools((prev) => [
              ...prev,
              {
                id,
                turn,
                name: d.name as string,
                input: d.input,
                startedAt: Date.now(),
                reasoningSnippet: snippet,
              },
            ]);
          } else if (ev === 'tool_end' && typeof d.name === 'string') {
            setTools((prev) => {
              const next = [...prev];
              // find most recent open trace for this name in this turn
              for (let i = next.length - 1; i >= 0; i--) {
                if (
                  next[i].turn === turn &&
                  next[i].name === d.name &&
                  next[i].endedAt == null
                ) {
                  next[i] = { ...next[i], endedAt: Date.now() };
                  break;
                }
              }
              return next;
            });
          } else if (ev === 'final') {
            updateAssistant((m) => ({ ...m, streaming: false }));
          } else if (ev === 'error') {
            setError(String(d.message));
          }
        }
      }
      updateAssistant((m) => ({ ...m, streaming: false }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      updateAssistant((m) => ({ ...m, streaming: false }));
    } finally {
      setLoading(false);
    }
  }

  function clearAll() {
    setMessages([]);
    setTools([]);
    turnRef.current = 0;
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="같은 자연어 질문을 슬롯 A/B/C에 물으면 매핑 차이가 LLM 답변에 어떻게 영향을 주는지 실시간 확인"
          actions={
            <SpaceBetween direction="horizontal" size="xs" alignItems="center">
              <Box fontSize="body-s">모델</Box>
              <Select
                selectedOption={
                  (CHAT_MODELS.find((m) => m.id === modelId)
                    ? {
                        label: CHAT_MODELS.find((m) => m.id === modelId)!.label,
                        value: modelId,
                      }
                    : null) as SelectProps.Option | null
                }
                onChange={({ detail }) => {
                  if (detail.selectedOption?.value) {
                    setModelId(detail.selectedOption.value);
                  }
                }}
                options={CHAT_MODELS.map((m) => ({ label: m.label, value: m.id }))}
                disabled={loading}
              />
              <Toggle
                checked={effectiveThinking}
                disabled={!modelSupports || loading}
                onChange={({ detail }) => setThinkingOn(detail.checked)}
              >
                🧠 Thinking{!modelSupports ? ' (미지원)' : ''}
              </Toggle>
              <Button onClick={clearAll} disabled={loading || messages.length === 0}>
                Clear
              </Button>
              <SegmentedControl
                selectedId={slot}
                onChange={({ detail }) => setSlot(detail.selectedId as 'A' | 'B' | 'C')}
                options={[
                  { id: 'A', text: 'Slot A' },
                  { id: 'B', text: 'Slot B' },
                  { id: 'C', text: 'Slot C' },
                ]}
              />
            </SpaceBetween>
          }
        >
          NL Chat · 슬롯 에이전트
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h3">현재 스키마 (에이전트에 주입됨)</Header>}>
          {schema?.empty ? (
            <Alert type="warning">
              Slot {slot}이 비어있습니다. <b>/slot/{slot}</b>에서 먼저 매핑을 적재하세요.
            </Alert>
          ) : schema ? (
            <SpaceBetween size="xs">
              <Box fontWeight="bold">{schema.name}</Box>
              <Box fontSize="body-s" color="text-status-inactive">
                Vertex {schema.vertexCount} · Edge {schema.edgeCount} · Derived{' '}
                {schema.derivedCount}
              </Box>
              <ExpandableSection headerText="스키마 요약 (LLM 시스템 프롬프트)">
                <pre
                  style={{
                    fontSize: 11,
                    margin: 0,
                    maxHeight: 240,
                    overflow: 'auto',
                    background: '#f8f9fa',
                    padding: 10,
                    borderRadius: 6,
                  }}
                >
                  {schema.summary}
                </pre>
              </ExpandableSection>
            </SpaceBetween>
          ) : (
            <Spinner size="normal" />
          )}
        </Container>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 360px',
            gap: 16,
          }}
        >
          <Container header={<Header variant="h2">대화</Header>}>
            <SpaceBetween size="m">
              <div
                style={{
                  minHeight: 320,
                  maxHeight: 600,
                  overflowY: 'auto',
                  padding: 8,
                  background: '#fff',
                  border: '1px solid #e9ebed',
                  borderRadius: 8,
                }}
              >
                {messages.length === 0 && (
                  <Box textAlign="center" color="text-status-inactive" padding="l">
                    아래의 추천 질의를 누르거나 직접 질문을 입력하세요.
                  </Box>
                )}
                {messages.map((m, i) => (
                  <Bubble key={i} msg={m} streaming={m.streaming} />
                ))}
                {loading && messages.at(-1)?.role !== 'assistant' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 8 }}>
                    <Spinner size="normal" />
                    <Box fontSize="body-s" color="text-status-inactive">
                      연결 중...
                    </Box>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              <LiveRegion hidden>
                {messages.length > 0 ? messages.at(-1)!.content : ''}
              </LiveRegion>

              {/* 항상 노출 */}
              <SuggestedPrompts onPick={setInput} disabled={loading || !!schema?.empty} />

              {error && <Alert type="error">{error}</Alert>}

              <PromptInput
                value={input}
                onChange={({ detail }) => setInput(detail.value)}
                onAction={({ detail }) => send(detail.value)}
                placeholder={`Slot ${slot}의 에이전트에게 한국어로 질문`}
                actionButtonAriaLabel="전송"
                actionButtonIconName="send"
                disabled={loading || schema?.empty}
              />
            </SpaceBetween>
          </Container>

          <ToolPanel traces={tools} />
        </div>
      </SpaceBetween>
    </ContentLayout>
  );
}
