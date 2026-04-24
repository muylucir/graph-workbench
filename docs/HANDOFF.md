# 세션 인수인계 — travel-graph-lab

> 다음 세션이 바로 이어 작업할 수 있도록 지금까지 한 일과 남은 일을 정리.
> 작성 시점: 2026-04-22

---

## 1. 프로젝트 한 줄

**RDB 데이터를 어떻게 트리플로 변환해야 LLM이 상품기획을 잘 하는가**를 실험하는 웹 워크벤치. V0.5 MVP 완성, 개발팀 시연용.

- 대상: 개발팀 (기술 중심 톤)
- 핵심 숫자: **Flat 매핑 33점 → Phase 1 매핑 90점 (같은 데이터, 다른 변환)**
- 위치: `/home/ec2-user/project/travel-graph-lab`

## 2. 관련 두 저장소

```
/home/ec2-user/project/
├── graph-study/        ← Phase 1 연구 / 오사카 데이터 저장소 / 원천 문서
│   ├── osaka_subset/graph_hotel_info_osaka.sqlite  (원천, 11 tables)
│   ├── web/            (원래 검증용 앱, 유지)
│   └── docs/           (Phase 1 스키마/시나리오/스코어카드 등 문서 자산)
└── travel-graph-lab/   ← V0.5 시연용 워크벤치 (신규 프로젝트)
    ├── schemas/        (Flat/Phase1/Extended 프리셋 3종)
    ├── questionnaire/v2.json  (16 질문)
    ├── web/            (Next.js 16 앱 — 주 개발 영역)
    └── docs/
        ├── SPEC.md
        ├── RDB_TO_TRIPLE.md
        └── HANDOFF.md  (이 문서)
```

SQLite 파일은 `graph-study/osaka_subset/`에만 있고 lab이 경로 참조.

## 3. 인프라 상태

- **Neptune**: `db-neptune-1.cluster-cje4bejv0vps.ap-northeast-2.neptune.amazonaws.com:8182`
  - AWS_IAM 인증, SigV4로 접속
  - 슬롯 격리: 모든 label/edge type에 `__A` / `__B` / `__C` suffix 자동 주입
- **Bedrock**: `global.anthropic.claude-sonnet-4-6` (ap-northeast-2)
- `.env`에 `NEPTUNE_ENDPOINT`, `NEPTUNE_REGION`, `AWS_REGION`, `BEDROCK_MODEL_ID` 설정됨

**빌드는 반드시 `next build --webpack`** (Turbopack 프로덕션 빌드에 minifier 버그). `package.json`의 `build` 스크립트가 이미 `--webpack` 플래그 포함.

---

## 4. 완료된 작업 요약

### 4.1 Graph Study (Phase 1 연구) — `graph-study/docs/`

| 문서 | 내용 |
|---|---|
| `source_data_profile.md` | SQLite 11 테이블 전수조사 |
| `query_scenarios.md` | 자연어 질의 16건 (Vector RAG 실패 사례) |
| `schema_phase1.md` | Phase 1 스키마 초안 (15 vertex / 23 edge) |
| `query_cypher.md` | 각 질문의 openCypher 쿼리 |
| `schema_scorecard.md` | 6축 평가 |
| `graph_limits.md` | 그래프 한계 12개 카테고리 |
| `product_planning_walkthrough.md` | 상품 기획 시연 시나리오 |
| `diagrams/*.md` | 3개 시각화 문서 |

Neptune에 Phase 1 스키마로 **570 vertex / 2856 edge** 적재 완료 검증됨.

### 4.2 travel-graph-lab V0.5 — `travel-graph-lab/web/`

**5개 페이지 + 16개 라우트**

| 경로 | 기능 |
|---|---|
| `/` | Home (슬롯 현황) |
| `/rdb` | SQLite 테이블 탐색 |
| `/slot/[slot]` | **3 모드 매핑 에디터** |
| `/compare` | 단일/다중 슬롯 스코어카드 + 질문별 결과 |
| `/cypher` | openCypher 콘솔 (슬롯 전환 + 그래프 시각화) |
| `/chat` | Strands Bedrock 에이전트 (슬롯 자동 재구성 + SSE 스트리밍) |

