/**
 * Question-driven mapping.
 *
 * Each question declares which mapping components it needs. Selecting a set of
 * questions yields the union of required components — which we turn into YAML.
 */

export type ComponentId =
  | 'theme_vertex'
  | 'mood_vertex'
  | 'season_vertex'
  | 'prefecture_vertex'
  | 'near_city'
  | 'often_cotraveled'
  | 'representative_split'
  | 'hotel_stay_vertex'
  | 'flight_segment_vertex'
  | 'departure_market_vertex'
  | 'co_visited'
  | 'visited_after';

export type Category = 'discovery' | 'fact' | 'planning' | 'internal';

export type QuestionRequirement = {
  id: string;
  title: string;
  category: Category;
  naturalLanguage: string;
  requires: ComponentId[];
  // short "why it opens" note attached to each listed component
  why?: string;
};

export const QUESTIONS: QuestionRequirement[] = [
  {
    id: 'Q01',
    title: '오사카 근교 관광지',
    category: 'discovery',
    naturalLanguage: '오사카 근교 도시의 관광지를 보여줘',
    requires: ['prefecture_vertex', 'near_city', 'often_cotraveled'],
    why: '"근교"를 결정론적으로 판정하려면 Prefecture 계층 + NEAR_CITY(좌표) + OFTEN_COTRAVELED(상품 관행) 중 하나 이상 필요',
  },
  {
    id: 'Q02',
    title: '오사카+교토 둘 다 방문',
    category: 'discovery',
    naturalLanguage: '오사카와 교토 둘 다 방문하는 상품',
    requires: [],
    why: 'City + SaleProduct + VISITS_CITY edge (기본 매핑에 포함)',
  },
  {
    id: 'Q03',
    title: '특정 상품 일차별 숙박',
    category: 'fact',
    naturalLanguage: 'JOP1302603307CS 상품의 일차별 숙박 호텔',
    requires: ['hotel_stay_vertex'],
    why: 'HotelStay vertex + HAS_HOTEL_STAY + MATCHED_TO 없이는 "몇일차에 어느 호텔" 사실 저장 불가',
  },
  {
    id: 'Q04',
    title: '관광지 방문 순서 분포',
    category: 'fact',
    naturalLanguage: '도톤보리가 몇일차 몇번째로 주로 방문되는지',
    requires: [],
    why: 'HAS_SCHEDULED_ATTRACTION edge property(schdDay, visitOrder)가 기본 매핑에 있음',
  },
  {
    id: 'Q05',
    title: '대표상품 아래 출발상품 비교',
    category: 'planning',
    naturalLanguage: '특정 대표상품 아래 묶인 SaleProduct들',
    requires: ['representative_split'],
    why: 'SaleProduct와 RepresentativeProduct를 분리해야 INSTANCE_OF 관계 표현 가능',
  },
  {
    id: 'Q06',
    title: '대표상품 내 일정 변형',
    category: 'planning',
    naturalLanguage: '같은 대표상품 아래 SaleProduct들의 관광지 집합 비교',
    requires: ['representative_split'],
  },
  {
    id: 'Q07',
    title: '오사카성 공동방문 상위',
    category: 'internal',
    naturalLanguage: '오사카성과 같은 상품에 자주 등장하는 관광지',
    requires: ['co_visited'],
    why: 'CO_VISITED 파생 edge(같은 SaleProduct 내 Attraction 쌍) 필수',
  },
  {
    id: 'Q08',
    title: '오전/오후 방문 분포 + 순서 패턴',
    category: 'internal',
    naturalLanguage: '기요미즈데라 오전/오후 + 그 다음 자주 방문되는 관광지',
    requires: ['visited_after'],
    why: '단순 분포는 기본 edge로 되지만, "다음에 자주 가는 곳"은 VISITED_AFTER 파생 필요',
  },
  {
    id: 'Q09',
    title: '로맨틱+근교 관광지',
    category: 'planning',
    naturalLanguage: '로맨틱한 분위기의 근교 관광지',
    requires: ['mood_vertex', 'prefecture_vertex', 'near_city', 'often_cotraveled'],
    why: 'Mood vertex(태그 필터) + 근교 판정 필요',
  },
  {
    id: 'Q10',
    title: '특정 호텔 쓰는 다른 상품',
    category: 'fact',
    naturalLanguage: '호텔 X를 사용한 다른 상품들',
    requires: ['hotel_stay_vertex'],
    why: 'Hotel ← MATCHED_TO ← HotelStay ← HAS_HOTEL_STAY ← SaleProduct 역탐색',
  },
  {
    id: 'Q11',
    title: '간사이공항 귀국 + 교토 + 김포 출발',
    category: 'planning',
    naturalLanguage: 'KIX 귀국 + 교토 일정 + 김포 출발 조합',
    requires: ['flight_segment_vertex', 'departure_market_vertex'],
    why: 'FlightSegment(귀국편) + DepartureMarket(김포/인천 분리)',
  },
  {
    id: 'Q12',
    title: '3관광지 같은 일차 조합',
    category: 'planning',
    naturalLanguage: '오사카성과 도톤보리가 같은 일차에 함께 등장하는 상품',
    requires: [],
    why: 'HAS_SCHEDULED_ATTRACTION.schdDay로 해결',
  },
  {
    id: 'Q13',
    title: '신상품 조건 체크',
    category: 'planning',
    naturalLanguage: '특정 관광지 3개를 포함하는 N박 상품이 이미 있나',
    requires: [],
  },
  {
    id: 'Q14',
    title: '복합 제약 기획 (온천 호텔)',
    category: 'planning',
    naturalLanguage: '3박4일 + 온천 테마 + 특정 등급 호텔',
    requires: ['hotel_stay_vertex', 'theme_vertex'],
  },
  {
    id: 'Q15',
    title: '벚꽃시즌 관광지 포함',
    category: 'planning',
    naturalLanguage: '벚꽃시즌 태그 관광지를 포함한 상품',
    requires: ['season_vertex'],
    why: 'Season vertex(CHERRY_BLOSSOM 코드) 없이는 시즌 태그 필터 불가',
  },
  {
    id: 'Q16',
    title: '대체 관광지 탐색',
    category: 'planning',
    naturalLanguage: '오사카성과 자주 가는 곳 중 근처 대체지',
    requires: ['co_visited'],
  },
];

