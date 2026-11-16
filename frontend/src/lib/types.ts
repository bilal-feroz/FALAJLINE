// Shapes returned by the FALAJLINE backend (GET /api/state).

export type RiskLevel = "NORMAL" | "WATCH" | "PREPARE" | "ACT";
export type Provenance = "observed" | "simulated" | "modelled" | "unavailable" | "conceptual" | "representative";
export type SensorStatus = "ok" | "stale" | "offline" | "stuck";
export type Grade = "HIGH" | "MODERATE" | "LOW";

export interface Band {
  central: number[];
  p10: number[];
  p90: number[];
}

export interface ConfidenceFactor {
  key: string;
  label: string;
  status: "ok" | "degraded" | "missing" | "limit";
  impact: number;
  detail: string;
}

export interface Confidence {
  index: number;
  grade: Grade;
  factors: ConfidenceFactor[];
  supporting: ConfidenceFactor[];
  method: string;
}

export interface ZoneForecast {
  id: string;
  name: string;
  branch: string;
  position: "head" | "tail";
  area_ha: number;
  demand_lps: number[];
  supply_lps: Band;
  ratio: Band;
  p_short: number[];
  risk: RiskLevel[];
  deficit_lps: number[];
  deficit_m3_total: number;
  shortfall: {
    predicted: boolean;
    first_day: number | null;
    first_date: string | null;
    earliest_day: number | null;
    earliest_date: string | null;
    latest_day: number | null;
    latest_date: string | null;
    last_day: number | null;
    continues_beyond_horizon: boolean;
    ensemble_share: number;
    peak_deficit_pct: number;
  };
}

export interface BranchForecast {
  id: string;
  name: string;
  share: number;
  flow_lps: number[];
  loss_lps: number[];
  delivered_lps: number[];
  capacity_lps: number;
  excess_loss: number;
  risk: RiskLevel[];
}

export interface Guidance {
  level: RiskLevel;
  headline: string;
  action: string;
  zones_short: string[];
}

export interface ScenarioForecast {
  scenario: { id: string; label: string; description: string; demand_reduction: number; loss_reduction: number; repair_anomalies: boolean };
  provenance: Provenance;
  start_date: string;
  dates: string[];
  horizon_days: number;
  required_supply_ratio: number;
  ensemble_members: number;
  rotation_days: number;
  weather_basis: { et0_mm: number; et0_rotation_mm: number; source: string; provenance: Provenance; precip_mm: number | null }[];
  source: { head_m: Band; discharge_lps: Band; recharge_m3d: number[] };
  main: { flow_lps: Band; divider_lps: number[]; capacity_lps: number };
  branches: BranchForecast[];
  zones: ZoneForecast[];
  system: {
    supply_lps: Band;
    demand_lps: Band;
    ratio: Band;
    risk: RiskLevel[];
    zones_short: string[][];
    zones_at_risk: string[][];
    first_shortfall_day: number | null;
    first_shortfall_date: string | null;
    first_system_shortfall_day: number | null;
    deficit_m3_total: number;
  };
  balance: {
    source_lps: number[];
    delivered_lps: number[];
    tunnel_loss_lps: number[];
    main_loss_lps: number[];
    branch_loss_lps: number[];
    spill_lps: number[];
    max_abs_residual_lps: number;
  };
  notes: string[];
  guidance: Guidance[];
  confidence: { system: { index: number; grade: Grade }[]; zones: Record<string, { index: number; grade: Grade }[]> };
}

export interface Sensor {
  id: string;
  kind: "level" | "flow";
  label: string;
  unit: string;
  component: string;
  lon: number;
  lat: number;
  provenance: Provenance;
  interval_min: number;
  status: SensorStatus;
  status_detail: string;
  injected_fault: string | null;
  last_value: number | null;
  last_time: string | null;
  age_min: number | null;
  valid_24h: number;
  expected_24h: number;
  rejected: { time: string; value: number; reason: string }[];
  hourly: { start: string; values: (number | null)[] };
  daily: { date: string; mean: number | null; n: number }[];
}

export interface SatellitePass {
  time: string;
  status: "valid" | "cloud_obscured";
  zones: Record<string, number | null>;
}

export interface Telemetry {
  provenance: Provenance;
  label: string;
  note: string;
  as_of: string;
  sensors: Sensor[];
  health: Record<SensorStatus, number>;
  faults: Record<string, string>;
  fault_modes: string[];
  satellite: {
    id: string;
    provenance: Provenance;
    label: string;
    note: string;
    revisit_days: number;
    passes: SatellitePass[];
    latest_valid_age_days: number | null;
    latest_status: string;
  };
}

export interface WeatherDay {
  date: string;
  kind: "past" | "today" | "forecast";
  t_mean_c: number | null;
  t_max_c: number | null;
  t_min_c: number | null;
  rh_mean_pct: number | null;
  wind_mean_ms: number | null;
  rad_mean_w: number | null;
  precip_mm: number | null;
  evaporation_mm: number | null;
  et_provider_mm: number | null;
  et0_fao_mm: number | null;
  et0_mm: number | null;
  et0_source: string;
  et0_provenance: Provenance;
  provenance: Provenance;
  missing: string[];
}

export interface WeatherLocation {
  id: string;
  name: string;
  role: string;
  lat: number;
  lon: number;
  elevation_m: number;
  daily: WeatherDay[];
  current: { time: string | null; t_c: number | null; rh_pct: number | null; wind_ms: number | null; rad_w: number | null; provenance: Provenance };
}

