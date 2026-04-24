/**
 * Mapping DSL types (v0.5).
 * See docs/SPEC.md §5 for semantics.
 */

export type MappingConfig = {
  name: string;
  description?: string;
  version?: string;
  slot: 'A' | 'B' | 'C';
  source?: { sqlite?: string };
  vertices: VertexMapping[];
  edges: EdgeMapping[];
  derived?: DerivedMapping[];
  options?: { batch_size?: number };
};

export type VertexMapping = {
  label: string;
  from: {
    table: string;
    where?: string;
    distinct?: string[];
    explode_json?: string; // column name of JSON array
    explode_csv?: string; // column name of CSV string
  };
  id: string; // SQL expression or column name; may contain $item
  properties?: Record<string, string>;
};

export type EdgeMapping = {
  type: string;
  from: {
    table: string;
    where?: string;
    explode_json?: string;
    explode_csv?: string;
  };
  source: { vertex: string; match_by: string };
  target: { vertex: string; match_by: string };
  properties?: Record<string, string>;
};

export type DerivedKind =
  | 'attraction_co_occurrence'
  | 'attraction_sequence'
  | 'haversine'
  | 'list_co_occurrence'
  | 'jaccard_similarity'
  | 'declared_fact'
  | 'city_cluster';

export type DerivedMapping =
  | {
      type: string;
      kind: 'attraction_co_occurrence';
      params: {
        table: string;
        group_by: string;
        pair_column: string;
        support_min: number;
      };
    }
  | {
      type: string;
      kind: 'attraction_sequence';
      params: {
        table: string;
        partition_by: string[];
        order_by: string;
        item_column: string;
        support_min: number;
      };
    }
  | {
      type: string;
      kind: 'haversine';
      params: {
        vertex: string;
        lat_prop: string;
        lng_prop: string;
        threshold_km: number;
      };
    }
  | {
      type: string;
      kind: 'list_co_occurrence';
      params: {
        table: string;
        list_column: string;
        separator: string;
        support_min: number;
      };
    }
  | {
      type: string;
      kind: 'jaccard_similarity';
      params: {
        vertex: string;
        table: string;
        id_column: string;
        tokens_column: string;
        item_source: 'explode_json' | 'explode_csv';
        separator?: string;
        min_overlap: number;
        min_jaccard: number;
      };
    }
  | {
      type: string;
      kind: 'declared_fact';
      params: {
        vertex: string;
        pairs: Array<{ a: string; b: string; note?: string }>;
        directed: boolean;
      };
    }
  | {
      type: string;
      kind: 'city_cluster';
      params: {
        vertex: string;
        cluster_name: string;
        members: string[];
      };
    };
