# RDB 데이터를 Neptune에 "트리플로" 적재한다는 것의 의미

> 이 문서는 travel-graph-lab이 **무엇을** 하는지, 그리고 **왜 그걸 "트리플 변환"이라 부르는지** 처음 보는 사람을 위해 정리한다.

---

## 1. 먼저 결론

- **RDB**는 "행과 열의 2차원 테이블" 모델.
- **Neptune**은 내부적으로 모든 데이터를 **(Subject, Predicate, Object)** 3원소짜리 **트리플** 하나하나로 저장한다.
- 따라서 RDB 데이터를 Neptune에 올리려면 **"한 행을 여러 개의 트리플로 쪼개서 재조립"** 해야 한다.
- 이 재조립 과정에서 **어떤 컬럼을 노드 속성으로, 어떤 컬럼을 관계(엣지)로 승격할지** 결정하는 것이 **"매핑 설계"** = 이 워크벤치가 실험하게 하려는 주제다.

---

## 2. 트리플이란 무엇인가

자연어 "도톤보리는 오사카에 있다"를 기계가 저장할 수 있는 가장 단순한 구조로 쓰면:

```
(도톤보리, ATTRACTION_IN_CITY, 오사카)
 │          │                    │
 Subject    Predicate            Object
```

세 조각이 하나의 사실. 속성도 똑같은 구조로 표현한다:

```
(도톤보리, landmarkNameKo, "도톤보리")
(도톤보리, latitude,       34.668)
(도톤보리, cityCode,       "OSA")
```

**중요**: Neptune에서는 **"노드의 속성"과 "노드 간 관계"를 구조적으로 구분하지 않는다.** 둘 다 같은 (S, P, O) 트리플. Predicate(P)가 무엇이냐에 따라 사람이 보기에 속성이거나 관계일 뿐이다.

---

## 3. RDB 한 행이 트리플 여러 개로 쪼개지는 예시

### 원본 RDB

`package_attraction` 테이블의 한 행:

| id | landmarkNameKo | cityCode | latitude | longitude | featureMoodTagsJson |
|---|---|---|---|---|---|
| LJP00421534 | 도톤보리 | OSA | 34.668 | 135.501 | `["ICONIC","LIVELY"]` |

### Neptune에 올라간 후

같은 데이터가 내부적으로는 **8개 이상의 트리플**로 존재:

```
(LJP00421534, ~label,            Attraction)
(LJP00421534, landmarkNameKo,    "도톤보리")
(LJP00421534, cityCode,          "OSA")
(LJP00421534, latitude,          34.668)
(LJP00421534, longitude,         135.501)
(LJP00421534, ATTRACTION_IN_CITY, OSA_CITY)   ← cityCode를 관계로 승격
(LJP00421534, HAS_MOOD,           MOOD_ICONIC) ← JSON 분해 1
(LJP00421534, HAS_MOOD,           MOOD_LIVELY) ← JSON 분해 2
```

한 행이 **여러 개의 "사실"**로 풀어헤쳐진 모양이다.

---

## 4. Property Graph 관점에서 다시 보기

사람이 이해하기 편한 그림은 이렇다:

```
   [Attraction]                 [Mood: ICONIC]
   id=LJP00421534   ──HAS_MOOD─→ [Mood: LIVELY]
   name=도톤보리   
   lat=34.668
   lng=135.501
        │
        │  ATTRACTION_IN_CITY
        ↓
   [City]
   code=OSA
```

- **노드(Vertex)**: `Attraction:LJP00421534`, `City:OSA`, `Mood:ICONIC`
- **엣지(Edge)**: `ATTRACTION_IN_CITY`, `HAS_MOOD` (여러 개)
- **노드의 속성**: `name`, `lat`, `lng` 등

Neptune은 내부적으로 이 전체를 **트리플의 집합**으로 저장한다. 우리는 "트리플로 저장한다"는 표현과 "property graph로 저장한다"는 표현을 **같은 것을 두 각도에서 본** 것으로 이해하면 된다.

---

## 5. RDB → 트리플 변환은 "기계적 번역" 이 아니다

> RDB에 있는 11개 테이블을 그대로 넵튠에 복사한다고 끝나는 일이 아니다. **어떻게 쪼개서 재조립할지**에 따라 같은 원본이 전혀 다른 그래프가 된다.

