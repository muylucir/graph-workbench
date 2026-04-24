'use client';

import { useEffect, useMemo, useState } from 'react';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Checkbox from '@cloudscape-design/components/checkbox';
import Box from '@cloudscape-design/components/box';
import Input from '@cloudscape-design/components/input';
import FormField from '@cloudscape-design/components/form-field';
import Alert from '@cloudscape-design/components/alert';

/**
 * A checkbox-driven mapping editor. Generates a YAML config according to the
 * user's choices. Grouped by the 4 design decisions that dominate the
 * scorecard:
 *    1) Tag decomposition (JSON → vertex + edge)
 *    2) Geo hierarchy (Prefecture)
 *    3) Fact vertices (HotelStay, FlightSegment, RepresentativeProduct split)
 *    4) Derived edges (CO_VISITED / VISITED_AFTER / NEAR_CITY / OFTEN_COTRAVELED)
 */

export type SimpleOptions = {
  name: string;
  description: string;
  slot: 'A' | 'B' | 'C';
  // group 1: tags
  themeVertex: boolean;
  moodVertex: boolean;
  seasonVertex: boolean;
  // group 2: geo
  prefectureVertex: boolean;
  nearCity: boolean;
  oftenCotraveled: boolean;
  // group 3: product layer
  representativeSplit: boolean;
  hotelStayVertex: boolean;
  flightSegmentVertex: boolean;
  departureMarketVertex: boolean;
  // group 4: derived
  coVisited: boolean;
  visitedAfter: boolean;
  // thresholds
  coVisitedSupport: number;
  nearCityKm: number;
};

export const PRESET_OPTIONS: Record<string, SimpleOptions> = {
  flat: {
    name: 'Custom',
    description: '체크박스로 작성',
    slot: 'A',
    themeVertex: false, moodVertex: false, seasonVertex: false,
    prefectureVertex: false, nearCity: false, oftenCotraveled: false,
    representativeSplit: false, hotelStayVertex: false, flightSegmentVertex: false, departureMarketVertex: false,
    coVisited: false, visitedAfter: false,
    coVisitedSupport: 3, nearCityKm: 100,
  },
  phase1: {
    name: 'Custom',
    description: '체크박스로 작성',
    slot: 'B',
    themeVertex: true, moodVertex: true, seasonVertex: true,
    prefectureVertex: true, nearCity: true, oftenCotraveled: true,
    representativeSplit: true, hotelStayVertex: true, flightSegmentVertex: true, departureMarketVertex: true,
    coVisited: true, visitedAfter: true,
    coVisitedSupport: 3, nearCityKm: 100,
  },
};

