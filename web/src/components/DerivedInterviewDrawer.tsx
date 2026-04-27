'use client';

import { useEffect, useRef, useState } from 'react';
import Alert from '@cloudscape-design/components/alert';
import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Header from '@cloudscape-design/components/header';
import PromptInput from '@cloudscape-design/components/prompt-input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Spinner from '@cloudscape-design/components/spinner';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import MarkdownStream from '@/components/MarkdownStream';

import {
  createDraftFromTemplate,
  getTemplate,
  TEMPLATES,
  type RuleDraft,
  type TemplateId,
} from '@/lib/derived-templates';

type Suggestion = {
  templateId: TemplateId;
  edgeTypeName?: string;
  inputs?: Record<string, unknown>;
  rationale?: string;
  previewCount?: number;
};

type AttachedSuggestion = Suggestion & {
  key: string;       // unique per parse occurrence
  messageIdx: number;
  acceptedAt?: number;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
};

type ToolTrace = {
  id: string;
  name: string;
  input?: unknown;
  startedAt: number;
  endedAt?: number;
};

type Props = {
  slot: 'A' | 'B' | 'C';
  /** Current (possibly unsaved) YAML to ground the agent's schema summary. */
  yamlSnapshot: string;
  /** Called when the user clicks "이 규칙 추가" on a suggestion card. */
  onAcceptSuggestion: (draft: RuleDraft) => void;
  onClose: () => void;
};

const DEFAULT_MODEL = 'global.anthropic.claude-sonnet-4-6';

const SUGGESTED_PROMPTS = [
  '같은 여행상품 안에서 자주 같이 가는 관광지끼리 연결하고 싶어',
  '일정 안에서 먼저 보고 다음에 가는 관광지 순서를 연결하고 싶어',
  '가까운 도시끼리 이어주고 싶어',
  '테마가 비슷한 관광지끼리 연결하고 싶어',
];

