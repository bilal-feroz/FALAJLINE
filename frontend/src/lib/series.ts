import { fmtDay } from "./format";
import type { Bundle, ScenarioForecast, Sensor } from "./types";

export interface ChartPoint {
  date: string;
  label: string;
  rel: number; // days relative to today (negative = history)
  obs: number | null; // simulated sensor observation (daily mean); null where readings are missing
  value: number | null; // forecast central
  band: [number, number] | null; // P10–P90
  required: number | null; // demand the supply must meet
}

function sensor(data: Bundle, id: string): Sensor | undefined {
  return data.telemetry.sensors.find((s) => s.id === id);
}

/** Daily means summed across sensors. A day is a gap if any contributing sensor has no value for it. */
function historySum(data: Bundle, ids: string[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const series = ids.map((id) => sensor(data, id)?.daily ?? []);
  if (!series.length || !series[0].length) return out;
  series[0].forEach((d, i) => {
    let sum: number | null = 0;
    for (const s of series) {
      const v = s[i]?.mean ?? null;
      if (v === null) {
        sum = null;
        break;
      }
      sum += v;
    }
    out.set(d.date, sum);
  });
  return out;
}

function build(
  data: Bundle,
  sc: ScenarioForecast,
  history: Map<string, number | null>,
  central: number[],
  p10: number[],
  p90: number[],
  required: number[] | null,
): ChartPoint[] {
  const today = sc.dates[0];
  const points: ChartPoint[] = [];
  const past = [...history.keys()].filter((d) => d < today).sort();
  past.forEach((date, i) => {
    points.push({ date, label: fmtDay(date), rel: i - past.length, obs: history.get(date) ?? null, value: null, band: null, required: null });
  });
  sc.dates.forEach((date, i) => {
    points.push({
      date,
      label: fmtDay(date),
      rel: i,
      obs: i === 0 ? (history.get(date) ?? null) : null,
      value: central[i],
      band: [p10[i], p90[i]],
      required: required ? required[i] * sc.required_supply_ratio : null,
    });
  });
  return points;
}

/** Supply against demand for the whole system or one zone, with simulated observations as history. */
export function supplySeries(data: Bundle, sc: ScenarioForecast, target: string): ChartPoint[] {
  if (target === "system") {
    const ids = sc.zones.map((z) => `S-OUT-${z.id}`);
    return build(data, sc, historySum(data, ids), sc.system.supply_lps.central, sc.system.supply_lps.p10, sc.system.supply_lps.p90, sc.system.demand_lps.central);
  }
  const z = sc.zones.find((x) => x.id === target) ?? sc.zones[0];
  return build(data, sc, historySum(data, [`S-OUT-${z.id}`]), z.supply_lps.central, z.supply_lps.p10, z.supply_lps.p90, z.demand_lps);
}

export function sourceSeries(data: Bundle, sc: ScenarioForecast, kind: "head" | "flow"): ChartPoint[] {
  if (kind === "head") {
    return build(data, sc, historySum(data, ["S-GW-01"]), sc.source.head_m.central, sc.source.head_m.p10, sc.source.head_m.p90, null);
  }
  return build(data, sc, historySum(data, ["S-FL-MAIN"]), sc.main.flow_lps.central, sc.main.flow_lps.p10, sc.main.flow_lps.p90, null);
}

/** First and last forecast day on which the central supply is below the requirement. */
export function shortageWindow(points: ChartPoint[]): { from: string; to: string } | null {
  const short = points.filter((p) => p.value !== null && p.required !== null && p.value < p.required);
  return short.length ? { from: short[0].label, to: short[short.length - 1].label } : null;
}