export function buildYamlFromOptions(o: SimpleOptions): string {
  const vertices: string[] = [];
  const edges: string[] = [];
  const derived: string[] = [];

  // Always present
  vertices.push(`  - label: Country
    from: { table: country }
    id: "code"
    properties: { name: name }`);

  if (o.prefectureVertex) {
    vertices.push(`  - label: Prefecture
    from: { table: city, distinct: [state_code, state_name, country_code] }
    id: "state_code"
    properties: { stateName: state_name, countryCode: country_code }`);
  }

  vertices.push(`  - label: City
    from: { table: city }
    id: "city_code"
    properties:
      cityName: city_name
      englishCityName: english_city_name
      lat: latitude
      lng: longitude
      countryCode: country_code
      stateCode: state_code`);

  if (o.departureMarketVertex) {
    vertices.push(`  - label: DepartureMarket
    from: { table: package_product_meta, distinct: [depCityCd, depCityNm] }
    id: "depCityCd"
    properties: { marketName: depCityNm }`);
  }

  if (o.representativeSplit) {
    vertices.push(`  - label: RepresentativeProduct
    from: { table: package_product_meta, distinct: [rprsProdCd, prodMstrCd] }
    id: "rprsProdCd"
    properties: { prodMstrCd: prodMstrCd }`);
  }

  vertices.push(`  - label: SaleProduct
    from: { table: package_product_meta }
    id: "saleProdCd"
    properties:
      saleProdNm: saleProdNm
      brndNm: brndNm
      trvlDayCnt: trvlDayCnt
      trvlNgtCnt: trvlNgtCnt`);

  vertices.push(`  - label: Attraction
    from: { table: package_attraction }
    id: "id"
    properties:
      landmarkNameKo: landmarkNameKo
      cityCode: cityCode
      latitude: latitude
      longitude: longitude
      featureIndoorOutdoorType: featureIndoorOutdoorType
      featureActivityLevel: featureActivityLevel
      featureSummaryKo: featureSummaryKo`);

  vertices.push(`  - label: Hotel
    from: { table: package_hotel }
    id: "id"
    properties:
      name: name
      en_name: en_name
      grade: grade
      rating: rating
      address: address`);

  if (o.hotelStayVertex) {
    vertices.push(`  - label: HotelStay
    from: { table: package_hotel_stay }
    id: "'HotelStay:' + sale_prod_cd + ':' + schdDay + ':' + htlCd"
    properties:
      schdDay: schdDay
      htlKoNm: htlKoNm
      packageHotelId: package_hotel_id
      matched: "package_hotel_id IS NOT NULL AND package_hotel_id != ''"`);
  }

  if (o.flightSegmentVertex) {
    vertices.push(`  - label: Airport
    from: { table: package_airport, distinct: [depAptCd, depAptNm] }
    id: "depAptCd"
    properties: { airportName: depAptNm }`);
    vertices.push(`  - label: Airline
    from: { table: package_airport, distinct: [airlCd, airlNm] }
    id: "airlCd"
    properties: { airlineName: airlNm }`);
    vertices.push(`  - label: FlightSegment
    from: { table: package_airport }
    id: "'FlightSegment:' + saleProdCd + ':' + segReq"
    properties:
      segReq: segReq`);
  }

  if (o.themeVertex) {
    vertices.push(`  - label: Theme
    from: { table: package_attraction, explode_json: featureThemeTagsJson, distinct: [$item] }
    id: "$item"
    properties: { code: "$item" }`);
  }
  if (o.moodVertex) {
    vertices.push(`  - label: Mood
    from: { table: package_attraction, explode_json: featureMoodTagsJson, distinct: [$item] }
    id: "$item"
    properties: { code: "$item" }`);
  }
  if (o.seasonVertex) {
    vertices.push(`  - label: Season
    from: { table: package_attraction, explode_json: featureSeasonalityTagsJson, distinct: [$item] }
    id: "$item"
    properties: { code: "$item" }`);
  }

  // Edges
  edges.push(`  - type: IN_COUNTRY
    from: { table: city, where: "country_code IS NOT NULL" }
    source: { vertex: City, match_by: city_code }
    target: { vertex: Country, match_by: country_code }`);

  if (o.prefectureVertex) {
    edges.push(`  - type: IN_PREFECTURE
    from: { table: city, where: "state_code IS NOT NULL" }
    source: { vertex: City, match_by: city_code }
    target: { vertex: Prefecture, match_by: state_code }`);
  }

  edges.push(`  - type: ATTRACTION_IN_CITY
    from: { table: package_attraction, where: "cityCode IS NOT NULL" }
    source: { vertex: Attraction, match_by: id }
    target: { vertex: City, match_by: cityCode }`);

  if (o.representativeSplit) {
    edges.push(`  - type: INSTANCE_OF
    from: { table: package_product_meta }
    source: { vertex: SaleProduct, match_by: saleProdCd }
    target: { vertex: RepresentativeProduct, match_by: rprsProdCd }`);
  }

  edges.push(`  - type: ARRIVES_IN
    from: { table: package_product_meta, where: "arrCityCd IS NOT NULL" }
    source: { vertex: SaleProduct, match_by: saleProdCd }
    target: { vertex: City, match_by: arrCityCd }`);

  if (o.departureMarketVertex) {
    edges.push(`  - type: DEPARTS_FROM_MARKET
    from: { table: package_product_meta, where: "depCityCd IS NOT NULL" }
    source: { vertex: SaleProduct, match_by: saleProdCd }
    target: { vertex: DepartureMarket, match_by: depCityCd }`);
  }

  edges.push(`  - type: VISITS_CITY
    from: { table: package_product_meta, explode_csv: vistCity }
    source: { vertex: SaleProduct, match_by: saleProdCd }
    target: { vertex: City, match_by: "$item" }`);

  edges.push(`  - type: HAS_SCHEDULED_ATTRACTION
    from: { table: package_product_schedules, where: "attractionId IS NOT NULL" }
    source: { vertex: SaleProduct, match_by: saleProdCd }
    target: { vertex: Attraction, match_by: attractionId }
    properties:
      schdDay: schdDay
      visitOrder: schtExprSqc`);

  if (o.hotelStayVertex) {
    edges.push(`  - type: HAS_HOTEL_STAY
    from: { table: package_hotel_stay }
    source: { vertex: SaleProduct, match_by: sale_prod_cd }
    target: { vertex: HotelStay, match_by: "'HotelStay:' + sale_prod_cd + ':' + schdDay + ':' + htlCd" }`);
    edges.push(`  - type: MATCHED_TO
    from: { table: package_hotel_stay, where: "package_hotel_id IS NOT NULL AND package_hotel_id != ''" }
    source: { vertex: HotelStay, match_by: "'HotelStay:' + sale_prod_cd + ':' + schdDay + ':' + htlCd" }
    target: { vertex: Hotel, match_by: package_hotel_id }`);
  }

  if (o.flightSegmentVertex) {
    edges.push(`  - type: HAS_FLIGHT_SEGMENT
    from: { table: package_airport }
    source: { vertex: SaleProduct, match_by: saleProdCd }
    target: { vertex: FlightSegment, match_by: "'FlightSegment:' + saleProdCd + ':' + segReq" }`);
    edges.push(`  - type: DEPARTS_FROM
    from: { table: package_airport, where: "depAptCd IS NOT NULL" }
    source: { vertex: FlightSegment, match_by: "'FlightSegment:' + saleProdCd + ':' + segReq" }
    target: { vertex: Airport, match_by: depAptCd }`);
    edges.push(`  - type: ARRIVES_AT
    from: { table: package_airport, where: "arrAptCd IS NOT NULL" }
    source: { vertex: FlightSegment, match_by: "'FlightSegment:' + saleProdCd + ':' + segReq" }
    target: { vertex: Airport, match_by: arrAptCd }`);
    edges.push(`  - type: OPERATED_BY
    from: { table: package_airport, where: "airlCd IS NOT NULL" }
    source: { vertex: FlightSegment, match_by: "'FlightSegment:' + saleProdCd + ':' + segReq" }
    target: { vertex: Airline, match_by: airlCd }`);
  }

  if (o.themeVertex) {
    edges.push(`  - type: HAS_THEME
    from: { table: package_attraction, explode_json: featureThemeTagsJson }
    source: { vertex: Attraction, match_by: id }
    target: { vertex: Theme, match_by: "$item" }`);
  }
  if (o.moodVertex) {
    edges.push(`  - type: HAS_MOOD
    from: { table: package_attraction, explode_json: featureMoodTagsJson }
    source: { vertex: Attraction, match_by: id }
    target: { vertex: Mood, match_by: "$item" }`);
  }
  if (o.seasonVertex) {
    edges.push(`  - type: HAS_SEASONALITY
    from: { table: package_attraction, explode_json: featureSeasonalityTagsJson }
    source: { vertex: Attraction, match_by: id }
    target: { vertex: Season, match_by: "$item" }`);
  }

  if (o.coVisited) {
    derived.push(`  - type: CO_VISITED
    kind: attraction_co_occurrence
    params: { table: package_product_schedules, group_by: saleProdCd, pair_column: attractionId, support_min: ${o.coVisitedSupport} }`);
  }
  if (o.visitedAfter) {
    derived.push(`  - type: VISITED_AFTER
    kind: attraction_sequence
    params: { table: package_product_schedules, partition_by: [saleProdCd, schdDay], order_by: schtExprSqc, item_column: attractionId, support_min: ${o.coVisitedSupport} }`);
  }
  if (o.nearCity) {
    derived.push(`  - type: NEAR_CITY
    kind: haversine
    params: { vertex: City, lat_prop: latitude, lng_prop: longitude, threshold_km: ${o.nearCityKm} }`);
  }
  if (o.oftenCotraveled) {
    derived.push(`  - type: OFTEN_COTRAVELED
    kind: list_co_occurrence
    params: { table: package_product_meta, list_column: vistCity, separator: ",", support_min: 2 }`);
  }

  const yaml = [
    `name: "${o.name}"`,
    `description: "${o.description}"`,
    `version: "0.5"`,
    `slot: ${o.slot}`,
    ``,
    `source: { sqlite: "../graph-study/osaka_subset/graph_hotel_info_osaka.sqlite" }`,
    ``,
    `vertices:`,
    vertices.join('\n\n'),
    ``,
    `edges:`,
    edges.join('\n\n'),
    ``,
    derived.length > 0 ? `derived:\n${derived.join('\n\n')}` : `derived: []`,
    ``,
    `options: { batch_size: 100 }`,
  ].join('\n');

  return yaml;
}

