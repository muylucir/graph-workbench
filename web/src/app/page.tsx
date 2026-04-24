'use client';

import { useEffect, useState } from 'react';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Container from '@cloudscape-design/components/container';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useRouter } from 'next/navigation';

type SlotState = {
  slot: 'A' | 'B' | 'C';
  yaml: string | null;
  mappingName: string | null;
  loadedAt: string | null;
  stats: { vertexCount: number; edgeCount: number } | null;
};

export default function HomePage() {
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [ping, setPing] = useState<{ ok: boolean; error?: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/slot/status').then((r) => r.json()).then((d) => setSlots(d.slots));
    fetch('/api/neptune/ping').then((r) => r.json()).then(setPing);
  }, []);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="RDB 데이터를 GraphRAG로 변환하는 방식을 실험하는 워크벤치 — V0.5 MVP"
        >
          travel-graph-lab
        </Header>
      }
    >
      <SpaceBetween size="l">
        <Alert type="info" header="이 워크벤치가 하는 일">
          osaka_subset SQLite를 다양한 매핑 규칙으로 Neptune에 적재하고, 16개 질문지로
          6축 평가를 돌려, 3개 스키마를 동시에 비교합니다. 핵심 질문: <b>"어떤 매핑이 LLM에게 가장 효과적인
          지식 컨텍스트를 만드는가?"</b>
        </Alert>

        <Container header={<Header variant="h2">Neptune 연결</Header>}>
          {ping == null ? (
            <StatusIndicator type="pending">확인 중…</StatusIndicator>
          ) : ping.ok ? (
            <StatusIndicator type="success">Neptune reachable</StatusIndicator>
          ) : (
            <Alert type="warning">Neptune 연결 불가: {ping.error}</Alert>
          )}
        </Container>

        <Container header={<Header variant="h2">스키마 슬롯 3개</Header>}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {(['A', 'B', 'C'] as const).map((id) => {
              const s = slots.find((x) => x.slot === id);
              return (
                <Container
                  key={id}
                  header={<Header variant="h3">Slot {id}</Header>}
                >
                  {s?.yaml ? (
                    <SpaceBetween size="xs">
                      <StatusIndicator type="success">{s.mappingName}</StatusIndicator>
                      <Box fontSize="body-s" color="text-status-inactive">
                        vertex {s.stats?.vertexCount ?? 0} · edge {s.stats?.edgeCount ?? 0}
                      </Box>
                      <Button onClick={() => router.push(`/slot/${id}`)}>열기</Button>
                    </SpaceBetween>
                  ) : (
                    <SpaceBetween size="xs">
                      <StatusIndicator type="stopped">비어 있음</StatusIndicator>
                      <Button onClick={() => router.push(`/slot/${id}`)} variant="primary">
                        프리셋 로드
                      </Button>
                    </SpaceBetween>
                  )}
                </Container>
              );
            })}
          </div>
        </Container>

        <Container header={<Header variant="h2">워크플로우</Header>}>
          <Box>
            <ol style={{ paddingLeft: 20, lineHeight: 1.8 }}>
              <li>
                <b><a onClick={() => router.push('/rdb')}>RDB Viewer</a></b> — 원본 SQLite 구조 확인
              </li>
              <li>
                <b>Slot A/B/C 매핑</b> — 각 슬롯에 다른 YAML 매핑 적재 (프리셋 또는 직접 작성)
              </li>
              <li>
                <b><a onClick={() => router.push('/compare')}>Compare</a></b> — 3슬롯 질문지 실행 + 6축 스코어 비교
              </li>
              <li>
                <b><a onClick={() => router.push('/cypher')}>Cypher Console</a></b> — 원하는 쿼리를 슬롯별로 실행
              </li>
            </ol>
          </Box>
        </Container>
      </SpaceBetween>
    </ContentLayout>
  );
}
