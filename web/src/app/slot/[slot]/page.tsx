'use client';

import { useEffect, useState, use } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import Textarea from '@cloudscape-design/components/textarea';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import Table from '@cloudscape-design/components/table';
import Checkbox from '@cloudscape-design/components/checkbox';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import FormField from '@cloudscape-design/components/form-field';
import Modal from '@cloudscape-design/components/modal';
import Input from '@cloudscape-design/components/input';
import Cards from '@cloudscape-design/components/cards';
import TextFilter from '@cloudscape-design/components/text-filter';
import Pagination from '@cloudscape-design/components/pagination';
import Badge from '@cloudscape-design/components/badge';
import Flashbar, {
  FlashbarProps,
} from '@cloudscape-design/components/flashbar';
import { useCollection } from '@cloudscape-design/collection-hooks';
import QuestionDrivenEditor from '@/components/QuestionDrivenEditor';
import ColumnAssembler, {
  type ColumnAssemblerPresetKind,
} from '@/components/ColumnAssembler';
import type { ComponentId } from '@/lib/question-requirements';
import type { AssemblerState } from '@/lib/column-assembler';

type Preset = { id: string; name: string; description: string; slot: string; yaml: string };

type StepState = {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  processed: number;
  total: number;
  elapsedMs?: number;
  error?: string;
};

