import type { ComponentId } from './question-requirements';

export type BuildParams = {
  name: string;
  description: string;
  slot: 'A' | 'B' | 'C';
  components: Set<ComponentId>;
  coVisitedSupport?: number;
  nearCityKm?: number;
};

export function buildYamlFromComponents(p: BuildParams): string {
  const has = (id: ComponentId) => p.components.has(id);
  const coSupport = p.coVisitedSupport ?? 3;
  const nearKm = p.nearCityKm ?? 100;

  const vertices: string[] = [];
  const edges: string[] = [];
  const derived: string[] = [];

  // ── Base (always) ─────────────────────────────
  vertices.push(`  - label: Country
    from: { table: country }
    id: "code"
    properties: { name: name }`);

  if (has('prefecture_vertex')) {
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

  if (has('departure_market_vertex')) {
    vertices.push(`  - label: DepartureMarket
    from: { table: package_product_meta, distinct: [depCityCd, depCityNm] }
    id: "depCityCd"
    properties: { marketName: depCityNm }`);
  }

  if (has('representative_split')) {
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

  if (has('hotel_stay_vertex')) {
    vertices.push(`  - label: HotelStay
    from: { table: package_hotel_stay }
    id: "'HotelStay:' + sale_prod_cd + ':' + schdDay + ':' + htlCd"
    properties:
      schdDay: schdDay
      htlKoNm: htlKoNm
      packageHotelId: package_hotel_id
      matched: "package_hotel_id IS NOT NULL AND package_hotel_id != ''"`);
  }

  if (has('flight_segment_vertex')) {
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
    properties: { segReq: segReq }`);
  }

  if (has('theme_vertex')) {
    vertices.push(`  - label: Theme
    from: { table: package_attraction, explode_json: featureThemeTagsJson, distinct: [$item] }
    id: "$item"
    properties: { code: "$item" }`);
  }
  if (has('mood_vertex')) {
    vertices.push(`  - label: Mood
    from: { table: package_attraction, explode_json: featureMoodTagsJson, distinct: [$item] }
    id: "$item"
    properties: { code: "$item" }`);
  }
  if (has('season_vertex')) {
    vertices.push(`  - label: Season
    from: { table: package_attraction, explode_json: featureSeasonalityTagsJson, distinct: [$item] }
    id: "$item"
    properties: { code: "$item" }`);
  }

  // ── Edges ───────────────────────────────────
  edges.push(`  - type: IN_COUNTRY
    from: { table: city, where: "country_code IS NOT NULL" }
    source: { vertex: City, match_by: city_code }
    target: { vertex: Country, match_by: country_code }`);

  if (has('prefecture_vertex')) {
    edges.push(`  - type: IN_PREFECTURE
    from: { table: city, where: "state_code IS NOT NULL" }
    source: { vertex: City, match_by: city_code }
    target: { vertex: Prefecture, match_by: state_code }`);
  }

  edges.push(`  - type: ATTRACTION_IN_CITY
    from: { table: package_attraction, where: "cityCode IS NOT NULL" }
    source: { vertex: Attraction, match_by: id }
    target: { vertex: City, match_by: cityCode }`);

  if (has('representative_split')) {
    edges.push(`  - type: INSTANCE_OF
    from: { table: package_product_meta }
    source: { vertex: SaleProduct, match_by: saleProdCd }
    target: { vertex: RepresentativeProduct, match_by: rprsProdCd }`);
  }

  edges.push(`  - type: ARRIVES_IN
    from: { table: package_product_meta, where: "arrCityCd IS NOT NULL" }
    source: { vertex: SaleProduct, match_by: saleProdCd }
    target: { vertex: City, match_by: arrCityCd }`);

  if (has('departure_market_vertex')) {
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

  if (has('hotel_stay_vertex')) {
    edges.push(`  - type: HAS_HOTEL_STAY
    from: { table: package_hotel_stay }
    source: { vertex: SaleProduct, match_by: sale_prod_cd }
    target: { vertex: HotelStay, match_by: "'HotelStay:' + sale_prod_cd + ':' + schdDay + ':' + htlCd" }`);
    edges.push(`  - type: MATCHED_TO
    from: { table: package_hotel_stay, where: "package_hotel_id IS NOT NULL AND package_hotel_id != ''" }
    source: { vertex: HotelStay, match_by: "'HotelStay:' + sale_prod_cd + ':' + schdDay + ':' + htlCd" }
    target: { vertex: Hotel, match_by: package_hotel_id }`);
  }

  if (has('flight_segment_vertex')) {
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

  if (has('theme_vertex')) {
    edges.push(`  - type: HAS_THEME
    from: { table: package_attraction, explode_json: featureThemeTagsJson }
    source: { vertex: Attraction, match_by: id }
    target: { vertex: Theme, match_by: "$item" }`);
  }
  if (has('mood_vertex')) {
    edges.push(`  - type: HAS_MOOD
    from: { table: package_attraction, explode_json: featureMoodTagsJson }
    source: { vertex: Attraction, match_by: id }
    target: { vertex: Mood, match_by: "$item" }`);
  }
  if (has('season_vertex')) {
    edges.push(`  - type: HAS_SEASONALITY
    from: { table: package_attraction, explode_json: featureSeasonalityTagsJson }
    source: { vertex: Attraction, match_by: id }
    target: { vertex: Season, match_by: "$item" }`);
  }

  if (has('co_visited')) {
    derived.push(`  - type: CO_VISITED
    kind: attraction_co_occurrence
    params: { table: package_product_schedules, group_by: saleProdCd, pair_column: attractionId, support_min: ${coSupport} }`);
  }
  if (has('visited_after')) {
    derived.push(`  - type: VISITED_AFTER
    kind: attraction_sequence
    params: { table: package_product_schedules, partition_by: [saleProdCd, schdDay], order_by: schtExprSqc, item_column: attractionId, support_min: ${coSupport} }`);
  }
  if (has('near_city')) {
    derived.push(`  - type: NEAR_CITY
    kind: haversine
    params: { vertex: City, lat_prop: latitude, lng_prop: longitude, threshold_km: ${nearKm} }`);
  }
  if (has('often_cotraveled')) {
    derived.push(`  - type: OFTEN_COTRAVELED
    kind: list_co_occurrence
    params: { table: package_product_meta, list_column: vistCity, separator: ",", support_min: 2 }`);
  }

  return [
    `name: "${p.name}"`,
    `description: "${p.description}"`,
    `version: "0.5"`,
    `slot: ${p.slot}`,
    '',
    `source: { sqlite: "../graph-study/osaka_subset/graph_hotel_info_osaka.sqlite" }`,
    '',
    `vertices:`,
    vertices.join('\n\n'),
    '',
    `edges:`,
    edges.join('\n\n'),
    '',
    derived.length > 0 ? `derived:\n${derived.join('\n\n')}` : `derived: []`,
    '',
    `options: { batch_size: 100 }`,
  ].join('\n');
}

export function estimateMetrics(comps: Set<ComponentId>): {
  vertex: number;
  edge: number;
  derived: number;
} {
  const has = (id: ComponentId) => comps.has(id);
  let v = 5; // Country, City, SaleProduct, Attraction, Hotel (base)
  if (has('prefecture_vertex')) v++;
  if (has('departure_market_vertex')) v++;
  if (has('representative_split')) v++;
  if (has('hotel_stay_vertex')) v++;
  if (has('flight_segment_vertex')) v += 3;
  if (has('theme_vertex')) v++;
  if (has('mood_vertex')) v++;
  if (has('season_vertex')) v++;

  let e = 4; // IN_COUNTRY, ATTRACTION_IN_CITY, ARRIVES_IN, VISITS_CITY, HAS_SCHEDULED_ATTRACTION (5 base, 일단 4)
  e = 5;
  if (has('prefecture_vertex')) e++;
  if (has('representative_split')) e++;
  if (has('departure_market_vertex')) e++;
  if (has('hotel_stay_vertex')) e += 2;
  if (has('flight_segment_vertex')) e += 4;
  if (has('theme_vertex')) e++;
  if (has('mood_vertex')) e++;
  if (has('season_vertex')) e++;

  let d = 0;
  if (has('co_visited')) d++;
  if (has('visited_after')) d++;
  if (has('near_city')) d++;
  if (has('often_cotraveled')) d++;

  return { vertex: v, edge: e, derived: d };
}