**3가지 매핑 모드 (Slot 페이지)**
1. **질의 드라이버** (기본) — 풀고 싶은 질의 체크 → 필요한 컴포넌트 자동 활성화
2. **컬럼 조립 (D&D)** — 컬럼을 노드 카드에 드래그 → 역할 선택 → 실시간 그래프 미리보기
3. **YAML (Expert)** — 직접 편집

**프리셋 3종 (같은 원본, 다른 매핑)**
- Flat (순진한 매핑, 179v / 124e, 총점 33)
- Phase 1 (완전판, 570v / 2856e, 총점 90)
- Extended (Phase 1.5, 570v / 2910e, 총점 90)

**핵심 기술 포인트**
- Neptune label suffix 격리 (single cluster, 3 slots 공존)
- UNWIND MERGE 배치 적재 (14초 내 전체 적재)
- YAML DSL (vertex/edge/derived, SQL 표현식, JSON/CSV explode)
- Cypher suffix 자동 주입 (개발자는 pure label로 작성)
- Strands SDK + 프로덕션 minifier 안전 (shape 기반 이벤트 감지)
- 프리셋 → 세 모드 동기화 (`presetVersion` 토큰)

### 4.3 Chat 에이전트 개선
- `neptune_cypher` 도구: 슬롯별 suffix 자동 주입 + 읽기 전용 검증
- `schema_inspect` 도구
- 프로덕션 SSE (minify-safe duck typing)
- Markdown 실시간 렌더 (react-markdown + remark-gfm)
- 도구 호출 이력 우측 패널 분리
- 추천 질의 항상 노출

### 4.4 Compare 페이지 개선
- 슬롯별 체크박스 + 개별 실행 버튼
- 단일 슬롯 뷰 (큰 총점 + 6축 ProgressBar 카드 + 질문 preview)
- 다중 슬롯 뷰 (baseline ★ 표시)
- 질문 메타 통합 (title + 자연어 + 태그 이모지 + 기대 row 수 + Cypher 접어두기)

### 4.5 문서
- `SPEC.md` — V0.5 스펙
- `RDB_TO_TRIPLE.md` — "트리플 변환" 개념 설명 (개발팀 온보딩용)

---

## 5. 해결된 주요 문제 (재발 방지용 기록)

### 5.1 Webpack/Turbopack minifier 버그
- **증상**: prod 빌드에서 `ReferenceError: components is not defined` / `comps is not defined`
- **원인**: Turbopack·Webpack minifier가 함수 인라이닝 시 파라미터 치환 실패 (첫 usage만 이름 바꿈, 나머지는 원본 이름으로 남김)
- **해결**: 
  - `package.json` build를 `next build --webpack`로
  - 변수명 `components`/`comps` 충돌 회피 (`activeComponents` 사용)
  - 외부 import 함수를 컴포넌트 파일 내부에 복사 (`estimateMetricsLocal`)

### 5.2 Strands SDK prod에서 이벤트 인식 실패
- **증상**: dev에서는 Chat 동작, prod에서는 즉시 done
- **원인**: Next.js minifier가 Strands의 class name 망글링 → `constructor.name` 체크 실패
- **해결**: class name 판별 제거, **객체 shape duck-typing** (`ev.delta.text`, `ev.toolUse.name`, `ev.lastMessage` 등)

### 5.3 Neptune SigV4 서명 실패
- **증상**: `Credential should be scoped to a valid region` 또는 `request signature we calculated does not match`
- **원인**: shell의 `AWS_REGION=us-east-1`이 `.env`를 덮어씀 / fetch가 Host 헤더 재작성
- **해결**: 
  - `NEPTUNE_REGION` 전용 env 변수
  - `@smithy/node-http-handler` 사용 (fetch 대신)

### 5.4 Cytoscape 그래프 미리보기 꼬임
- **증상**: 컬럼 조립 시작점을 flat→empty→flat 왕복 시 client exception
- **원인**: 0-element 상태에서 cose layout 에러 + diff incremental 업데이트 꼬임
- **해결**: 
  - major reset 감지 시 `destroy` + 재생성
  - `cy.batch()` 래핑
  - `try/catch` fallback