### 결정해야 할 것들

RDB의 각 컬럼에 대해 다음 중 하나를 선택한다:

| 선택지 | 결과 |
|---|---|
| **Vertex PK** | 노드의 `_id`로 → `(LJP00421534, ~id, LJP00421534)` |
| **Vertex Property** | 노드에 속성 트리플로 → `(LJP00421534, landmarkNameKo, "도톤보리")` |
| **Vertex Property (JSON 문자열)** | JSON을 그대로 문자열 속성으로 → `(…, featureMoodTagsJson, '["ICONIC","LIVELY"]')` |
| **Edge (FK)** | 다른 노드로의 관계 트리플로 → `(LJP00421534, ATTRACTION_IN_CITY, OSA)` |
| **JSON 분해 → Edge 여러 개** | 배열 원소마다 태그 노드 생성 + 엣지 → `(…, HAS_MOOD, ICONIC)` + `(…, HAS_MOOD, LIVELY)` |
| **CSV 분해 → Edge 여러 개** | `"OSA,UKB"` → `VISITS_CITY OSA` + `VISITS_CITY UKB` |
| **사용 안 함** | 트리플 생성 안 함 |

같은 `featureMoodTagsJson` 컬럼도 **속성 문자열**로 둘 수도, **노드로 분해**할 수도 있다. 선택에 따라:

- 속성 문자열로 두면 → 저장은 가볍지만 "ROMANTIC 관광지 찾기"가 LIKE 검색
- 노드로 분해하면 → `(:Mood {code:"ROMANTIC"})<-[:HAS_MOOD]-(a)` 로 **결정론적 그래프 탐색** 가능. 대신 트리플 수가 늘어남.

**이 선택의 묶음이 "매핑 설계"이다.**

---

## 6. 파생(Derived) — 원본에 없는 트리플까지 만든다

RDB에 없지만 **그래프 연산으로 생성하는 관계**도 있다. 예:

### CO_VISITED
"같은 SaleProduct 일정에 함께 등장한 Attraction 쌍"
- 원천: `package_product_schedules`를 self-join해서 쌍을 집계
- 결과: `(도톤보리, CO_VISITED, 오사카성 공원) [support:15]` 같은 트리플
- 의미: "이 두 관광지는 15개 상품에서 함께 등장" → LLM이 일정 기획 시 근거로 사용

### NEAR_CITY
"도시 간 물리적 거리 ≤ 100km"
- 원천: `city.latitude/longitude` 두 도시의 haversine 계산
- 결과: `(오사카, NEAR_CITY, 고베) [distanceKm:22]`

### VISITED_AFTER
"같은 일차 내 순서상 A 다음 B"
- 원천: `package_product_schedules`를 `schdDay` + `schtExprSqc`로 정렬
- 결과: `(오사카성, VISITED_AFTER, 도톤보리) [support:6]`

### OFTEN_COTRAVELED
"상품의 `vistCity` 리스트에 자주 함께 등장하는 도시 쌍"
- 결과: `(오사카, OFTEN_COTRAVELED, 교토) [support:24]`

**원본 RDB에는 이 관계들이 테이블로 없었다.** 우리가 계산해서 트리플로 만들어 얹은 것. 이게 GraphRAG가 Vector RAG보다 강한 이유 중 하나 — 근거 있는 추론 관계를 그래프가 직접 표현.

---

## 7. travel-graph-lab이 하는 일 한 문장

> **"똑같은 RDB 데이터(오사카 subset)를 개발자가 다양한 매핑 규칙으로 트리플로 변환하고, 그 결과 그래프가 LLM 에이전트 질의를 얼마나 잘 풀 수 있는지 측정한다."**

입력은 고정, 변수는 **"변환 규칙"**, 결과는 **"질의 커버리지 + 6축 점수"**.

---

## 8. 실제 파이프라인 (코드 관점)

