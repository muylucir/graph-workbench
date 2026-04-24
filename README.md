# travel-graph-lab

RDB 데이터를 GraphRAG로 변환하는 방식을 실험하는 워크벤치. V0.5 MVP.

## 한 줄

> "오사카 RDB 데이터를 임의의 매핑 규칙으로 Neptune 그래프에 올리고,
> 16개 질문지로 6축 평가를 돌려, 여러 스키마를 병렬 비교한다."

## 실측 (V0.5 시연 기준)

| Slot | 프리셋 | Vertex | Edge | 질문지 통과 | 6축 총점 |
|---|---|---:|---:|---:|---:|
| A | Flat (순진한 매핑) | 179 | 124 | **2/16** | **33** |
| B | Phase 1 (우리 작품) | 570 | 2,856 | **16/16** | **90** |
| C | Extended (Phase 1.5) | 570 | 2,910 | **16/16** | **90** |

→ **매핑 설계 하나로 총점 33 → 90 (2.7배)**. 같은 원본 데이터, 다른 트리플 변환.

## 스택

- **Frontend/Backend**: Next.js 16 (App Router, webpack) + React 19 + Cloudscape Design
- **DB**: Amazon Neptune (SigV4/IAM), SQLite 원본(better-sqlite3 readonly), DynamoDB 스냅샷
- **LLM 에이전트**: Strands Agents SDK + Amazon Bedrock (Claude)
- **매핑 DSL**: YAML 기반 자체 DSL (parser/executor/expressions)

## 구조

```
travel-graph-lab/
├── docs/
│   ├── SPEC.md              — V0.5 MVP 스펙 (989줄)
│   ├── RDB_TO_TRIPLE.md     — RDB→트리플 변환 설계
│   └── HANDOFF.md
├── schemas/                 — 프리셋 3종
│   ├── flat.yaml            — Slot A (순진한 1:1 매핑)
│   ├── phase1.yaml          — Slot B (파생 edge 포함)
│   └── extended.yaml        — Slot C (Phase 1.5)
├── questionnaire/v2.json    — 질문지 16개 (6축 스코어카드 근거)
├── scripts/
│   └── travel-graph-lab.service — systemd 유닛
└── web/                     — Next.js 애플리케이션
    └── src/
        ├── app/
        │   ├── page.tsx            — Home (슬롯 현황)
        │   ├── rdb/                — SQLite 테이블 탐색
        │   ├── slot/[slot]/        — 매핑 에디터 + SSE 적재 진행
        │   ├── triple/             — 트리플 문서 뷰
        │   ├── questionnaire/      — 질문지 실행 UI
        │   ├── compare/            — 6축 스코어 비교 대시보드
        │   ├── cypher/             — 슬롯별 Cypher 콘솔
        │   ├── chat/               — LLM 에이전트 대화 UI
        │   └── api/
        │       ├── slot/[slot]/load     — SSE 적재 스트림
        │       ├── slot/status          — 슬롯 상태 조회
        │       ├── questionnaire/{run,list,suggest,validate}
        │       ├── derived/preview      — 파생 edge 미리보기
        │       ├── neptune/{query,ping}
        │       ├── sqlite/{tables,search}
        │       ├── snapshots/…          — DynamoDB 스냅샷 CRUD
        │       ├── presets              — YAML 프리셋 로더
        │       └── agent/{schema,stream} — 에이전트 스키마·SSE
        └── lib/
            ├── mapping/            — DSL 타입·파서·표현식·executor (UNWIND MERGE 배치)
            ├── neptune/            — SigV4 HTTPS 클라이언트 + label suffix 주입
            ├── sqlite/             — better-sqlite3 readonly
            ├── questionnaire/runner — 16개 질의 실행
            ├── scorecard/calculate  — 6축 계산
            ├── agent/builder.ts     — Strands Agents + Bedrock 래퍼
            ├── snapshots/           — DynamoDB 스냅샷 저장/복원
            ├── schemas/             — YAML 프리셋 로더
            ├── column-assembler.ts  — Simple Mode 체크박스 → 컬럼 구성
            ├── derived-templates.ts — 파생 edge 템플릿
            ├── question-requirements.ts — 질문별 스키마 요건
            ├── slot-store.ts        — 슬롯 상태 스토어
            └── yaml-builder.ts      — Simple Mode → YAML 직렬화
```