type Props = {
  slot: 'A' | 'B' | 'C';
  options: SimpleOptions;
  onChange: (o: SimpleOptions) => void;
};

export default function SimpleModeEditor({ slot, options, onChange }: Props) {
  const [local, setLocal] = useState<SimpleOptions>(options);

  useEffect(() => setLocal(options), [options]);

  function update(patch: Partial<SimpleOptions>) {
    const next = { ...local, ...patch };
    setLocal(next);
    onChange(next);
  }

  const metrics = useMemo(() => {
    let v = 6; // Country, City, SaleProduct, Attraction, Hotel 기본 + country는 항상
    if (local.prefectureVertex) v++;
    if (local.departureMarketVertex) v++;
    if (local.representativeSplit) v++;
    if (local.hotelStayVertex) v++;
    if (local.flightSegmentVertex) v += 3; // Airport, Airline, FlightSegment
    if (local.themeVertex) v++;
    if (local.moodVertex) v++;
    if (local.seasonVertex) v++;

    let e = 4; // IN_COUNTRY, ATTRACTION_IN_CITY, ARRIVES_IN, VISITS_CITY, HAS_SCHEDULED_ATTRACTION
    if (local.prefectureVertex) e++;
    if (local.representativeSplit) e++;
    if (local.departureMarketVertex) e++;
    if (local.hotelStayVertex) e += 2;
    if (local.flightSegmentVertex) e += 4;
    if (local.themeVertex) e++;
    if (local.moodVertex) e++;
    if (local.seasonVertex) e++;

    let d = 0;
    if (local.coVisited) d++;
    if (local.visitedAfter) d++;
    if (local.nearCity) d++;
    if (local.oftenCotraveled) d++;

    return { v, e, d };
  }, [local]);

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h3">기본 정보</Header>}>
        <SpaceBetween size="s">
          <FormField label="스키마 이름">
            <Input value={local.name} onChange={({ detail }) => update({ name: detail.value })} />
          </FormField>
          <FormField label="설명">
            <Input
              value={local.description}
              onChange={({ detail }) => update({ description: detail.value })}
            />
          </FormField>
          <Alert type="info">
            현재 구성 예상: <b>Vertex {metrics.v}</b> · <b>Edge {metrics.e}</b> ·{' '}
            <b>Derived {metrics.d}</b>. 체크를 켤수록 LLM이 풀 수 있는 질의가 늘어납니다. Slot:{' '}
            <b>{slot}</b>
          </Alert>
        </SpaceBetween>
      </Container>

      <Container
        header={
          <Header
            variant="h3"
            description="feature*Json 컬럼을 별도 vertex로 쪼개면 '로맨틱한 관광지' 같은 태그 필터가 edge traversal로 풀립니다."
          >
            1. 태그 분해 (Theme / Mood / Season)
          </Header>
        }
      >
        <SpaceBetween size="xs">
          <Checkbox
            checked={local.themeVertex}
            onChange={({ detail }) => update({ themeVertex: detail.checked })}
          >
            <b>featureThemeTagsJson</b> → Theme 노드 + HAS_THEME edge (LANDMARK, NATURE, CULTURE…)
          </Checkbox>
          <Checkbox
            checked={local.moodVertex}
            onChange={({ detail }) => update({ moodVertex: detail.checked })}
          >
            <b>featureMoodTagsJson</b> → Mood 노드 + HAS_MOOD edge (ROMANTIC, CALM, ICONIC…)
          </Checkbox>
          <Checkbox
            checked={local.seasonVertex}
            onChange={({ detail }) => update({ seasonVertex: detail.checked })}
          >
            <b>featureSeasonalityTagsJson</b> → Season 노드 + HAS_SEASONALITY edge (CHERRY_BLOSSOM,
            AUTUMN_LEAVES…)
          </Checkbox>
        </SpaceBetween>
      </Container>

      <Container
        header={
          <Header
            variant="h3"
            description="city.state_code를 Prefecture로 승격하면 '간사이 광역' 같은 결정론적 질의 가능."
          >
            2. 지리 계층 · 근접 관계
          </Header>
        }
      >
        <SpaceBetween size="xs">
          <Checkbox
            checked={local.prefectureVertex}
            onChange={({ detail }) => update({ prefectureVertex: detail.checked })}
          >
            <b>Prefecture 노드 승격</b> + IN_PREFECTURE edge (오사카부, 교토부, 효고현…)
          </Checkbox>
          <Checkbox
            checked={local.nearCity}
            onChange={({ detail }) => update({ nearCity: detail.checked })}
          >
            <b>NEAR_CITY edge</b> (좌표 기반, 거리 ≤ {local.nearCityKm}km)
          </Checkbox>
          {local.nearCity && (
            <Box padding={{ left: 'l' }}>
              <FormField label="거리 threshold (km)">
                <Input
                  type="number"
                  value={String(local.nearCityKm)}
                  onChange={({ detail }) => update({ nearCityKm: Number(detail.value) })}
                />
              </FormField>
            </Box>
          )}
          <Checkbox
            checked={local.oftenCotraveled}
            onChange={({ detail }) => update({ oftenCotraveled: detail.checked })}
          >
            <b>OFTEN_COTRAVELED edge</b> (vistCity 공동 출현, support ≥ 2) — "상품화 관행상 묶어 파는 도시"
          </Checkbox>
        </SpaceBetween>
      </Container>

      <Container
        header={
          <Header
            variant="h3"
            description="복합 키 fact를 별도 vertex로 승격하면 '이 호텔 쓰는 다른 상품' 같은 역탐색이 자연스러워집니다."
          >
            3. 사실 노드 승격 (HotelStay / FlightSegment / RP)
          </Header>
        }
      >
        <SpaceBetween size="xs">
          <Checkbox
            checked={local.representativeSplit}
            onChange={({ detail }) => update({ representativeSplit: detail.checked })}
          >
            <b>SaleProduct ↔ RepresentativeProduct 분리</b> (INSTANCE_OF edge) — "같은 대표상품의 다른 출발일"
          </Checkbox>
          <Checkbox
            checked={local.hotelStayVertex}
            onChange={({ detail }) => update({ hotelStayVertex: detail.checked })}
          >
            <b>HotelStay vertex 승격</b> (HAS_HOTEL_STAY + MATCHED_TO) — "몇일차에 어느 호텔"
          </Checkbox>
          <Checkbox
            checked={local.flightSegmentVertex}
            onChange={({ detail }) => update({ flightSegmentVertex: detail.checked })}
          >
            <b>FlightSegment / Airport / Airline 분리</b> (4 edge) — "간사이공항 귀국편" 같은 질의
          </Checkbox>
          <Checkbox
            checked={local.departureMarketVertex}
            onChange={({ detail }) => update({ departureMarketVertex: detail.checked })}
          >
            <b>DepartureMarket 분리</b> (depCityCd 네임스페이스) — "김포 출발 상품"
          </Checkbox>
        </SpaceBetween>
      </Container>

      <Container
        header={
          <Header
            variant="h3"
            description="원 데이터엔 없지만 그래프 연산으로 만드는 관계. 추론·환각차단의 핵심."
          >
            4. 파생 edge
          </Header>
        }
      >
        <SpaceBetween size="xs">
          <Checkbox
            checked={local.coVisited}
            onChange={({ detail }) => update({ coVisited: detail.checked })}
          >
            <b>CO_VISITED</b> — 같은 상품에 함께 등장한 관광지 쌍 (support ≥ {local.coVisitedSupport})
          </Checkbox>
          <Checkbox
            checked={local.visitedAfter}
            onChange={({ detail }) => update({ visitedAfter: detail.checked })}
          >
            <b>VISITED_AFTER</b> — 같은 일차 내 관광지 순서 (support ≥ {local.coVisitedSupport})
          </Checkbox>
          {(local.coVisited || local.visitedAfter) && (
            <Box padding={{ left: 'l' }}>
              <FormField label="공동방문 support threshold">
                <Input
                  type="number"
                  value={String(local.coVisitedSupport)}
                  onChange={({ detail }) => update({ coVisitedSupport: Number(detail.value) })}
                />
              </FormField>
            </Box>
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
