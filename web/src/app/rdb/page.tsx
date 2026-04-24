'use client';

import { useEffect, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

type TableInfo = {
  name: string;
  rowCount: number;
  columns: Array<{ name: string; type: string; pk: number; notnull: number }>;
};

export default function RdbPage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<TableInfo | null>(null);
  const [sample, setSample] = useState<Array<Record<string, unknown>>>([]);

  useEffect(() => {
    fetch('/api/sqlite/tables')
      .then((r) => r.json())
      .then((d) => setTables(d.tables ?? []));
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetch(`/api/sqlite/tables?sample=${encodeURIComponent(selected.name)}`)
      .then((r) => r.json())
      .then((d) => setSample(d.rows ?? []));
  }, [selected]);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="osaka_subset SQLite — 11 tables. 이 원본이 모든 실험의 입력."
        >
          RDB Viewer
        </Header>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16 }}>
        <Container header={<Header variant="h3">Tables ({tables.length})</Header>}>
          <SpaceBetween size="xs">
            {tables.map((t) => (
              <div
                key={t.name}
                onClick={() => setSelected(t)}
                style={{
                  padding: 8,
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: selected?.name === t.name ? '#e0f7ff' : 'transparent',
                }}
              >
                <StatusIndicator type="success" />
                <b style={{ marginLeft: 6 }}>{t.name}</b>
                <Box color="text-status-inactive" fontSize="body-s">
                  {t.rowCount} rows · {t.columns.length} cols
                </Box>
              </div>
            ))}
          </SpaceBetween>
        </Container>

        <Container
          header={
            selected ? (
              <Header
                variant="h2"
                counter={`(${selected.rowCount} rows)`}
              >
                {selected.name}
              </Header>
            ) : (
              <Header variant="h2">테이블 선택</Header>
            )
          }
        >
          {selected && (
            <SpaceBetween size="l">
              <Box>
                <Header variant="h3">Columns</Header>
                <Table
                  variant="embedded"
                  columnDefinitions={[
                    { id: 'name', header: 'Name', cell: (c) => <b>{c.name}</b> },
                    { id: 'type', header: 'Type', cell: (c) => c.type },
                    {
                      id: 'flag',
                      header: 'Flag',
                      cell: (c) =>
                        (c.pk ? 'PK ' : '') + (c.notnull ? 'NN ' : ''),
                    },
                  ]}
                  items={selected.columns}
                />
              </Box>
              <Box>
                <Header variant="h3">Sample (first 5)</Header>
                <Table
                  variant="embedded"
                  columnDefinitions={
                    sample[0]
                      ? Object.keys(sample[0]).map((k) => ({
                          id: k,
                          header: k,
                          cell: (row: Record<string, unknown>) => {
                            const v = row[k];
                            if (v == null) return <Box color="text-status-inactive">NULL</Box>;
                            const s = String(v);
                            return s.length > 80 ? s.slice(0, 80) + '…' : s;
                          },
                        }))
                      : []
                  }
                  items={sample}
                />
              </Box>
            </SpaceBetween>
          )}
        </Container>
      </div>
    </ContentLayout>
  );
}