export interface Weather {
  mode: "live" | "demo";
  status: "ok" | "stale" | "demo" | "live_failed";
  source: string;
  notice: string | null;
  live_error: { kind: string; status: number | null; message: string } | null;
  retrieved_at: string;
  forecast_issued_at: string | null;
  cache: { hit: boolean; age_s: number; ttl_s: number };
  queries: { path: string; elapsed_ms: number; status: string }[];
  queries_today: number;
  parameters: { id: string; label: string; status: string }[];
  locations: WeatherLocation[];
  today: string;
}

export interface WarningFactor {
  key: string;
  label: string;
  detail: string;
  points: number | null;
  direction: "adverse" | "relief";
}

export interface WarningAction {
  priority: number;
  action: string;
  rationale: string;
  owner: string;
}

export interface Warning {
  id: string;
  type: "supply_shortfall" | "source_recession" | "branch_anomaly";
  level: RiskLevel;
  raw_level: RiskLevel;
  held_back: boolean;
  persistence: { raw: RiskLevel; issued: RiskLevel; held_back: boolean; history: RiskLevel[]; reason: string } | null;
  title: string;
  summary: string;
  source: { id: string; name: string };
  branch: string | null;
  affected_zones: string[];
  window: {
    predicted: boolean;
    start_day: number | null;
    start_date: string | null;
    earliest_day?: number | null;
    earliest_date?: string | null;
    latest_day?: number | null;
    latest_date?: string | null;
    end_date?: string | null;
    continues_beyond_horizon: boolean;
    lead_days: number | null;
    peak_deficit_pct?: number;
    deficit_m3_total?: number;
    ensemble_share?: number;
    margin_today_pct?: number;
    flow_today_lps?: number;
    flow_end_lps?: number;
  };
  confidence: Confidence;
  factors: WarningFactor[];
  actions: WarningAction[];
  sms: { en: string; ar: string; chars_en: number; segments_en: number; segments_ar: number } | null;
  issued_at: string;
}

export interface Notice {
  id: string;
  sensor: string;
  status: string;
  title: string;
  detail: string;
  action: string;
}

export interface Warnings {
  issued_at: string;
  system_level: RiskLevel;
  counts: Record<"ACT" | "PREPARE" | "WATCH", number>;
  warnings: Warning[];
  notices: Notice[];
  persistence_rule: string;
  corroborated: boolean;
}

export interface QueueMessage {
  id: string;
  warning_id: string;
  level: RiskLevel;
  recipient: string;
  number: string;
  channel: string;
  body: string;
  body_ar: string | null;
  status: string;
  status_label: string;
  group: "pending" | "retrying" | "delivered" | "failed";
  attempts: number;
  max_attempts: number;
  created_at: number;
  delivered_at: number | null;
  last_error: string | null;
  retry_in_s: number | null;
  waiting_for_link: boolean;
  history: { t: number; event: string }[];
}

export interface Queue {
  simulated: boolean;
  provider: string | null;
  note: string;
  link_online: boolean;
  counts: Record<"pending" | "retrying" | "delivered" | "failed", number>;
  messages: QueueMessage[];
  server_time: number;
}

export interface GeoZone {
  id: string;
  name: string;
  branch: string;
  area_ha: number;
  centroid: { lat: number; lon: number };
  polygon: [number, number][];
}

export interface Geo {
  oasis: { name: string; center: { lat: number; lon: number }; bbox: [number, number, number, number]; area_ha: number; outline: [number, number][]; source: string; license: string };
  zones: GeoZone[];
  network: {
    note: string;
    mother_well: [number, number];
    sharia: [number, number];
    divider: [number, number];
    tunnel: [number, number][];
    access_shafts: [number, number][];
    main_channel: [number, number][];
    branches: Record<string, [number, number][]>;
    branch_heads: Record<string, [number, number]>;
  };
  recharge_area: { lat: number; lon: number; name: string };
  reference_facts: { fact: string; source: string }[];
  glossary: Record<string, string>;
  tunnel_length_km: number;
  mother_well_depth_m: number;
}

export interface ComparisonRow {
  id: string;
  label: string;
  description: string;
  first_shortfall_day: number | null;
  first_shortfall_date: string | null;
  days_gained: number | null;
  beyond_horizon: boolean;
  zones_short_by_end: number;
  zones_ever_short: number;
  deficit_m3_total: number;
  end_ratio: number;
  min_zone_ratio: number;
}

export interface BranchCheck {
  branch: string;
  verifiable: boolean;
  observed_efficiency: number | null;
  design_efficiency: number;
  excess_loss: number;
  anomaly: boolean;
  samples: number;
  age_h: number | null;
  note: string;
}

export interface Bundle {
  meta: {
    generated_at: string;
    local_time: string;
    timezone: string;
    today: string;
    sim_anchor: string;
    provenance_legend: Record<string, string>;
    disclaimer: string;
    scenario_settings: { demand_reduction: number; loss_reduction: number };
  };
  geo: Geo;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  params: any;
  weather: Weather;
  telemetry: Telemetry;
  state: {
    head_m: number;
    head_sd: number;
    trend_m_per_day: number;
    trend_se: number;
    basis: string;
    basis_label: string;
    points: number;
    data_age_h: number;
    main_bias: number;
    main_bias_basis: string;
    flow_observed: boolean;
    corroborated_decline: boolean;
    branch_checks: BranchCheck[];
    notes: string[];
  };
  confidence: { method: string; system: Confidence; zones: Record<string, Confidence> };
  scenarios: Record<string, ScenarioForecast>;
  scenario_order: string[];
  comparison: ComparisonRow[];
  warnings: Warnings;
  queue: Queue;
}

export interface EadWells {
  available: boolean;
  source?: string;
  note?: string;
  reason?: string;
  wells: { id: string; frequency: string; lon: number; lat: number }[];
}

export type Selection = { type: "source" | "tunnel" | "main" | "branch" | "zone" | "sensor"; id: string };