```
┌────────────────────────┐
│ 1. SQLite (원본 RDB)    │
│    11 tables           │
│    569+ rows           │
└──────────┬─────────────┘
           │
           │ SELECT * FROM …
           ▼
┌────────────────────────┐
│ 2. JavaScript 객체      │
│    [{id, name, …}, …]  │
└──────────┬─────────────┘
           │
           │ 매핑 규칙 YAML 해석
           │ (vertices, edges, derived)
           ▼
┌────────────────────────┐
│ 3. 트리플 배치          │
│    UNWIND $batch AS r   │
│    MERGE (n:Label       │
│      {_id: r._id})      │
│    SET n += r           │
└──────────┬─────────────┘
           │
           │ HTTPS + SigV4
           │ openCypher /openCypher
           ▼
┌────────────────────────┐
│ 4. Neptune 내부 저장    │
│    SPO 인덱스           │
│    POS 인덱스           │
│    OSP 인덱스           │
│    (4개 인덱스에 중복 저장) │
└────────────────────────┘
```

### 각 단계 구체

**1단계 — SQLite 읽기** (`src/lib/sqlite/client.ts`)
- `better-sqlite3` readonly 모드
- `SELECT * FROM "package_attraction"` 같은 쿼리로 원본 행 로딩
- `PRAGMA query_only = true` 로 쓰기 차단

**2단계 — 매핑 규칙 적용** (`src/lib/mapping/executor.ts`)
- 매핑 YAML의 각 `vertex` 정의에 대해:
  - 해당 테이블에서 행을 읽고
  - `id` 표현식으로 `_id` 생성 (예: `'HotelStay:' + sale_prod_cd + ':' + schdDay + ':' + htlCd`)
  - `properties` 맵에서 알리아스·표현식으로 property 값 계산
  - 결과를 `{_id, 속성1, 속성2, ...}` 객체로 배치에 추가
- `explode_json` / `explode_csv` 옵션이 있으면 **한 행이 여러 아이템으로 확장**
- `where` 조건으로 필터링

**3단계 — openCypher MERGE 배치 실행**
- 100건 단위로 배치
- vertex:
  ```cypher
  UNWIND $batch AS r
  MERGE (n:`Attraction__B` {_id: r._id})
  SET n += r
  ```
- edge:
  ```cypher
  UNWIND $batch AS r
  MATCH (s:`Attraction__B` {_id: r.src})
  MATCH (t:`City__B` {_id: r.dst})
  MERGE (s)-[rel:`ATTRACTION_IN_CITY__B`]->(t)
  SET rel += r.props
  ```
- `MERGE`는 upsert — 같은 `_id`로 재실행해도 중복 생성 없음 (멱등성)

**4단계 — Neptune 내부**
- 우리가 보낸 Cypher 쿼리는 Neptune 엔진이 **트리플 3개 이상으로 분해해서 SPO/POS/OSP 인덱스에 기록**
- 이 과정은 Neptune 내부 일이고 우리는 건드리지 않음

---

## 9. 구체 예 — 상품 1건이 트리플 몇 개가 되는가?

오사카 subset의 상품 `JOP1302603307CS` (오사카/교토/고베 3일) 하나가 만드는 트리플 개수:

**원본 RDB**
- `package_product_meta`: 1행
- `package_product_schedules`: 10행 (3일간 방문 관광지)
- `package_hotel_stay`: 2행 (2박)
- `package_airport`: 2행 (출발+귀국)

**변환된 그래프 (Phase 1 매핑 기준)**

Vertex 5종 추가:
- 1 × SaleProduct
- 2 × HotelStay (합성 id로)
- 2 × FlightSegment (합성 id로)

이 노드들마다 **속성 트리플 여러 개** + **라벨 트리플 1개**:
- SaleProduct: `~label` + 9개 property = **10 트리플**
- HotelStay 2개: 각 `~label` + 6 property = **14 트리플**
- FlightSegment 2개: 각 `~label` + 2 property = **6 트리플**

Edge 27개:
- `INSTANCE_OF × 1` → RepresentativeProduct
- `ARRIVES_IN × 1` → City:OSA
- `DEPARTS_FROM_MARKET × 1` → DepartureMarket:AF9
- `VISITS_CITY × 3` → City 3곳
- `HAS_SCHEDULED_ATTRACTION × 10` (schdDay, visitOrder, timeBand property 포함)
- `HAS_HOTEL_STAY × 2`
- `MATCHED_TO × 2`
- `HAS_FLIGHT_SEGMENT × 2`
- `DEPARTS_FROM × 2`, `ARRIVES_AT × 2`, `OPERATED_BY × 2`

→ **상품 1건 = 약 60+ 트리플**이 Neptune에 저장된다.