### 5.5 프리셋 ↔ 세 모드 동기화 안 됨
- **해결**: `presetVersion` 토큰 방식. slot 페이지에서 증가 → `QuestionDrivenEditor`/`ColumnAssembler`가 effect로 재동기화

---

## 6. 현재 알려진 제한사항

1. **YAML → AssemblerState 역파싱 없음**
   - phase1/extended 프리셋을 컬럼 조립기로 열면 flat 베이스 상태로 시작
   - V1.0 영역 (복잡도 대비 효용 낮음)

2. **Expert 편집 → Simple/Assembler 역전파 안 됨**
   - 단방향 원칙. Expert에서 YAML 직접 수정해도 다른 모드 상태는 그대로
   - 의도적 제한

3. **Cytoscape 타입 경고**
   - `padding: '8px'` 등이 TS 타입 체크에 걸림. 런타임 영향 없음, `ignoreBuildErrors`로 빌드 통과

4. **슬롯 메모리**
   - slot 적재 상태(mappingName, stats)는 서버 **in-memory 싱글턴**
   - `npm start` 재시작하면 날아감. 매번 적재 필요
   - Redis 등 외부화는 V1.0

5. **Neptune에 데이터는 남음**
   - dev 재시작해도 Neptune 자체는 label suffix로 살아있음
   - reset=true 옵션 적재 시에만 해당 슬롯 정리

---

## 7. 다음 세션 작업 후보

### 7.1 즉시 할 수 있는 것 (단기)

- [ ] **시연 스크립트 다듬기** (`SPEC.md` §11의 30분 시나리오 실제 리허설)
- [ ] **Extended 프리셋에 `expr:onsen_from_desc` 등 사용자 함수 실장** (현재 함수 레지스트리에 빈 구현)
- [ ] **슬롯 상태 영속화** — 파일 1개(`tmp/slot-state.json`)에 mapping name/stats 저장
- [ ] **Compare에서 질문별 Cypher 실행 시간 막대그래프** 추가
- [ ] **시연 데모 데이터 프리로드 스크립트** — 서버 기동 시 자동으로 A/B/C 세 슬롯 적재

### 7.2 시연 피드백 후 (중기)

- [ ] **Vector RAG 하이브리드 PoC** — `Attraction.featureSummaryKo` 임베딩 → Chroma/OpenSearch → LLM 에이전트 도구 추가
  - `docs/graph_limits.md`에서 제1 약점으로 지목
  - 축 1·4 동시 보강
- [ ] **임의 RDB 업로드 지원** — 현재 오사카 고정을 일반화
  - CSV 업로드 → 테이블 자동 생성
  - PostgreSQL 커넥터
- [ ] **Schema diff 비주얼** — 두 슬롯의 매핑 차이를 색으로
- [ ] **LLM judge 정교화** — 질문별 기대 응답과의 의미적 비교

### 7.3 V1.0 아이디어 (장기)

- [ ] **엑스포트**: Neptune Bulk Load CSV / Neo4j Cypher / Gremlin
- [ ] **시나리오 저장·공유**: 스키마 A/B 실험을 URL 링크로
- [ ] **스키마 추천**: GPT로 초안 생성 후 사람이 수정
- [ ] **권한/멀티테넌트**
- [ ] **회귀 감지**: 같은 매핑 + 새 데이터 → 결과 변화 리포트

### 7.4 개발팀 시연 후 수렴할 질문들

- MD가 Simple 모드보다 Expert를 선호할까, 아니면 질의 드라이버 흐름이 MD에게도 이해되는가?
- Flat→Phase 1의 2.7배 gap이 설득력 있게 느껴지는가, 아니면 더 극적인 대비가 필요한가?
- Hotel enrichment, 가격/출발일 같은 현실 데이터 부재가 막히는 지점이 되는가?
- Vector RAG 하이브리드 필요성을 시연 단계에서 느끼는가?

---

## 8. 다음 세션 시작 시 체크리스트

