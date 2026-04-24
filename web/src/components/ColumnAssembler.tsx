'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  useDraggable,
  useDroppable,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import Select, { SelectProps } from '@cloudscape-design/components/select';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Modal from '@cloudscape-design/components/modal';
import RuleBuilder from './RuleBuilder';
import {
  type AssemblerState,
  type NodeDef,
  type EdgeDef,
  emptyState,
  flatPresetState,
  stateToYaml,
  coveredQuestionIds,
  stateMetrics,
} from '@/lib/column-assembler';
import AssemblerGraphPreview from './AssemblerGraphPreview';

type TableInfo = {
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; pk: number; notnull: number }>;
};

export type ColumnAssemblerPresetKind = 'flat' | 'phase1' | 'extended' | 'empty' | 'custom';

type Props = {
  slot: 'A' | 'B' | 'C';
  /** Incremented by parent whenever a preset is loaded. */
  presetVersion?: number;
  /** Which preset to reset to on presetVersion change. */
  presetKind?: ColumnAssemblerPresetKind;
  onChange: (payload: { yaml: string; state: AssemblerState }) => void;
};

// ──────────────────────────────────────────────────────────
// Draggable column chip
// ──────────────────────────────────────────────────────────
function DraggableColumn({ table, col }: { table: string; col: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `col:${table}.${col}`,
    data: { table, column: col },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        padding: '4px 8px',
        background: isDragging ? '#eee' : '#fff',
        border: '1px solid #d5dbdb',
        borderRadius: 4,
        fontSize: 12,
        cursor: 'grab',
        marginBottom: 2,
        display: 'inline-block',
        marginRight: 4,
      }}
    >
      ◆ {col}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Droppable node card