export default function SlotPage({
  params,
}: {
  params: Promise<{ slot: string }>;
}) {
  const { slot } = use(params);
  const slotId = slot as 'A' | 'B' | 'C';

  const [presets, setPresets] = useState<Preset[]>([]);
  const [selected, setSelected] = useState<SelectProps.Option | null>(null);
  const [yamlText, setYamlText] = useState<string>('');
  const [mode, setMode] = useState<'expert' | 'simple' | 'assembler'>('simple');
  const [reset, setReset] = useState(true);
  const [schemaName, setSchemaName] = useState<string>('Custom (질문 드라이버)');
  const [schemaDesc, setSchemaDesc] = useState<string>(
    '풀고 싶은 질의를 선택하면 매핑이 자동 생성됨',
  );
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [activeComponents, setActiveComponents] = useState<ComponentId[]>([]);
  // Increments every time a preset is loaded — sub-editors react to resync.
  const [presetVersion, setPresetVersion] = useState<number>(0);
  const [assemblerPreset, setAssemblerPreset] = useState<ColumnAssemblerPresetKind>('flat');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [finished, setFinished] = useState<{ vertex: number; edge: number; ms: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  type SnapshotSummary = {
    id: string;
    name: string;
    description?: string;
    sourcePreset?: string;
    updatedAt: string;
  };
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [loadingSnapshotId, setLoadingSnapshotId] = useState<string | null>(null);
  const [flash, setFlash] = useState<FlashbarProps.MessageDefinition[]>([]);

  useEffect(() => {
    fetch('/api/presets')
      .then((r) => r.json())
      .then((d) => setPresets(d.presets ?? []));
    refreshSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshSnapshots() {
    try {
      const r = await fetch('/api/snapshots');
      const d = await r.json();
      if (r.ok) setSnapshots(d.snapshots ?? []);
    } catch {
      /* non-fatal */
    }
  }

  function pushFlash(type: FlashbarProps.Type, content: string) {
    const id = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setFlash((prev) => [
      ...prev,
      {
        id,
        type,
        content,
        dismissible: true,
        onDismiss: () => setFlash((p) => p.filter((x) => x.id !== id)),
      },
    ]);
  }

  async function loadSnapshotById(snapshotId: string) {
    setLoadingSnapshotId(snapshotId);
    setError(null);
    try {
      const r = await fetch(`/api/snapshots/${snapshotId}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const snap = d.snapshot as {
        id: string;
        name: string;
        description?: string;
        yaml: string;
        sourcePreset?: string;
      };
      const rewritten = snap.yaml.replace(/^slot:\s*[ABC]\s*$/m, `slot: ${slotId}`);
      setYamlText(rewritten);
      setSelected({ label: snap.name, value: `snapshot:${snap.id}` });
      setSchemaName(snap.name);
      setSchemaDesc(snap.description ?? '(스냅샷)');
      const kind: ColumnAssemblerPresetKind =
        snap.sourcePreset === 'flat'
          ? 'flat'
          : snap.sourcePreset === 'phase1' || snap.sourcePreset === 'extended'
          ? 'phase1'
          : 'custom';
      setAssemblerPreset(kind);
      // Force Expert mode — QuestionDrivenEditor / ColumnAssembler rebuild YAML
      // from their own reverse-inferred state, which loses anything not in the
      // known component set (e.g. custom derived edges). Expert preserves the
      // YAML verbatim.
      setMode('expert');
      pushFlash(
        'success',
        `스냅샷 "${snap.name}" 로드 완료. Expert 모드로 전환됨 (원본 YAML 보존).`,
      );
    } catch (e) {
      pushFlash('error', `로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoadingSnapshotId(null);
    }
  }

  async function saveCurrentSnapshot() {
    if (!saveName.trim()) {
      pushFlash('error', '이름은 필수입니다.');
      return;
    }
    if (!yamlText.trim()) {
      pushFlash('error', '저장할 YAML이 비어있습니다.');
      return;
    }
    setSaveBusy(true);
    try {
      const sourcePreset =
        typeof selected?.value === 'string' && !selected.value.startsWith('snapshot:')
          ? selected.value
          : undefined;
      const r = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDesc.trim() || undefined,
          yaml: yamlText,
          sourcePreset,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setSaveOpen(false);
      setSaveName('');
      setSaveDesc('');
      pushFlash('success', `스냅샷 "${d.snapshot.name}" 저장 완료.`);
      await refreshSnapshots();
    } catch (e) {
      pushFlash('error', `저장 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaveBusy(false);
    }
  }

  async function deleteSnapshotById(snapshotId: string, name: string) {
    if (!confirm(`스냅샷 "${name}"을 삭제할까요?`)) return;
    try {
      const r = await fetch(`/api/snapshots/${snapshotId}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 204) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      pushFlash('success', `스냅샷 "${name}" 삭제됨.`);
      await refreshSnapshots();
    } catch (e) {
      pushFlash('error', `삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function loadPreset(p: Preset) {
    const rewritten = p.yaml.replace(/^slot:\s*[ABC]\s*$/m, `slot: ${slotId}`);
    setYamlText(rewritten);
    setSelected({ label: p.name, value: p.id });
    setSchemaName(p.name);
    setSchemaDesc(p.description);
    // Reverse-infer the question selection from the preset YAML
    const qs: string[] = [];
    if (/label:\s*Theme\b/.test(p.yaml)) qs.push('Q14');
    if (/label:\s*Mood\b/.test(p.yaml)) qs.push('Q09');
    if (/label:\s*Season\b/.test(p.yaml)) qs.push('Q15');
    if (/label:\s*Prefecture\b/.test(p.yaml)) qs.push('Q01', 'Q09');
    if (/NEAR_CITY/.test(p.yaml)) qs.push('Q01');
    if (/OFTEN_COTRAVELED/.test(p.yaml)) qs.push('Q01');
    if (/label:\s*RepresentativeProduct\b/.test(p.yaml)) qs.push('Q05', 'Q06');
    if (/label:\s*HotelStay\b/.test(p.yaml)) qs.push('Q03', 'Q10', 'Q14');
    if (/label:\s*FlightSegment\b/.test(p.yaml)) qs.push('Q11');
    if (/CO_VISITED/.test(p.yaml)) qs.push('Q07', 'Q16');
    qs.push('Q02', 'Q04', 'Q08', 'Q12', 'Q13');
    setSelectedQuestions([...new Set(qs)]);

    // Map preset id → assembler preset kind
    const kind: ColumnAssemblerPresetKind =
      p.id === 'flat' ? 'flat' : p.id === 'phase1' || p.id === 'extended' ? 'phase1' : 'custom';
    setAssemblerPreset(kind);

    // Signal sub-editors (QuestionDriven, Assembler) to resync
    setPresetVersion((v) => v + 1);
  }

  function onQuestionDrivenChange(payload: {
    yaml: string;
    selectedQuestions: string[];
    components: ComponentId[];
  }) {
    setYamlText(payload.yaml);
    setSelectedQuestions(payload.selectedQuestions);
    setActiveComponents(payload.components);
  }

  function upsertStep(name: string, patch: Partial<StepState>) {
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.name === name);
      if (idx === -1)
        return [
          ...prev,
          { name, status: 'running', processed: 0, total: 0, ...patch } as StepState,
        ];
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  async function run() {
    setRunning(true);
    setError(null);
    setFinished(null);
    setSteps([]);
    try {
      const res = await fetch(`/api/slot/${slotId}/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: yamlText, reset }),
      });
      if (!res.ok || !res.body) {
        const txt = await res.text();
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const events = buf.split('\n\n');
        buf = events.pop() ?? '';
        for (const raw of events) {
          const lines = raw.split('\n');
          let ev = '', data = '';
          for (const l of lines) {
            if (l.startsWith('event:')) ev = l.slice(6).trim();
            else if (l.startsWith('data:')) data = l.slice(5).trim();
          }
          if (!data) continue;
          const d = JSON.parse(data);
          if (ev === 'step') upsertStep(d.name, { status: 'running' });
          else if (ev === 'progress')
            upsertStep(d.name, { processed: d.processed, total: d.total });
          else if (ev === 'done')
            upsertStep(d.name, {
              status: 'done',
              processed: d.inserted,
              total: d.inserted,
              elapsedMs: d.elapsedMs,
            });
          else if (ev === 'error')
            upsertStep(d.name ?? 'error', { status: 'error', error: d.message });
          else if (ev === 'finished')
            setFinished({ vertex: d.vertexCount, edge: d.edgeCount, ms: d.totalMs });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  async function clearSlot() {
    if (!confirm(`Slot ${slotId}의 모든 데이터를 삭제합니다. 계속?`)) return;
    await fetch(`/api/slot/${slotId}/clear`, { method: 'POST' });
    setSteps([]);
    setFinished(null);
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={`매핑 YAML → Neptune 적재 (label suffix __${slotId})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                onClick={() => {
                  refreshSnapshots();
                  setLoadOpen(true);
                }}
                disabled={running}
                loading={loadingSnapshotId !== null}
              >
                📂 불러오기 ({snapshots.length})
              </Button>
              <Button
                onClick={() => {
                  setSaveName('');
                  setSaveDesc('');
                  setSaveOpen(true);
                }}
                disabled={running || !yamlText.trim()}
              >
                📁 저장
              </Button>
              <Button onClick={clearSlot} disabled={running}>
                Clear Slot
              </Button>
              <Button
                variant="primary"
                onClick={run}
                loading={running}
                disabled={!yamlText.trim()}
              >
                Load to Neptune
              </Button>
            </SpaceBetween>
          }
        >
          Slot {slotId}
        </Header>
      }
    >
      <SpaceBetween size="l">
        {flash.length > 0 && <Flashbar items={flash} />}

        <Modal
          visible={saveOpen}
          onDismiss={() => setSaveOpen(false)}
          header="스냅샷 저장"
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button onClick={() => setSaveOpen(false)} disabled={saveBusy}>
                  취소
                </Button>
                <Button
                  variant="primary"
                  loading={saveBusy}
                  onClick={saveCurrentSnapshot}
                >
                  저장
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="s">
            <FormField label="이름" description="나중에 불러올 때 식별용 이름">
              <Input
                value={saveName}
                onChange={({ detail }) => setSaveName(detail.value)}
                placeholder="예: phase1-with-onsen"
              />
            </FormField>
            <FormField label="설명 (선택)">
              <Input
                value={saveDesc}
                onChange={({ detail }) => setSaveDesc(detail.value)}
                placeholder="어떤 실험인지 한 줄"
              />
            </FormField>
            <Box fontSize="body-s" color="text-status-inactive">
              현재 Slot {slotId}의 YAML이 DynamoDB에 저장됩니다.
            </Box>
          </SpaceBetween>
        </Modal>

        <SnapshotLoadModal
          visible={loadOpen}
          snapshots={snapshots}
          loadingId={loadingSnapshotId}
          onDismiss={() => setLoadOpen(false)}
          onLoad={async (id) => {
            await loadSnapshotById(id);
            setLoadOpen(false);
          }}
          onDelete={async (id, name) => {
            await deleteSnapshotById(id, name);
          }}
        />

        <Container header={<Header variant="h3">프리셋에서 시작</Header>}>
          <SpaceBetween size="s" direction="horizontal">
            <Select
              selectedOption={selected}
              onChange={({ detail }) => {
                const p = presets.find((x) => x.id === detail.selectedOption.value);
                if (p) loadPreset(p);
              }}
              options={presets.map((p) => ({
                label: p.name,
                value: p.id,
                description: p.description,
              }))}
              placeholder="프리셋 선택"
            />
            <Checkbox checked={reset} onChange={({ detail }) => setReset(detail.checked)}>
              적재 전 슬롯 비우기
            </Checkbox>
          </SpaceBetween>
        </Container>

        <Container
          header={
            <Header
              variant="h2"
              actions={
                <SegmentedControl
                  selectedId={mode}
                  onChange={({ detail }) =>
                    setMode(detail.selectedId as 'expert' | 'simple' | 'assembler')
                  }
                  options={[
                    { id: 'simple', text: '질의 드라이버' },
                    { id: 'assembler', text: '컬럼 조립 (D&D)' },
                    { id: 'expert', text: 'YAML (Expert)' },
                  ]}
                />
              }
            >
              매핑
            </Header>
          }
        >
          {mode === 'expert' ? (
            <FormField
              label="매핑 YAML"
              description="Expert 모드 — YAML 직접 편집. 다른 모드의 변경이 이 YAML에 반영됩니다."
            >
              <Textarea
                value={yamlText}
                onChange={({ detail }) => setYamlText(detail.value)}
                rows={24}
                spellcheck={false}
              />
            </FormField>
          ) : mode === 'simple' ? (
            <QuestionDrivenEditor
              slot={slotId}
              name={schemaName}
              description={schemaDesc}
              initialSelectedQuestions={selectedQuestions}
              presetVersion={presetVersion}
              onChange={onQuestionDrivenChange}
            />
          ) : (
            <ColumnAssembler
              slot={slotId}
              presetVersion={presetVersion}
              presetKind={assemblerPreset}
              onChange={(payload: { yaml: string; state: AssemblerState }) => {
                setYamlText(payload.yaml);
              }}
            />
          )}
        </Container>

        {error && <Alert type="error">{error}</Alert>}

        {finished && (
          <Alert type="success" header={`완료 (${finished.ms} ms)`}>
            Vertex {finished.vertex}건, Edge {finished.edge}건 적재 완료.
          </Alert>
        )}

        {steps.length > 0 && (
          <Container
            header={
              <Header variant="h2" counter={`(${steps.filter((s) => s.status === 'done').length}/${steps.length})`}>
                진행 상황
              </Header>
            }
          >
            <Table
              variant="embedded"
              items={steps}
              columnDefinitions={[
                {
                  id: 'status',
                  header: 'Status',
                  width: 110,
                  cell: (s) =>
                    s.status === 'done' ? (
                      <StatusIndicator type="success">done</StatusIndicator>
                    ) : s.status === 'running' ? (
                      <StatusIndicator type="in-progress">running</StatusIndicator>
                    ) : s.status === 'error' ? (
                      <StatusIndicator type="error">error</StatusIndicator>
                    ) : (
                      <StatusIndicator type="pending">pending</StatusIndicator>
                    ),
                },
                { id: 'name', header: 'Step', cell: (s) => <b>{s.name}</b> },
                {
                  id: 'progress',
                  header: 'Progress',
                  cell: (s) =>
                    s.total > 0 ? (
                      <ProgressBar
                        value={(s.processed / s.total) * 100}
                        additionalInfo={`${s.processed}/${s.total}`}
                      />
                    ) : (
                      <Box color="text-status-inactive">—</Box>
                    ),
                },
                {
                  id: 'elapsed',
                  header: 'ms',
                  width: 80,
                  cell: (s) => (s.elapsedMs != null ? `${s.elapsedMs}` : '—'),
                },
                {
                  id: 'err',
                  header: 'Note',
                  cell: (s) => (s.error ? <Box color="text-status-error" fontSize="body-s">{s.error}</Box> : ''),
                },
              ]}
            />
          </Container>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}

type SnapshotItem = {
  id: string;
  name: string;
  description?: string;
  sourcePreset?: string;
  updatedAt: string;
};

function SnapshotLoadModal({
  visible,
  snapshots,
  loadingId,
  onDismiss,
  onLoad,
  onDelete,
}: {
  visible: boolean;
  snapshots: SnapshotItem[];
  loadingId: string | null;
  onDismiss: () => void;
  onLoad: (id: string) => Promise<void> | void;
  onDelete: (id: string, name: string) => Promise<void> | void;
}) {
  const { items, filterProps, filteredItemsCount, paginationProps, collectionProps } =
    useCollection(snapshots, {
      filtering: {
        empty: (
          <Box textAlign="center" color="text-status-inactive" padding="m">
            저장된 스냅샷이 없습니다. 먼저 📁 저장 버튼으로 스냅샷을 만드세요.
          </Box>
        ),
        noMatch: (
          <Box textAlign="center" color="text-status-inactive" padding="m">
            검색 결과가 없습니다.
          </Box>
        ),
        filteringFunction: (item, text) => {
          if (!text) return true;
          const q = text.toLowerCase();
          return (
            item.name.toLowerCase().includes(q) ||
            (item.description ?? '').toLowerCase().includes(q) ||
            (item.sourcePreset ?? '').toLowerCase().includes(q)
          );
        },
      },
      pagination: { pageSize: 6 },
      sorting: {},
    });

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      header={`스냅샷 불러오기 (${snapshots.length})`}
      size="large"
      footer={
        <Box float="right">
          <Button onClick={onDismiss}>닫기</Button>
        </Box>
      }
    >
      <Cards
        {...collectionProps}
        items={items}
        loadingText="로드 중"
        cardDefinition={{
          header: (item) => (
            <Box fontWeight="bold" fontSize="heading-s">
              {item.name}
            </Box>
          ),
          sections: [
            {
              id: 'desc',
              content: (item) =>
                item.description ? (
                  <Box fontSize="body-s">{item.description}</Box>
                ) : (
                  <Box fontSize="body-s" color="text-status-inactive">
                    —
                  </Box>
                ),
            },
            {
              id: 'meta',
              content: (item) => (
                <SpaceBetween direction="horizontal" size="xs">
                  {item.sourcePreset && (
                    <Badge color="blue">{item.sourcePreset}</Badge>
                  )}
                  <Box fontSize="body-s" color="text-status-inactive">
                    {new Date(item.updatedAt).toLocaleString()}
                  </Box>
                </SpaceBetween>
              ),
            },
            {
              id: 'actions',
              content: (item) => (
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    variant="primary"
                    loading={loadingId === item.id}
                    onClick={() => onLoad(item.id)}
                  >
                    이 슬롯에 불러오기
                  </Button>
                  <Button
                    iconName="remove"
                    onClick={() => onDelete(item.id, item.name)}
                  >
                    삭제
                  </Button>
                </SpaceBetween>
              ),
            },
          ],
        }}
        cardsPerRow={[{ cards: 1 }, { minWidth: 600, cards: 2 }]}
        filter={
          <TextFilter
            {...filterProps}
            countText={`${filteredItemsCount} 건`}
            filteringPlaceholder="이름·설명·프리셋으로 검색"
          />
        }
        pagination={<Pagination {...paginationProps} />}
        empty={
          <Box textAlign="center" color="text-status-inactive" padding="l">
            저장된 스냅샷이 없습니다.
          </Box>
        }
      />
    </Modal>
  );
}
