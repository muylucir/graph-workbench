'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import type { AssemblerState } from '@/lib/column-assembler';

const LABEL_COLORS: Record<string, string> = {
  SaleProduct: '#FFA500',
  RepresentativeProduct: '#FFDAB9',
  City: '#B0E0E6',
  Country: '#FFB6C1',
  Prefecture: '#F4A460',
  Attraction: '#90EE90',
  Hotel: '#DDA0DD',
  HotelStay: '#F0E68C',
  FlightSegment: '#FFEFD5',
  Airport: '#ADD8E6',
  Airline: '#F5DEB3',
  DepartureMarket: '#E0FFFF',
  Theme: '#FFE4E1',
  Mood: '#E6E6FA',
  Season: '#FAFAD2',
};

function colorFor(label: string): string {
  return LABEL_COLORS[label] ?? '#CCCCCC';
}

function kindGlyph(kind: string): string {
  if (kind === 'json_explode') return '{ }';
  if (kind === 'csv_explode') return 'a,b';
  if (kind === 'distinct') return 'Δ';
  return '';
}

export default function AssemblerGraphPreview({
  state,
  height = 420,
}: {
  state: AssemblerState;
  height?: number;
}) {
  const cyRef = useRef<HTMLDivElement | null>(null);
  const cyInst = useRef<Core | null>(null);
  const [selected, setSelected] = useState<
    | { kind: 'node'; id: string; label: string; info: string }
    | { kind: 'edge'; id: string; type: string; info: string }
    | null
  >(null);

  const elements: ElementDefinition[] = useMemo(() => {
    const nodes: ElementDefinition[] = state.nodes.map((n) => {
      const glyph = kindGlyph(n.kind);
      const label = glyph ? `${n.label} ${glyph}` : n.label;
      return {
        data: {
          id: n.id,
          label,
          kind: n.label,
          rawKind: n.kind,
          info: [
            `label: ${n.label}`,
            `from: ${n.source.table}${n.source.column ? '.' + n.source.column : ''}`,
            `kind: ${n.kind}`,
            `id: ${n.pk}`,
            n.properties.length > 0
              ? 'props:\n  ' + n.properties.map((p) => `${p.name} = ${p.expr}`).join('\n  ')
              : 'props: (none)',
          ].join('\n'),
        },
      };
    });

    // Derived 노드도 표현 (가상 vertex)
    const derivedNodes: ElementDefinition[] = state.derived.map((d) => ({
      data: {
        id: `derived:${d.id}`,
        label: `⚙ ${d.type}`,
        kind: 'Derived',
        info: `derived edge\nkind: ${d.kind}\nparams: ${JSON.stringify(d.params)}`,
      },
      classes: 'derived',
    }));

    const edges: ElementDefinition[] = state.edges.map((e) => ({
      data: {
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        label: e.type,
        info: [
          `type: ${e.type}`,
          `from table: ${e.fromTable}`,
          `source.match_by: ${e.sourceMatchBy}`,
          `target.match_by: ${e.targetMatchBy}`,
          e.explodeJson ? `explode_json: ${e.explodeJson}` : '',
          e.explodeCsv ? `explode_csv: ${e.explodeCsv}` : '',
          e.where ? `where: ${e.where}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      },
    }));

    return [...nodes, ...derivedNodes, ...edges];
  }, [state]);

  // Detect "full reset" transitions (e.g. flat→empty→flat). When the previous
  // graph had zero nodes and now has many (or vice versa), tear down and recreate.
  const prevElementCountRef = useRef<number>(0);

  useEffect(() => {
    if (!cyRef.current) return;

    const prevCount = prevElementCountRef.current;
    const nextCount = elements.length;
    prevElementCountRef.current = nextCount;

    const majorReset =
      cyInst.current != null &&
      ((prevCount === 0 && nextCount > 0) || (prevCount > 0 && nextCount === 0));

    if (majorReset && cyInst.current) {
      try {
        cyInst.current.destroy();
      } catch {
        /* ignore */
      }
      cyInst.current = null;
    }

    // Defensive incremental update
    if (cyInst.current) {
      const cy = cyInst.current;
      try {
        cy.batch(() => {
          const existingIds = new Set<string>();
          cy.elements().forEach((el) => {
            existingIds.add(el.id());
          });
          const nextIds = new Set<string>(
            elements.map((e) => String(e.data?.id ?? '')).filter(Boolean),
          );

          // Remove obsolete (collect first to avoid iterator invalidation)
          const toRemove: string[] = [];
          existingIds.forEach((id) => {
            if (!nextIds.has(id)) toRemove.push(id);
          });
          for (const id of toRemove) {
            const el = cy.getElementById(id);
            if (el && el.length > 0) el.remove();
          }

          // Add new or refresh existing
          for (const el of elements) {
            const id = String(el.data?.id ?? '');
            if (!id) continue;
            const existing = cy.getElementById(id);
            if (!existing || existing.length === 0) {
              cy.add(el);
            } else {
              if (el.data?.label != null) existing.data('label', el.data.label);
              if (el.data?.info != null) existing.data('info', el.data.info);
              if (el.data?.kind != null) existing.data('kind', el.data.kind);
            }
          }

          const topologyChanged =
            existingIds.size !== nextIds.size ||
            [...nextIds].some((id) => !existingIds.has(id)) ||
            toRemove.length > 0;
          if (topologyChanged && cy.elements().length > 0) {
            cy.layout({ name: 'cose', animate: false, fit: true, padding: 30 }).run();
          }
        });
      } catch (err) {
        // If incremental update fails (e.g. after going empty→non-empty), rebuild fresh.
        console.warn('[AssemblerGraphPreview] incremental failed, rebuilding', err);
        try {
          cy.destroy();
        } catch {
          /* ignore */
        }
        cyInst.current = null;
        // Fall through to create a new instance below.
      }
      if (cyInst.current) return;
    }

    // First init (or post-failure reinit)
    const cy = cytoscape({
      container: cyRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': (el) => colorFor(el.data('kind')),
            label: 'data(label)',
            'font-size': 11,
            'font-weight': 'bold',
            color: '#000',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': 100,
            width: 'label' as unknown as number,
            height: 'label' as unknown as number,
            padding: '8px' as unknown as number,
            shape: 'round-rectangle',
            'border-width': 1.5,
            'border-color': '#2c3440',
          },
        },
        {
          selector: 'node.derived',
          style: {
            'background-color': '#ffe7ba',
            'border-style': 'dashed',
            'border-color': '#d97706',
            shape: 'ellipse',
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': '#0972d3' },
        },
        {
          selector: 'edge',
          style: {
            label: 'data(label)',
            'font-size': 9,
            color: '#444',
            'line-color': '#aaa',
            'target-arrow-color': '#aaa',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            width: 1.5,
            'text-background-color': '#fff',
            'text-background-opacity': 0.9,
            'text-background-padding': '2px' as unknown as number,
          },
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#0972d3',
            'target-arrow-color': '#0972d3',
            width: 2.5,
          },
        },
      ],
      layout:
        elements.length > 0
          ? { name: 'cose', animate: false, fit: true, padding: 30 }
          : { name: 'preset' },
      wheelSensitivity: 0.2,
    });

    cy.on('tap', 'node', (evt) => {
      const d = evt.target.data();
      setSelected({ kind: 'node', id: d.id, label: d.kind, info: d.info });
    });
    cy.on('tap', 'edge', (evt) => {
      const d = evt.target.data();
      setSelected({ kind: 'edge', id: d.id, type: d.label, info: d.info });
    });
    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelected(null);
    });

    cyInst.current = cy;

    return () => {
      cy.destroy();
      cyInst.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  const isEmpty = state.nodes.length === 0 && state.edges.length === 0;

  return (
    <div style={{ display: 'flex', gap: 8, height: `${height}px` }}>
      <div
        ref={cyRef}
        style={{
          flex: 1,
          minWidth: 0,
          border: '1px solid #e9ebed',
          borderRadius: 8,
          background: '#fafbfc',
          position: 'relative',
        }}
      >
        {isEmpty && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#888',
              fontSize: 13,
              pointerEvents: 'none',
            }}
          >
            노드·엣지를 추가하면 여기에 그래프가 그려집니다.
          </div>
        )}
      </div>
      <div
        style={{
          width: 240,
          padding: 10,
          border: '1px solid #e9ebed',
          borderRadius: 8,
          background: '#fff',
          fontSize: 12,
          overflowY: 'auto',
        }}
      >
        {selected == null ? (
          <div style={{ color: '#888' }}>
            <b>그래프 미리보기</b>
            <div style={{ marginTop: 6 }}>
              노드 {state.nodes.length}개 · 엣지 {state.edges.length}개 · 파생{' '}
              {state.derived.length}개
            </div>
            <div style={{ marginTop: 10, color: '#555' }}>
              노드·엣지를 클릭하면 상세가 여기에 표시됩니다.
            </div>
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #eee' }}>
              <b style={{ fontSize: 11 }}>범례</b>
              <div style={{ marginTop: 4, fontSize: 11 }}>
                사각형 = Vertex
                <br />
                점선 타원 = Derived edge (원본에 없음)
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 6 }}>
              {selected.kind === 'node' ? (
                <span
                  style={{
                    background: colorFor(selected.label),
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontWeight: 'bold',
                  }}
                >
                  NODE · {selected.label}
                </span>
              ) : (
                <span
                  style={{
                    background: '#d1ecf7',
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontWeight: 'bold',
                  }}
                >
                  EDGE · {selected.type}
                </span>
              )}
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              {selected.info}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