export default function DerivedInterviewDrawer({
  slot,
  yamlSnapshot,
  onAcceptSuggestion,
  onClose,
}: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [tools, setTools] = useState<ToolTrace[]>([]);
  const [accepted, setAccepted] = useState<Record<string, true>>({});
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Extract suggestion JSON blocks from each assistant message.
  const suggestions: AttachedSuggestion[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const blocks = extractJsonBlocks(m.content);
    for (let b = 0; b < blocks.length; b++) {
      const sug = parseSuggestion(blocks[b]);
      if (sug) suggestions.push({ ...sug, key: `${i}-${b}`, messageIdx: i });
    }
  }

  async function send(raw: string) {
    const value = raw.trim();
    if (!value || loading) return;
    setError(null);
    setInput('');
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: value },
      { role: 'assistant', content: '', streaming: true },
    ]);
    setLoading(true);

    try {
      const res = await fetch('/api/agent/derive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: value,
          slot,
          modelId: DEFAULT_MODEL,
          thinking: { enabled: true },
          yamlSnapshot,
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
        for (const rawLine of parts) {
          const lines = rawLine.split('\n');
          let ev = '', data = '';
          for (const l of lines) {
            if (l.startsWith('event:')) ev = l.slice(6).trim();
            else if (l.startsWith('data:')) data = l.slice(5).trim();
          }
          if (!data) continue;
          let d: Record<string, unknown> = {};
          try {
            d = JSON.parse(data);
          } catch {
            continue;
          }

          if (ev === 'delta' && typeof d.text === 'string') {
            const t = d.text as string;
            setMessages((prev) => appendToLastAssistant(prev, t));
          } else if (ev === 'tool_start' && typeof d.name === 'string') {
            const id = `${d.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            setTools((prev) => [
              ...prev,
              { id, name: d.name as string, input: d.input, startedAt: Date.now() },
            ]);
          } else if (ev === 'tool_end' && typeof d.name === 'string') {
            setTools((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i].name === d.name && next[i].endedAt == null) {
                  next[i] = { ...next[i], endedAt: Date.now() };
                  break;
                }
              }
              return next;
            });
          } else if (ev === 'final') {
            setMessages((prev) => stopStreamingLastAssistant(prev));
          } else if (ev === 'error') {
            setError(String(d.message));
          }
        }
      }
      setMessages((prev) => stopStreamingLastAssistant(prev));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => stopStreamingLastAssistant(prev));
    } finally {
      setLoading(false);
    }
  }

  function accept(sug: AttachedSuggestion) {
    const tpl = TEMPLATES.find((t) => t.id === sug.templateId);
    if (!tpl) {
      setError(`알 수 없는 템플릿: ${sug.templateId}`);
      return;
    }
    // Start from a template-defaulted draft, then overlay the LLM's inputs so
    // any missing keys fall back to sane defaults (e.g. min_overlap).
    const base = createDraftFromTemplate(sug.templateId);
    const draft: RuleDraft = {
      id: base.id,
      templateId: sug.templateId,
      edgeTypeName:
        (sug.edgeTypeName ?? base.edgeTypeName).toUpperCase().replace(/[^A-Z0-9_]/g, '_') ||
        base.edgeTypeName,
      inputs: { ...base.inputs, ...(sug.inputs ?? {}) },
    };
    onAcceptSuggestion(draft);
    setAccepted((prev) => ({ ...prev, [sug.key]: true }));
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 520,
      }}
    >
      <SpaceBetween size="s">
        <Alert type="info" header="파생 관계 인터뷰어">
          이 슬롯의 스키마와 SQLite 통계를 근거로 LLM이 관계 후보와 파라미터를 제안합니다.
          하단 대화창에 의도를 입력하세요. 제안은 카드로 나타나고 "이 규칙 추가" 버튼으로 바로 반영됩니다.
        </Alert>

        <ExpandableSection headerText="현재 스키마 컨텍스트 (YAML 스냅샷)">
          <pre
            style={{
              fontSize: 11,
              margin: 0,
              maxHeight: 180,
              overflow: 'auto',
              background: '#f8f9fa',
              padding: 8,
              borderRadius: 6,
            }}
          >
            {yamlSnapshot || '(빈 매핑 — 먼저 vertex/edge 를 만들어야 합니다)'}
          </pre>
        </ExpandableSection>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 300px',
            gap: 12,
          }}
        >
          <Container header={<Header variant="h3">대화</Header>}>
            <SpaceBetween size="s">
              <div
                style={{
                  minHeight: 260,
                  maxHeight: 420,
                  overflowY: 'auto',
                  padding: 6,
                  background: '#fff',
                  border: '1px solid #e9ebed',
                  borderRadius: 8,
                }}
              >
                {messages.length === 0 ? (
                  <Box textAlign="center" color="text-status-inactive" padding="m">
                    <div style={{ marginBottom: 10 }}>
                      아래의 예시를 누르거나 직접 의도를 입력하세요.
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
                      {SUGGESTED_PROMPTS.map((p) => (
                        <Button key={p} onClick={() => setInput(p)} disabled={loading}>
                          {p}
                        </Button>
                      ))}
                    </div>
                  </Box>
                ) : (
                  messages.map((m, i) => (
                    <Bubble key={i} msg={m}>
                      {m.role === 'assistant' &&
                        suggestions
                          .filter((s) => s.messageIdx === i)
                          .map((s) => (
                            <SuggestionCard
                              key={s.key}
                              suggestion={s}
                              accepted={!!accepted[s.key]}
                              onAccept={() => accept(s)}
                            />
                          ))}
                    </Bubble>
                  ))
                )}
                {loading && messages.at(-1)?.role !== 'assistant' && (
                  <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
                    <Spinner size="normal" />
                    <Box fontSize="body-s" color="text-status-inactive">
                      연결 중...
                    </Box>
                  </div>
                )}
                <div ref={endRef} />
              </div>

              {error && <Alert type="error">{error}</Alert>}

              <PromptInput
                value={input}
                onChange={({ detail }) => setInput(detail.value)}
                onAction={({ detail }) => send(detail.value)}
                placeholder={`Slot ${slot}에 파생 관계를 추가하고 싶어요. 어떤 관계일까요?`}
                actionButtonAriaLabel="전송"
                actionButtonIconName="send"
                disabled={loading}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button onClick={onClose}>닫기</Button>
              </div>
            </SpaceBetween>
          </Container>

          <Container header={<Header variant="h3" counter={`(${tools.length})`}>도구 호출</Header>}>
            {tools.length === 0 ? (
              <Box color="text-status-inactive" fontSize="body-s">
                에이전트가 사용한 도구가 여기에 나타납니다.
              </Box>
            ) : (
              <div
                style={{
                  maxHeight: 420,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
              <SpaceBetween size="xs">
                {tools.map((t) => {
                  const ms = t.endedAt ? t.endedAt - t.startedAt : undefined;
                  return (
                    <div
                      key={t.id}
                      style={{
                        border: '1px solid #e9ebed',
                        borderRadius: 6,
                        padding: 6,
                        background: t.endedAt ? '#fff' : '#fef9e7',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <StatusIndicator type={t.endedAt ? 'success' : 'in-progress'}>
                          <code style={{ fontSize: 11 }}>{t.name}</code>
                        </StatusIndicator>
                        {ms != null && (
                          <Box fontSize="body-s" color="text-status-inactive">
                            {ms} ms
                          </Box>
                        )}
                      </div>
                      {t.input != null && (
                        <ExpandableSection headerText="input" variant="footer">
                          <pre
                            style={{
                              fontSize: 10,
                              margin: 0,
                              maxHeight: 140,
                              overflow: 'auto',
                              background: '#f8f9fa',
                              padding: 4,
                              borderRadius: 4,
                            }}
                          >
                            {JSON.stringify(t.input, null, 2)}
                          </pre>
                        </ExpandableSection>
                      )}
                    </div>
                  );
                })}
              </SpaceBetween>
              </div>
            )}
          </Container>
        </div>
      </SpaceBetween>
    </div>
  );
}

function Bubble({ msg, children }: { msg: Message; children?: React.ReactNode }) {
  const isUser = msg.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 10,
      }}
    >
      <div
        style={{
          maxWidth: '92%',
          padding: '8px 12px',
          borderRadius: 10,
          background: isUser ? '#0972d3' : '#f2f3f3',
          color: isUser ? '#fff' : '#000',
        }}
      >
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{msg.content}</div>
        ) : (
          <div>
            <MarkdownStream text={stripJsonBlocks(msg.content)} />
            {msg.streaming && <span style={{ opacity: 0.6 }}>▍</span>}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

function SuggestionCard({
  suggestion,
  accepted,
  onAccept,
}: {
  suggestion: AttachedSuggestion;
  accepted: boolean;
  onAccept: () => void;
}) {
  const tpl = TEMPLATES.find((t) => t.id === suggestion.templateId);
  if (!tpl) return null;
  const inputsPreview = Object.entries(suggestion.inputs ?? {})
    .map(([k, v]) => `${k}=${formatValue(v)}`)
    .join(' · ');
  return (
    <div
      style={{
        marginTop: 10,
        padding: 10,
        border: '1px solid #0972d3',
        borderRadius: 8,
        background: '#f1f8ff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Badge color="blue">{tpl.titleKo}</Badge>
          <span style={{ marginLeft: 8, fontWeight: 600, fontSize: 13 }}>
            {suggestion.edgeTypeName ?? tpl.defaultEdgeTypeName}
          </span>
        </div>
        <Button
          variant={accepted ? 'normal' : 'primary'}
          iconName={accepted ? 'check' : 'add-plus'}
          disabled={accepted}
          onClick={onAccept}
        >
          {accepted ? '추가됨' : '이 규칙 추가'}
        </Button>
      </div>
      {inputsPreview && (
        <Box fontSize="body-s" padding={{ top: 'xxs' }} color="text-status-inactive">
          파라미터: {inputsPreview}
        </Box>
      )}
      {suggestion.rationale && (
        <Box fontSize="body-s" padding={{ top: 'xxs' }}>
          {suggestion.rationale}
        </Box>
      )}
      {suggestion.previewCount != null && (
        <Box fontSize="body-s" color="text-status-info" padding={{ top: 'xxs' }}>
          예상 관계 수 ≈ {suggestion.previewCount.toLocaleString()}
        </Box>
      )}
    </div>
  );
}

/* ---------------- parsing helpers ---------------- */

function appendToLastAssistant(prev: Message[], text: string): Message[] {
  const next = [...prev];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'assistant') {
      next[i] = { ...next[i], content: next[i].content + text };
      break;
    }
  }
  return next;
}

function stopStreamingLastAssistant(prev: Message[]): Message[] {
  const next = [...prev];
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'assistant') {
      next[i] = { ...next[i], streaming: false };
      break;
    }
  }
  return next;
}

function extractJsonBlocks(content: string): string[] {
  const out: string[] = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(content)) != null) {
    out.push(m[1].trim());
  }
  return out;
}

function stripJsonBlocks(content: string): string {
  return content.replace(/```json\s*[\s\S]*?```/g, '').trim();
}

function parseSuggestion(raw: string): Suggestion | null {
  try {
    const obj = JSON.parse(raw);
    const s = obj?.suggestion ?? obj;
    if (!s || typeof s !== 'object') return null;
    const tid = String(s.templateId ?? '') as TemplateId;
    // validate against known templates
    try {
      getTemplate(tid);
    } catch {
      return null;
    }
    return {
      templateId: tid,
      edgeTypeName: s.edgeTypeName,
      inputs: s.inputs && typeof s.inputs === 'object' ? s.inputs : {},
      rationale: typeof s.rationale === 'string' ? s.rationale : undefined,
      previewCount: typeof s.previewCount === 'number' ? s.previewCount : undefined,
    };
  } catch {
    return null;
  }
}

function formatValue(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === 'object' && v != null) return JSON.stringify(v);
  return String(v);
}