1. `/home/ec2-user/project/travel-graph-lab`에서 작업
2. `.env` 확인 (NEPTUNE_ENDPOINT 등)
3. 필요 시 `fuser -k 3000/tcp` 로 기존 dev 서버 정리
4. 빌드/실행:
   ```bash
   cd /home/ec2-user/project/travel-graph-lab/web
   npm run build   # (반드시 --webpack, 이미 스크립트에 포함)
   npm run start   # 프로덕션 확인
   npm run dev     # 개발 모드
   ```
5. Neptune 상태 확인:
   ```bash
   curl -sS http://localhost:3000/api/slot/status
   ```
6. 필요 시 슬롯 재적재:
   ```bash
   YAML=$(cat schemas/phase1.yaml | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))")
   curl -sS -N -X POST http://localhost:3000/api/slot/B/load \
     -H "Content-Type: application/json" \
     -d "{\"yaml\": ${YAML}, \"reset\": true}"
   ```

---

## 9. 주요 파일 맵

```
travel-graph-lab/web/src/
├── app/
│   ├── page.tsx                       Home
│   ├── rdb/page.tsx                   SQLite 탐색
│   ├── slot/[slot]/page.tsx           ★ 매핑 에디터 (3 모드)
│   ├── compare/page.tsx               ★ 스코어카드 (단일/다중)
│   ├── cypher/page.tsx                Cypher 콘솔
│   ├── chat/page.tsx                  ★ Bedrock 에이전트 Chat
│   └── api/
│       ├── presets/route.ts
│       ├── sqlite/tables/route.ts
│       ├── slot/[slot]/{load,clear}/route.ts  (SSE 로더)
│       ├── slot/status/route.ts
│       ├── questionnaire/{run,list}/route.ts
│       ├── neptune/{ping,query}/route.ts
│       └── agent/{schema,stream}/route.ts
├── components/
│   ├── AppShell.tsx                   Cloudscape Navigation
│   ├── QuestionDrivenEditor.tsx       ★ 질의 드라이버
│   ├── ColumnAssembler.tsx            ★ D&D 조립기
│   ├── AssemblerGraphPreview.tsx      ★ Cytoscape 실시간 미리보기
│   ├── MarkdownStream.tsx             Chat 마크다운 렌더
│   └── SimpleModeEditor.tsx           (deprecated, QuestionDriven이 대체)
└── lib/
    ├── sqlite/client.ts               better-sqlite3 readonly
    ├── neptune/client.ts              SigV4 + label suffix
    ├── neptune/suffix.ts              :Label → :Label__B regex 치환
    ├── mapping/
    │   ├── parser.ts                  YAML → MappingConfig
    │   ├── executor.ts                ★ 변환·적재 핵심
    │   ├── expressions.ts             SQL 표현식 평가
    │   └── types.ts
    ├── agent/builder.ts               Strands Agent + 슬롯 프롬프트
    ├── question-requirements.ts       16 질문 + 12 컴포넌트 매핑
    ├── yaml-builder.ts                Set<ComponentId> → YAML
    ├── column-assembler.ts            ★ AssemblerState + stateToYaml
    ├── questionnaire/runner.ts        질문 실행 + 검증
    └── scorecard/calculate.ts         6축 점수
```

---

## 10. 필수 컨텍스트 (이 프로젝트의 철학)

1. **"RDB → 트리플"은 기계적 번역 아니라 설계 결정**. 매핑이 곧 스키마.
2. **같은 원본, 다른 매핑 = 다른 LLM 성능**. 2.7배 차이가 실증.
3. **3축 (스키마 / 운영 / 매핑)을 L1/L2/L3로 구분**해 논의한다.
4. **파생 edge**(CO_VISITED, NEAR_CITY 등)가 GraphRAG 강점의 원천.
5. **오사카 subset은 레퍼런스 인스턴스**. 일반화는 V1.0.
6. **단방향 원칙**: 프리셋/Simple → Expert 방향만. 역방향 아님.
7. **시연은 개발팀 대상**. 기술 중심 톤, YAML/쿼리/숫자로 설득.

---