## 실행

```bash
cd web
cp ../web/.env.example .env     # 또는 .env 직접 편집 (아래 변수 참고)
npm install
npm run dev                     # 개발 (기본 3000)
# 또는
npm run build                   # next build --webpack  ← webpack 플래그 필수
npm run start                   # http://localhost:3080
```

환경변수 (`web/.env`):

| 변수 | 용도 |
|---|---|
| `GRAPH_LAB_ROOT` | 현재 저장소 루트 (스키마/프리셋 경로) |
| `GRAPH_STUDY_ROOT` | 이웃 `graph-study` 저장소 경로 (SQLite 원천) |
| `AWS_REGION` / `NEPTUNE_REGION` | SigV4 서명용 리전 |
| `NEPTUNE_ENDPOINT` / `NEPTUNE_PORT` | Neptune 클러스터 접속 |
| `NEPTUNE_AUTH` | `AWS_IAM` 고정 |
| `BEDROCK_MODEL_ID` | LLM 에이전트용 Claude 모델 ID |
| `DYNAMODB_SNAPSHOTS_TABLE` | 매핑/스코어 스냅샷 저장 테이블 |

## 30분 시연

`docs/SPEC.md` §11 참조. 요약:

```
00:00  RDB Viewer — "원본은 11 테이블"
03:00  Slot A에 Flat 프리셋 로드 → 적재 진행 표시
10:00  질문지 실행 → 2/16 통과, 총점 33
14:00  Slot B에 Phase 1 로드 → 15 vertex / 19 edge / 4 파생
18:00  질문지 실행 → 16/16 통과, 총점 90. 같은 질문, 2.7배 점수
22:00  Slot C (Extended)로 "끝이 아님" 메시지
26:00  Compare 대시보드 3 슬롯 나란히
28:00  Cypher Console에서 슬롯 전환하며 같은 쿼리의 차이 시연
```

## 핵심 설계 포인트

1. **Label Suffix 격리** — 3슬롯이 같은 Neptune에 공존. `:City → :City__B` 자동 치환. 시연에서 "실 Neptune" 명시 가능.
2. **매핑 DSL YAML** — vertex(직접/distinct/explode_json/explode_csv) + edge + derived(co_occurrence/sequence/haversine/list_co_occurrence). SQL 표현식 허용 + 함수 레지스트리.
3. **파생 edge 런타임 계산** — CO_VISITED / VISITED_AFTER / NEAR_CITY / OFTEN_COTRAVELED가 원본에 없지만 그래프에 자동 생성.
4. **스코어카드** — 6축 중 4축은 매핑·통계로 자동, 2축(3/5)은 질문지 통과율로 측정.
5. **시연 핵심 지표** — 같은 데이터 × 다른 매핑 = 점수 2.7배 차이.
6. **LLM 에이전트 슬롯 자동 재구성** — 슬롯 전환 시 시스템 프롬프트의 스키마 요약이 자동 갱신, neptune_cypher 도구가 현재 슬롯의 suffix를 자동 주입. 같은 자연어 질문이 Slot A에서는 "스키마에 관계가 없다"로 실패, Slot B에서는 정확한 답을 반환.
7. **Simple Mode 체크박스 편집기** — 매핑 결정 4그룹(태그 분해/지리 계층/사실 vertex/파생 edge)을 체크박스로 조작 → YAML 자동 생성 (`column-assembler.ts` + `yaml-builder.ts`). MD도 스키마 실험 가능.
8. **DynamoDB 스냅샷** — 매핑·점수 결과를 스냅샷으로 저장/복원해 반복 시연 비용 제거.

## V1.0 로드맵

- 임의 RDB 업로드
- Simple Mode 체크박스 편집기 완성
- Vector RAG 하이브리드
- LLM judge
- 엑스포트 (Neptune Bulk Load CSV, Neo4j Cypher)

## 관련 프로젝트

- `../graph-study/` — Phase 1 스키마 연구·검증 도구. travel-graph-lab은 이 연구의 시연 프레임워크 버전.
- `../travel-md/` — GraphRAG 당위성 입증 PoC (크롤링 기반).
