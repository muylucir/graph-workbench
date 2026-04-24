'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import Textarea from '@cloudscape-design/components/textarea';
import Alert from '@cloudscape-design/components/alert';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import FormField from '@cloudscape-design/components/form-field';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';

type CypherResult = {
  columns: string[];
  rows: unknown[][];
  raw: { results?: Array<Record<string, unknown>> };
  elapsedMs: number;
};

const SAMPLES = [
  { id: 'count', label: 'vertex count by label', q: 'MATCH (n) RETURN labels(n)[0] AS label, count(*) AS cnt ORDER BY cnt DESC' },
  { id: 'edges', label: 'edge count by type', q: 'MATCH ()-[r]->() RETURN type(r) AS type, count(*) AS cnt ORDER BY cnt DESC' },
  { id: 'covisit', label: 'CO_VISITED 오사카성 상위 5', q: "MATCH (a:Attraction)-[r:CO_VISITED]-(b:Attraction) WHERE a.landmarkNameKo CONTAINS '오사카성' RETURN b.landmarkNameKo AS name, r.support AS support ORDER BY support DESC LIMIT 5" },
  { id: 'near', label: '오사카 NEAR_CITY 이웃', q: "MATCH (:City {_id:'OSA'})-[r:NEAR_CITY]-(c:City) RETURN c.cityName AS city, r.distanceKm AS km ORDER BY km" },
  { id: 'product', label: 'SaleProduct 1-hop 그래프', q: "MATCH (sp:SaleProduct {_id:'JOP1302603307CS'})-[r]->(m) RETURN sp, r, m LIMIT 100" },
];

const LABEL_COLORS: Record<string, string> = {
  SaleProduct: '#FFA500', RepresentativeProduct: '#FFDAB9',
  City: '#B0E0E6', Country: '#FFB6C1', Prefecture: '#F4A460',
  Attraction: '#90EE90', Hotel: '#DDA0DD', HotelStay: '#F0E68C',
  FlightSegment: '#FFEFD5', Airport: '#ADD8E6', Airline: '#F5DEB3',
  DepartureMarket: '#E0FFFF', Theme: '#FFE4E1', Mood: '#E6E6FA', Season: '#FAFAD2',
};

function extractGraph(result: CypherResult) {
  const nodes = new Map<string, ElementDefinition>();
  const edges: ElementDefinition[] = [];
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o['~entityType'] === 'node' || (o['~id'] && o['~labels'])) {
      const id = String(o['~id']);
      if (!nodes.has(id)) {
        const rawLabel = Array.isArray(o['~labels']) ? (o['~labels'] as string[])[0] : 'Node';
        const label = rawLabel.replace(/__[ABC]$/, '');
        const props = (o['~properties'] as Record<string, unknown>) ?? {};
        nodes.set(id, {
          data: {
            id,
            label:
              (props.landmarkNameKo as string) ??
              (props.name as string) ??
              (props.cityName as string) ??
              (props.htlKoNm as string) ??
              (props._id as string) ??
              id.slice(-8),
            kind: label,
            raw: { id, label, properties: props },
          },
          classes: label,
        });
      }
    } else if (o['~entityType'] === 'relationship' || (o['~start'] && o['~end'])) {
      const id = String(o['~id'] ?? `${o['~start']}->${o['~end']}`);
      const rawType = String(o['~type'] ?? '');
      edges.push({
        data: {
          id,
          source: String(o['~start']),
          target: String(o['~end']),
          label: rawType.replace(/__[ABC]$/, ''),
          raw: o,
        },
      });
    } else {
      Object.values(o).forEach(walk);
    }
  };
  walk(result.raw?.results ?? []);
  return { elements: [...nodes.values(), ...edges], nodeCount: nodes.size, edgeCount: edges.length };
}