/**
 * Meta about each component — what YAML piece it generates, human label, and which
 * questions it "unlocks" (computed by union-inverse).
 */
export type ComponentInfo = {
  id: ComponentId;
  label: string;
  note: string;
  impact: 'vertex' | 'edge' | 'derived';
};

export const COMPONENT_META: Record<ComponentId, ComponentInfo> = {
  theme_vertex: { id: 'theme_vertex', label: 'Theme 노드 분해', note: 'featureThemeTagsJson → Theme vertex + HAS_THEME edge', impact: 'vertex' },
  mood_vertex: { id: 'mood_vertex', label: 'Mood 노드 분해', note: 'featureMoodTagsJson → Mood vertex + HAS_MOOD edge (ROMANTIC, ICONIC…)', impact: 'vertex' },
  season_vertex: { id: 'season_vertex', label: 'Season 노드 분해', note: 'featureSeasonalityTagsJson → Season vertex + HAS_SEASONALITY edge', impact: 'vertex' },
  prefecture_vertex: { id: 'prefecture_vertex', label: 'Prefecture 승격', note: 'city.state_code → Prefecture vertex + IN_PREFECTURE edge', impact: 'vertex' },
  near_city: { id: 'near_city', label: 'NEAR_CITY (좌표 기반)', note: 'City 좌표 haversine ≤ 100km', impact: 'derived' },
  often_cotraveled: { id: 'often_cotraveled', label: 'OFTEN_COTRAVELED', note: 'vistCity 공동출현 기반 도시 쌍', impact: 'derived' },
  representative_split: { id: 'representative_split', label: 'RP / SaleProduct 분리', note: 'rprsProdCd 별도 vertex + INSTANCE_OF edge', impact: 'vertex' },
  hotel_stay_vertex: { id: 'hotel_stay_vertex', label: 'HotelStay 승격', note: '(상품, 일차, 호텔) 사실 vertex + HAS_HOTEL_STAY + MATCHED_TO', impact: 'vertex' },
  flight_segment_vertex: { id: 'flight_segment_vertex', label: 'FlightSegment 분리', note: 'Airport, Airline, FlightSegment vertex + DEPARTS_FROM/ARRIVES_AT/OPERATED_BY', impact: 'vertex' },
  departure_market_vertex: { id: 'departure_market_vertex', label: 'DepartureMarket 분리', note: 'depCityCd 네임스페이스 분리', impact: 'vertex' },
  co_visited: { id: 'co_visited', label: 'CO_VISITED (공동방문)', note: '같은 상품에 함께 등장한 Attraction 쌍 (support ≥ 3)', impact: 'derived' },
  visited_after: { id: 'visited_after', label: 'VISITED_AFTER (순서)', note: '같은 일차 내 Attraction 순서 (support ≥ 3)', impact: 'derived' },
};

export const ALL_COMPONENT_IDS: ComponentId[] = Object.keys(COMPONENT_META) as ComponentId[];

/** Build inverse map: component → list of questions it enables. */
export function whichQuestionsUseComponent(id: ComponentId): QuestionRequirement[] {
  return QUESTIONS.filter((q) => q.requires.includes(id));
}

/** Union of all components required by the selected questions. */
export function computeRequiredComponents(selectedIds: string[]): Set<ComponentId> {
  const set = new Set<ComponentId>();
  for (const q of QUESTIONS) {
    if (!selectedIds.includes(q.id)) continue;
    for (const c of q.requires) set.add(c);
  }
  return set;
}

/** "이 질문을 추가로 풀려면 필요한 컴포넌트" — 현재 선택에 추가되는 것만. */
export function additionalComponentsFor(
  qid: string,
  currentSelected: Set<ComponentId>,
): ComponentId[] {
  const q = QUESTIONS.find((x) => x.id === qid);
  if (!q) return [];
  return q.requires.filter((c) => !currentSelected.has(c));
}