오사카 subset 전체(상품 44건 + 마스터)를 Phase 1 매핑으로 적재하면:
- vertex 570개 → 각 노드 약 3~10 속성 트리플
- edge 2,856개 → 각 1~3 트리플
- **총 10,000+ 트리플** 수준

---

## 10. 왜 이게 중요한가 — LLM과 연결하기

### Vector RAG의 한계
Vector RAG는 "비슷한 임베딩"을 찾는다. 여행 도메인의 실패 예:
- "오사카 근교" → "근교" 개념이 임베딩에 없음. 오사카 시내 관광지 반환.
- "이 호텔 쓰는 다른 상품" → 호텔 이름 유사도로 뽑아서 다른 호텔이 섞임.

### GraphRAG의 강점
트리플로 저장되어 있으면:
- "근교" = `City -NEAR_CITY- City` 트리플 traversal로 **결정론적 답변**
- "이 호텔 쓰는 상품" = `Hotel ← MATCHED_TO ← HotelStay ← HAS_HOTEL_STAY ← SaleProduct` 역탐색

**트리플이 명시적이니 LLM이 환각할 여지가 없다.** "이 관계가 트리플로 존재하는가?" 가 Yes/No로 결정된다.

### 매핑 품질이 LLM 성능을 결정
- **Flat 매핑**: `featureMoodTagsJson`을 문자열로 둠 → LLM이 `CONTAINS 'ROMANTIC'` 같은 문자열 매칭으로 시도 → 부정확
- **Phase 1 매핑**: `HAS_MOOD` 엣지로 분해 → LLM이 `(:Mood {code:'ROMANTIC'})<-[:HAS_MOOD]-(a)` 로 정확히 질의

같은 원본, 다른 매핑 → 같은 LLM이 **다른 품질**의 답을 낸다. 실측:

| 슬롯 | 매핑 | 16 질문 통과 | 6축 총점 |
|---|---|---:|---:|
| A | Flat (순진한 매핑) | 2/16 | 33 |
| B | Phase 1 (우리 작품) | 16/16 | 90 |
| C | Extended (Phase 1.5) | 16/16 | 90 |

**매핑 설계 하나로 LLM 효용이 2.7배** 차이. 이게 travel-graph-lab이 시연하려는 바의 핵심 숫자다.

---

## 11. 용어 빠른 참조

| 용어 | 의미 | 예 |
|---|---|---|
| **트리플 (Triple)** | (Subject, Predicate, Object) 3원소 사실 하나 | (LJP00421534, landmarkNameKo, "도톤보리") |
| **Subject (S)** | 트리플의 주어. 노드 id | `LJP00421534` |
| **Predicate (P)** | 서술어. 속성 이름 또는 엣지 타입 | `landmarkNameKo`, `ATTRACTION_IN_CITY` |
| **Object (O)** | 목적어. 값이거나 다른 노드 id | `"도톤보리"`, `OSA` |
| **Vertex / Node** | 그래프의 점. 실체 하나 | `Attraction`, `City`, `Hotel` |
| **Edge / Relationship** | 그래프의 선. 두 노드 사이 관계 | `-[:VISITS_CITY]->` |
| **Property** | 노드나 엣지의 속성 | `name: "도톤보리"` |
| **Label** | 노드의 타입 이름 | `:Attraction`, `:City` |
| **Edge type** | 엣지의 타입 이름 | `:VISITS_CITY` |
| **Property Graph** | 노드·엣지가 property를 가질 수 있는 그래프 모델. Neptune, Neo4j가 이 모델 |  |
| **SPO / POS / OSP** | Neptune이 트리플을 정렬하는 3개 인덱스. 질의 방향에 따라 골라 사용 |  |
| **Magnitude·Batch·UNWIND** | 여러 트리플을 한 Cypher 쿼리로 일괄 생성하는 관용구 |  |
| **MERGE** | 같은 id면 속성만 업데이트, 없으면 생성 (upsert) |  |
| **파생 edge (Derived)** | 원본 RDB에 없지만 계산해서 추가한 관계 | `CO_VISITED`, `NEAR_CITY` |
| **매핑 (Mapping)** | RDB 컬럼 → 트리플 변환 규칙의 묶음 | `flat.yaml`, `phase1.yaml` |
| **질의 커버리지** | 이 매핑으로 풀 수 있는 질의 개수 / 전체 | 16/16 |

---