export default function CypherPage() {
  const [slot, setSlot] = useState<'A' | 'B' | 'C'>('B');
  const [query, setQuery] = useState<string>(SAMPLES[0].q);
  const [result, setResult] = useState<CypherResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'table' | 'graph'>('table');
  const [selectedNode, setSelectedNode] = useState<{ id: string; label: string; properties: Record<string, unknown> } | null>(null);
  const cyRef = useRef<HTMLDivElement | null>(null);
  const cyInst = useRef<Core | null>(null);

  async function run() {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch('/api/neptune/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, slot }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const graph = useMemo(
    () => (result ? extractGraph(result) : { elements: [], nodeCount: 0, edgeCount: 0 }),
    [result],
  );

  useEffect(() => {
    if (view !== 'graph' || !cyRef.current || graph.elements.length === 0) return;
    if (cyInst.current) { cyInst.current.destroy(); cyInst.current = null; }
    const cy = cytoscape({
      container: cyRef.current,
      elements: graph.elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (el) => LABEL_COLORS[el.data('kind')] ?? '#CCCCCC',
            label: 'data(label)', 'font-size': 10,
            color: '#000', 'text-valign': 'bottom', 'text-halign': 'center',
            'text-margin-y': 4, width: 28, height: 28,
            'border-width': 1, 'border-color': '#555',
          },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)', 'font-size': 8, color: '#666',
            'line-color': '#aaa', 'target-arrow-color': '#aaa',
            'target-arrow-shape': 'triangle', 'curve-style': 'bezier', width: 1,
          },
        },
      ],
      layout: { name: 'cose', animate: false, fit: true, padding: 30 },
    });
    cy.on('tap', 'node', (evt) => setSelectedNode(evt.target.data('raw')));
    cyInst.current = cy;
    return () => { cy.destroy(); };
  }, [graph, view]);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="openCypher 쿼리를 슬롯별로 실행. 라벨 suffix는 자동 주입됨 (:Attraction → :Attraction__B)"
        >
          Cypher Console
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Container header={<Header variant="h3">슬롯 선택</Header>}>
          <SegmentedControl
            selectedId={slot}
            onChange={({ detail }) => setSlot(detail.selectedId as 'A' | 'B' | 'C')}
            options={[{ id: 'A', text: 'Slot A' }, { id: 'B', text: 'Slot B' }, { id: 'C', text: 'Slot C' }]}
          />
        </Container>

        <Container header={<Header variant="h2">쿼리</Header>}>
          <SpaceBetween size="m">
            <SpaceBetween size="xs" direction="horizontal">
              {SAMPLES.map((s) => (
                <Button key={s.id} onClick={() => setQuery(s.q)}>{s.label}</Button>
              ))}
            </SpaceBetween>
            <FormField label="openCypher">
              <Textarea value={query} onChange={({ detail }) => setQuery(detail.value)} rows={8} spellcheck={false} />
            </FormField>
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="primary" onClick={run} loading={loading}>Run</Button>
              <SegmentedControl
                selectedId={view}
                onChange={({ detail }) => setView(detail.selectedId as 'table' | 'graph')}
                options={[{ id: 'table', text: 'Table' }, { id: 'graph', text: 'Graph' }]}
              />
            </SpaceBetween>
          </SpaceBetween>
        </Container>

        {error && <Alert type="error">{error}</Alert>}

        {result && (
          <Container
            header={
              <Header
                variant="h2"
                counter={`(${result.rows.length} rows · ${result.elapsedMs} ms)`}
              >
                결과 (Slot {slot})
              </Header>
            }
          >
            {view === 'table' ? (
              <Table
                variant="embedded"
                stickyHeader
                resizableColumns
                columnDefinitions={result.columns.map((c, i) => ({
                  id: c,
                  header: c,
                  cell: (row: unknown[]) => {
                    const v = row[i];
                    if (v == null) return <Box color="text-status-inactive">NULL</Box>;
                    if (typeof v === 'object') return JSON.stringify(v).slice(0, 200);
                    const s = String(v);
                    return s.length > 120 ? s.slice(0, 120) + '…' : s;
                  },
                }))}
                items={result.rows}
                empty={<Box textAlign="center">No rows</Box>}
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 16 }}>
                <div
                  ref={cyRef}
                  style={{ height: 520, border: '1px solid #e9ebed', borderRadius: 8, background: '#fafbfc' }}
                />
                <Box>
                  <Header variant="h3">선택 노드</Header>
                  {!selectedNode && <Box color="text-status-inactive">노드 클릭</Box>}
                  {selectedNode && (
                    <SpaceBetween size="xs">
                      <StatusIndicator type="info">{selectedNode.label}</StatusIndicator>
                      <Box fontSize="body-s">{selectedNode.id}</Box>
                      <Box>
                        <pre style={{ fontSize: 11, margin: 0, whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(selectedNode.properties, null, 2).slice(0, 1000)}
                        </pre>
                      </Box>
                    </SpaceBetween>
                  )}
                </Box>
              </div>
            )}
          </Container>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