// ──────────────────────────────────────────────────────────
function NodeCard({
  node,
  onRemove,
  onEdit,
}: {
  node: NodeDef;
  onRemove: () => void;
  onEdit: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `node:${node.id}`,
    data: { kind: 'node', nodeId: node.id },
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 100,
        padding: 10,
        background: isOver ? '#d1ecf7' : '#fff',
        border: `2px ${isOver ? 'dashed' : 'solid'} ${isOver ? '#0972d3' : '#d5dbdb'}`,
        borderRadius: 8,
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <StatusIndicator type="info">{node.label}</StatusIndicator>
          <Box fontSize="body-s" color="text-status-inactive">
            from {node.source.table}
            {node.source.column ? `.${node.source.column}` : ''}
            {' · '} kind: {node.kind}
          </Box>
        </div>
        <SpaceBetween direction="horizontal" size="xxs">
          <Button iconName="edit" variant="inline-icon" onClick={onEdit} ariaLabel="edit" />
          <Button iconName="remove" variant="inline-icon" onClick={onRemove} ariaLabel="remove" />
        </SpaceBetween>
      </div>
      <Box fontSize="body-s">
        <b>id:</b> <code>{node.pk}</code>
      </Box>
      <Box fontSize="body-s">
        <b>props:</b>{' '}
        {node.properties.length === 0 ? (
          <span style={{ color: '#999' }}>(없음 — 컬럼을 여기로 드래그)</span>
        ) : (
          node.properties.map((p) => `${p.name}=${p.expr}`).join(', ')
        )}
      </Box>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────
export default function ColumnAssembler({
  slot,
  presetVersion,
  presetKind,
  onChange,
}: Props) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [state, setState] = useState<AssemblerState>(flatPresetState(slot));

  // Resync state when parent signals a preset change.
  useEffect(() => {
    if (presetVersion == null) return;
    const kind = presetKind ?? 'flat';
    if (kind === 'empty') setState(emptyState(slot));
    else setState(flatPresetState(slot));
    // (For phase1/extended/custom we fall back to flat as a starting point,
    // since we don't yet parse full YAML back into assembler state.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetVersion]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropModal, setDropModal] = useState<{
    table: string;
    column: string;
    nodeId: string;
  } | null>(null);
  const [newNodeModal, setNewNodeModal] = useState<boolean>(false);
  const [editNode, setEditNode] = useState<NodeDef | null>(null);
  const [addEdgeModal, setAddEdgeModal] = useState<boolean>(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  useEffect(() => {
    fetch('/api/sqlite/tables')
      .then((r) => r.json())
      .then((d) => setTables(d.tables ?? []));
  }, []);

  useEffect(() => {
    // always sync slot
    if (state.slot !== slot) setState((s) => ({ ...s, slot }));
  }, [slot, state.slot]);

  // Propagate YAML upward whenever state changes
  useEffect(() => {
    const yaml = stateToYaml(state);
    onChange({ yaml, state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const metrics = useMemo(() => stateMetrics(state), [state]);
  const covered = useMemo(() => coveredQuestionIds(state), [state]);

  function onDragStart(ev: DragStartEvent) {
    setDragging(String(ev.active.id));
  }
  function onDragEnd(ev: DragEndEvent) {
    setDragging(null);
    const src = ev.active.data.current as { table?: string; column?: string } | undefined;
    const tgt = ev.over?.data.current as { kind?: string; nodeId?: string } | undefined;
    if (!src?.table || !src.column) return;
    if (tgt?.kind === 'node' && tgt.nodeId) {
      setDropModal({ table: src.table, column: src.column, nodeId: tgt.nodeId });
    }
  }

  function applyDrop(
    role: 'pk' | 'prop' | 'fk' | 'json_explode' | 'csv_explode' | 'edge_prop',
    extras?: {
      alias?: string;
      edgeType?: string;
      targetNodeId?: string;
      targetMatchBy?: string;
    },
  ) {
    if (!dropModal) return;
    const { table, column, nodeId } = dropModal;
    setState((prev) => {
      const node = prev.nodes.find((n) => n.id === nodeId);
      if (!node) return prev;
      // If node is bound to a different table, warn silently — overwrite table
      const next: AssemblerState = { ...prev, nodes: prev.nodes.map((n) => ({ ...n })) };
      const tgtNode = next.nodes.find((n) => n.id === nodeId)!;

      if (role === 'pk') {
        tgtNode.source = { ...tgtNode.source, table };
        tgtNode.pk = column;
      } else if (role === 'prop') {
        tgtNode.source = { ...tgtNode.source, table };
        const alias = extras?.alias || column;
        if (!tgtNode.properties.some((p) => p.name === alias)) {
          tgtNode.properties = [...tgtNode.properties, { name: alias, expr: column }];
        }
      } else if (role === 'fk') {
        // add edge from this node to target node
        const target = next.nodes.find((n) => n.id === extras?.targetNodeId);
        if (target && extras?.edgeType && extras.targetMatchBy) {
          next.edges = [
            ...next.edges,
            {
              id: `e_${Date.now()}`,
              type: extras.edgeType,
              fromTable: table,
              fromNodeId: nodeId,
              toNodeId: extras.targetNodeId!,
              sourceMatchBy: tgtNode.pk,
              targetMatchBy: extras.targetMatchBy,
              where: `${column} IS NOT NULL`,
            },
          ];
        }
      } else if (role === 'json_explode' || role === 'csv_explode') {
        // create new tag-style vertex + edge from current node
        const newLabel = extras?.alias || column.replace(/[^A-Za-z]/g, '') || 'Tag';
        const newNodeId = `n_${newLabel.toLowerCase()}_${Date.now()}`;
        const newNode: NodeDef = {
          id: newNodeId,
          label: newLabel,
          kind: role === 'json_explode' ? 'json_explode' : 'csv_explode',
          source: { table, column },
          pk: '$item',
          properties: [{ name: 'code', expr: '$item' }],
        };
        next.nodes = [...next.nodes, newNode];
        next.edges = [
          ...next.edges,
          {
            id: `e_${Date.now()}`,
            type: `HAS_${newLabel.toUpperCase()}`,
            fromTable: table,
            fromNodeId: nodeId,
            toNodeId: newNodeId,
            sourceMatchBy: tgtNode.pk,
            targetMatchBy: '$item',
            explodeJson: role === 'json_explode' ? column : undefined,
            explodeCsv: role === 'csv_explode' ? column : undefined,
          },
        ];
      }
      return next;
    });
    setDropModal(null);
  }

  function addEmptyNode(label: string, table: string, pkCol: string) {
    setState((prev) => ({
      ...prev,
      nodes: [
        ...prev.nodes,
        {
          id: `n_${label.toLowerCase()}_${Date.now()}`,
          label,
          kind: 'direct',
          source: { table },
          pk: pkCol,
          properties: [],
        },
      ],
    }));
  }

  function removeNode(nodeId: string) {
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      edges: prev.edges.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
    }));
  }

  function addEdge(e: Omit<EdgeDef, 'id'>) {
    setState((prev) => ({
      ...prev,
      edges: [...prev.edges, { ...e, id: `e_${Date.now()}` }],
    }));
  }

  function removeEdge(edgeId: string) {
    setState((prev) => ({ ...prev, edges: prev.edges.filter((e) => e.id !== edgeId) }));
  }

  function resetTo(preset: 'empty' | 'flat') {
    if (preset === 'empty') setState(emptyState(slot));
    else setState(flatPresetState(slot));
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <SpaceBetween size="l">
        <Alert type="info">
          컬럼을 드래그해서 노드 카드에 떨어뜨리면 역할(PK / Property / FK Edge / JSON·CSV 분해)을 선택합니다.
          <br />
          현재: <b>Vertex {metrics.vertex}</b> · <b>Edge {metrics.edge}</b> ·{' '}
          <b>Derived {metrics.derived}</b> · 사용 테이블 {metrics.usedTables}개 · 풀리는 질의{' '}
          <b>{covered.length}/16</b>
          {covered.length > 0 && <> ({covered.join(', ')})</>}
        </Alert>

        <Container
          header={
            <Header
              variant="h3"
              description="조립 중인 매핑을 실시간으로 그래프로 시각화. 노드·엣지 클릭 시 상세 표시."
            >
              그래프 미리보기
            </Header>
          }
        >
          <AssemblerGraphPreview state={state} height={420} />
        </Container>

        <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0,1fr)', gap: 16 }}>
          {/* 컬럼 팔레트 */}
          <Container
            header={
              <Header
                variant="h3"
                actions={
                  <ButtonDropdown
                    items={[
                      { id: 'flat', text: 'Flat 프리셋에서 시작' },
                      { id: 'empty', text: '빈 상태로 초기화' },
                    ]}
                    onItemClick={({ detail }) => resetTo(detail.id as 'empty' | 'flat')}
                  >
                    시작점
                  </ButtonDropdown>
                }
              >
                컬럼 팔레트
              </Header>
            }
          >
            <div style={{ maxHeight: 640, overflowY: 'auto' }}>
              {tables.map((t) => (
                <div key={t.name} style={{ marginBottom: 12 }}>
                  <Box fontWeight="bold" fontSize="body-s">
                    {t.name}{' '}
                    <span style={{ color: '#888', fontWeight: 400 }}>({t.rowCount}행)</span>
                  </Box>
                  <div style={{ marginTop: 4 }}>
                    {t.columns.map((c) => (
                      <DraggableColumn key={c.name} table={t.name} col={c.name} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Container>

          {/* 노드/엣지 캔버스 */}
          <SpaceBetween size="m">
            <Container
              header={
                <Header
                  variant="h3"
                  counter={`(${state.nodes.length})`}
                  actions={
                    <Button onClick={() => setNewNodeModal(true)}>+ 새 노드</Button>
                  }
                >
                  Vertex
                </Header>
              }
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: 8,
                }}
              >
                {state.nodes.length === 0 && (
                  <Box color="text-status-inactive">
                    "+ 새 노드" 또는 상단 "시작점 → Flat" 을 눌러 노드를 만드세요.
                  </Box>
                )}
                {state.nodes.map((n) => (
                  <NodeCard
                    key={n.id}
                    node={n}
                    onRemove={() => removeNode(n.id)}
                    onEdit={() => setEditNode(n)}
                  />
                ))}
              </div>
            </Container>

            <Container
              header={
                <Header
                  variant="h3"
                  counter={`(${state.edges.length})`}
                  actions={
                    <Button
                      onClick={() => setAddEdgeModal(true)}
                      disabled={state.nodes.length < 2}
                    >
                      + Edge 추가
                    </Button>
                  }
                >
                  Edges
                </Header>
              }
            >
              {state.edges.length === 0 ? (
                <Box color="text-status-inactive">엣지 없음</Box>
              ) : (
                <SpaceBetween size="xs">
                  {state.edges.map((e) => {
                    const fromLabel =
                      state.nodes.find((n) => n.id === e.fromNodeId)?.label ?? e.fromNodeId;
                    const toLabel =
                      state.nodes.find((n) => n.id === e.toNodeId)?.label ?? e.toNodeId;
                    return (
                      <div
                        key={e.id}
                        style={{
                          padding: '6px 10px',
                          border: '1px solid #e9ebed',
                          borderRadius: 6,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div style={{ fontSize: 13 }}>
                          <b>{fromLabel}</b>
                          <span style={{ color: '#0972d3', margin: '0 6px' }}>
                            -[:{e.type}]-&gt;
                          </span>
                          <b>{toLabel}</b>
                          <Box fontSize="body-s" color="text-status-inactive">
                            from {e.fromTable}
                            {e.explodeJson ? ` · explode_json=${e.explodeJson}` : ''}
                            {e.explodeCsv ? ` · explode_csv=${e.explodeCsv}` : ''}
                            {' · '}
                            source.match_by={e.sourceMatchBy} / target.match_by={e.targetMatchBy}
                          </Box>
                        </div>
                        <Button
                          iconName="remove"
                          variant="inline-icon"
                          onClick={() => removeEdge(e.id)}
                          ariaLabel="remove"
                        />
                      </div>
                    );
                  })}
                </SpaceBetween>
              )}
            </Container>

            <Container header={<Header variant="h3">관계 만들기 (원본 DB에 없는 관계)</Header>}>
              <RuleBuilder
                state={state}
                onChange={(deriveds) =>
                  setState((prev) => ({ ...prev, derived: deriveds }))
                }
                resyncToken={presetVersion}
              />
            </Container>
          </SpaceBetween>
        </div>
      </SpaceBetween>

      <DragOverlay>
        {dragging ? (
          <div
            style={{
              padding: '4px 8px',
              background: '#fff',
              border: '1px solid #0972d3',
              borderRadius: 4,
              fontSize: 12,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            }}
          >
            {dragging.replace(/^col:/, '◆ ')}
          </div>
        ) : null}
      </DragOverlay>

      {/* 드롭 역할 선택 모달 */}
      {dropModal && (
        <DropRoleModal
          state={state}
          drop={dropModal}
          onCancel={() => setDropModal(null)}
          onApply={applyDrop}
        />
      )}

      {newNodeModal && (
        <NewNodeModal
          tables={tables}
          onCancel={() => setNewNodeModal(false)}
          onCreate={(label, table, pkCol) => {
            addEmptyNode(label, table, pkCol);
            setNewNodeModal(false);
          }}
        />
      )}

      {editNode && (
        <EditNodeModal
          node={editNode}
          onCancel={() => setEditNode(null)}
          onSave={(updated) => {
            setState((prev) => ({
              ...prev,
              nodes: prev.nodes.map((n) => (n.id === updated.id ? updated : n)),
            }));
            setEditNode(null);
          }}
        />
      )}

      {addEdgeModal && (
        <AddEdgeModal
          state={state}
          onCancel={() => setAddEdgeModal(false)}
          onAdd={(edge) => {
            addEdge(edge);
            setAddEdgeModal(false);
          }}
        />
      )}
    </DndContext>
  );
}

// ──────────────────────────────────────────────────────────
// Modals
// ──────────────────────────────────────────────────────────

function DropRoleModal({
  state,
  drop,
  onCancel,
  onApply,
}: {
  state: AssemblerState;
  drop: { table: string; column: string; nodeId: string };
  onCancel: () => void;
  onApply: (
    role: 'pk' | 'prop' | 'fk' | 'json_explode' | 'csv_explode',
    extras?: {
      alias?: string;
      edgeType?: string;
      targetNodeId?: string;
      targetMatchBy?: string;
    },
  ) => void;
}) {
  const node = state.nodes.find((n) => n.id === drop.nodeId);
  const otherNodes = state.nodes.filter((n) => n.id !== drop.nodeId);
  const [role, setRole] = useState<'pk' | 'prop' | 'fk' | 'json_explode' | 'csv_explode'>(
    'prop',
  );
  const [alias, setAlias] = useState<string>(drop.column);
  const [edgeType, setEdgeType] = useState<string>('');
  const [targetNode, setTargetNode] = useState<SelectProps.Option | null>(null);
  const [targetMatchBy, setTargetMatchBy] = useState<string>('');

  return (
    <Modal
      visible
      header={`컬럼 ${drop.table}.${drop.column} → ${node?.label ?? ''}에 어떻게 매핑?`}
      onDismiss={onCancel}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button onClick={onCancel}>취소</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (role === 'fk') {
                onApply('fk', {
                  edgeType: edgeType || `REL_${drop.column.toUpperCase()}`,
                  targetNodeId: String(targetNode?.value ?? ''),
                  targetMatchBy: targetMatchBy || drop.column,
                });
              } else if (role === 'json_explode' || role === 'csv_explode') {
                onApply(role, { alias: alias || drop.column });
              } else {
                onApply(role, { alias });
              }
            }}
          >
            적용
          </Button>
        </div>
      }
    >
      <SpaceBetween size="s">
        <FormField label="역할">
          <Select
            selectedOption={{ label: roleLabel(role), value: role }}
            options={[
              { label: 'Vertex PK (노드 id로)', value: 'pk' },
              { label: 'Vertex Property (속성 추가)', value: 'prop' },
              { label: 'FK Edge (다른 노드로 관계)', value: 'fk' },
              { label: 'JSON 분해 (새 태그 노드 + edge)', value: 'json_explode' },
              { label: 'CSV 분해 (쉼표 분리 → edge)', value: 'csv_explode' },
            ]}
            onChange={({ detail }) =>
              setRole(
                detail.selectedOption.value as
                  | 'pk'
                  | 'prop'
                  | 'fk'
                  | 'json_explode'
                  | 'csv_explode',
              )
            }
          />
        </FormField>

        {role === 'prop' && (
          <FormField label="속성 이름 (별칭)">
            <Input value={alias} onChange={({ detail }) => setAlias(detail.value)} />
          </FormField>
        )}

        {role === 'fk' && (
          <SpaceBetween size="xs">
            <FormField label="Edge 타입" description="예: ATTRACTION_IN_CITY">
              <Input
                value={edgeType}
                onChange={({ detail }) => setEdgeType(detail.value.toUpperCase())}
              />
            </FormField>
            <FormField label="Target 노드">
              <Select
                selectedOption={targetNode}
                options={otherNodes.map((n) => ({ label: n.label, value: n.id }))}
                onChange={({ detail }) => setTargetNode(detail.selectedOption)}
                placeholder="타겟 노드 선택"
              />
            </FormField>
            <FormField
              label="Target match_by 컬럼"
              description="타겟 노드의 id 컬럼 이름 (예: city_code)"
            >
              <Input
                value={targetMatchBy}
                onChange={({ detail }) => setTargetMatchBy(detail.value)}
                placeholder={drop.column}
              />
            </FormField>
          </SpaceBetween>
        )}

        {(role === 'json_explode' || role === 'csv_explode') && (
          <FormField label="새 태그 노드의 label">
            <Input value={alias} onChange={({ detail }) => setAlias(detail.value)} />
          </FormField>
        )}
      </SpaceBetween>
    </Modal>
  );
}

function roleLabel(r: string): string {
  const map: Record<string, string> = {
    pk: 'Vertex PK',
    prop: 'Vertex Property',
    fk: 'FK Edge',
    json_explode: 'JSON 분해',
    csv_explode: 'CSV 분해',
  };
  return map[r] ?? r;
}

function NewNodeModal({
  tables,
  onCancel,
  onCreate,
}: {
  tables: TableInfo[];
  onCancel: () => void;
  onCreate: (label: string, table: string, pk: string) => void;
}) {
  const [label, setLabel] = useState('NewNode');
  const [table, setTable] = useState<SelectProps.Option | null>(null);
  const [pk, setPk] = useState('');

  return (
    <Modal
      visible
      header="새 노드"
      onDismiss={onCancel}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button onClick={onCancel}>취소</Button>
          <Button
            variant="primary"
            disabled={!label || !table || !pk}
            onClick={() => onCreate(label, String(table?.value ?? ''), pk)}
          >
            생성
          </Button>
        </div>
      }
    >
      <SpaceBetween size="s">
        <FormField label="Label">
          <Input value={label} onChange={({ detail }) => setLabel(detail.value)} />
        </FormField>
        <FormField label="소스 테이블">
          <Select
            selectedOption={table}
            options={tables.map((t) => ({ label: `${t.name} (${t.rowCount})`, value: t.name }))}
            onChange={({ detail }) => setTable(detail.selectedOption)}
          />
        </FormField>
        <FormField label="PK 컬럼" description="이 노드의 id로 쓸 컬럼 이름">
          <Input value={pk} onChange={({ detail }) => setPk(detail.value)} />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}

function EditNodeModal({
  node,
  onCancel,
  onSave,
}: {
  node: NodeDef;
  onCancel: () => void;
  onSave: (n: NodeDef) => void;
}) {
  const [label, setLabel] = useState(node.label);
  const [pk, setPk] = useState(node.pk);
  const [propsText, setPropsText] = useState(
    node.properties.map((p) => `${p.name}: ${p.expr}`).join('\n'),
  );

  return (
    <Modal
      visible
      header={`노드 편집 — ${node.label}`}
      onDismiss={onCancel}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button onClick={onCancel}>취소</Button>
          <Button
            variant="primary"
            onClick={() => {
              const props = propsText
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
                .map((l) => {
                  const m = l.split(':').map((x) => x.trim());
                  return { name: m[0], expr: m[1] ?? m[0] };
                });
              onSave({ ...node, label, pk, properties: props });
            }}
          >
            저장
          </Button>
        </div>
      }
    >
      <SpaceBetween size="s">
        <FormField label="Label">
          <Input value={label} onChange={({ detail }) => setLabel(detail.value)} />
        </FormField>
        <FormField label="PK expression">
          <Input value={pk} onChange={({ detail }) => setPk(detail.value)} />
        </FormField>
        <FormField
          label="Properties (한 줄에 하나, name: expr)"
          description="예:  cityName: city_name"
        >
          <textarea
            rows={6}
            value={propsText}
            onChange={(e) => setPropsText(e.target.value)}
            style={{
              width: '100%',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              padding: 6,
              borderRadius: 4,
              border: '1px solid #d5dbdb',
            }}
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}

function AddEdgeModal({
  state,
  onCancel,
  onAdd,
}: {
  state: AssemblerState;
  onCancel: () => void;
  onAdd: (e: Omit<EdgeDef, 'id'>) => void;
}) {
  const [type, setType] = useState('');
  const [fromNode, setFromNode] = useState<SelectProps.Option | null>(null);
  const [toNode, setToNode] = useState<SelectProps.Option | null>(null);
  const [fromTable, setFromTable] = useState('');
  const [sourceMatchBy, setSourceMatchBy] = useState('');
  const [targetMatchBy, setTargetMatchBy] = useState('');

  return (
    <Modal
      visible
      header="Edge 추가"
      onDismiss={onCancel}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
          <Button onClick={onCancel}>취소</Button>
          <Button
            variant="primary"
            disabled={!type || !fromNode || !toNode || !fromTable}
            onClick={() =>
              onAdd({
                type: type.toUpperCase(),
                fromTable,
                fromNodeId: String(fromNode!.value),
                toNodeId: String(toNode!.value),
                sourceMatchBy: sourceMatchBy || 'id',
                targetMatchBy: targetMatchBy || 'id',
              })
            }
          >
            추가
          </Button>
        </div>
      }
    >
      <SpaceBetween size="s">
        <FormField label="Edge 타입">
          <Input value={type} onChange={({ detail }) => setType(detail.value)} />
        </FormField>
        <FormField label="From 노드">
          <Select
            selectedOption={fromNode}
            options={state.nodes.map((n) => ({ label: n.label, value: n.id }))}
            onChange={({ detail }) => {
              setFromNode(detail.selectedOption);
              const n = state.nodes.find((x) => x.id === detail.selectedOption.value);
              if (n) {
                setFromTable(n.source.table);
                setSourceMatchBy(n.pk);
              }
            }}
          />
        </FormField>
        <FormField label="To 노드">
          <Select
            selectedOption={toNode}
            options={state.nodes.map((n) => ({ label: n.label, value: n.id }))}
            onChange={({ detail }) => {
              setToNode(detail.selectedOption);
              const n = state.nodes.find((x) => x.id === detail.selectedOption.value);
              if (n) setTargetMatchBy(n.pk);
            }}
          />
        </FormField>
        <FormField
          label="Driving 테이블"
          description="엣지 row들을 어떤 테이블에서 만들지 (보통 From 노드의 테이블)"
        >
          <Input value={fromTable} onChange={({ detail }) => setFromTable(detail.value)} />
        </FormField>
        <FormField label="Source match_by (From 노드의 id 컬럼)">
          <Input
            value={sourceMatchBy}
            onChange={({ detail }) => setSourceMatchBy(detail.value)}
          />
        </FormField>
        <FormField
          label="Target match_by"
          description="Driving 테이블에서 Target 노드를 찾을 컬럼명"
        >
          <Input
            value={targetMatchBy}
            onChange={({ detail }) => setTargetMatchBy(detail.value)}
          />
        </FormField>
      </SpaceBetween>
    </Modal>
  );
}
