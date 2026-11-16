"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { GradeChip, Panel, ProvTag, RiskChip } from "@/components/ui/primitives";
import { RISK_COLOR, fmt, fmtDay, inDays } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import type { Bundle, ScenarioForecast } from "@/lib/types";

export const SCENARIO_COLOR: Record<string, string> = {
  baseline: "#36c3b5",
  reduced_demand: "#cdb88c",
  improved_efficiency: "#4ea9d8",
};

const AXIS = { fontSize: 10, fill: "#6c7573", fontFamily: "var(--font-geist-mono)" };

function ratioOf(sc: ScenarioForecast, target: string): number[] {
  if (target === "system") return sc.system.ratio.central;
  return (sc.zones.find((z) => z.id === target) ?? sc.zones[0]).ratio.central;
}

/** Supply as a share of demand for all three scenarios. Each line is a separate run of the same model. */
export function ScenarioRatioChart({ target }: { target: string }) {
  const data = useStore((s) => s.data)!;
  const day = useStore((s) => s.day);
  const setDay = useStore((s) => s.setDay);
  const active = useStore((s) => s.scenarioId);
  const base = data.scenarios.baseline;
  const rows = base.dates.map((d, i) => {
    const row: Record<string, number | string> = { label: fmtDay(d), rel: i };
    for (const id of data.scenario_order) row[id] = +(ratioOf(data.scenarios[id], target)[i] * 100).toFixed(1);
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={60}>
      <LineChart
        data={rows}
        margin={{ top: 8, right: 10, bottom: 0, left: -14 }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={(e: any) => {
          const hit = rows.find((r) => r.label === e?.activeLabel);
          if (hit) setDay(hit.rel as number);
        }}
      >
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "#1c2223" }} interval={5} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={40} tickCount={4} domain={[(min: number) => Math.floor(min / 10) * 10, (max: number) => Math.ceil(max / 10) * 10]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
        <Tooltip
          isAnimationActive={false}
          cursor={{ stroke: "#2a3233" }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content={({ active: on, payload, label }: any) =>
            on && payload?.length ? (
              <div className="rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[11.5px] shadow-xl">
                <div className="num mb-1 text-fg">{label}</div>
                {data.scenario_order.map((id) => (
                  <div key={id} className="flex items-center justify-between gap-5">
                    <span className="flex items-center gap-1.5 text-fg-2">
                      <span className="h-0.5 w-3" style={{ background: SCENARIO_COLOR[id] }} />
                      {data.scenarios[id].scenario.label}
                    </span>
                    <span className={`num ${payload[0].payload[id] < 100 ? "text-act" : "text-fg"}`}>{payload[0].payload[id]}%</span>
                  </div>
                ))}
              </div>
            ) : null
          }
        />
        <ReferenceLine y={base.required_supply_ratio * 100} stroke="#e8eae7" strokeDasharray="4 3" strokeWidth={1.1} />
        <ReferenceLine x={fmtDay(base.dates[day])} stroke="#e8eae7" strokeWidth={1} />
        {data.scenario_order.map((id) => (
          <Line key={id} dataKey={id} stroke={SCENARIO_COLOR[id]} strokeWidth={id === active ? 2.2 : 1.4} strokeOpacity={id === active ? 1 : 0.75} dot={false} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function Slider({ label, value, max, onCommit, hint }: { label: string; value: number; max: number; onCommit: (v: number) => void; hint: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  // debounce: recalculate once the handle rests
  useEffect(() => {
    if (local === value) return;
    const id = setTimeout(() => onCommit(local), 260);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] text-fg-2">{label}</span>
        <span className="num text-[13px] text-fg">{Math.round(local * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={local}
        onChange={(e) => setLocal(parseFloat(e.target.value))}
        className="mt-1 h-1 w-full cursor-pointer appearance-none rounded bg-line-2 accent-[#36c3b5]"
      />
      <div className="mt-0.5 text-[10.5px] text-fg-3">{hint}</div>
    </label>
  );
}

export function ScenarioPanel() {
  const data = useStore((s) => s.data)!;
  const active = useStore((s) => s.scenarioId);
  const setScenario = useStore((s) => s.setScenario);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const refreshing = useStore((s) => s.refreshing);

  return (
    <Panel
      title="Scenario comparison"
      right={
        <>
          {refreshing && <span className="font-mono text-[9.5px] tracking-wide text-water">RECALCULATING…</span>}
          <ProvTag kind="modelled" short />
        </>
      }
      className="shrink-0"
    >
      <div className="divide-y divide-line">
        {data.comparison.map((c) => {
          const on = c.id === active;
          return (
            <button key={c.id} onClick={() => setScenario(c.id)} className={`block w-full px-3 py-2 text-left transition-colors hover:bg-panel-2 ${on ? "bg-panel-2" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: SCENARIO_COLOR[c.id], background: on ? SCENARIO_COLOR[c.id] : "transparent" }} />
                <span className="text-[12.5px] font-medium text-fg">{c.label}</span>
                {c.days_gained !== null && c.days_gained > 0 && (
                  <span className="num ml-auto rounded-[3px] bg-water/10 px-1.5 py-px text-[10.5px] text-water">
                    {c.beyond_horizon ? "no shortfall in 21 d" : `+${c.days_gained} days of warning`}
                  </span>
                )}
              </div>
              {on && <div className="mt-0.5 pl-[18px] text-[10.5px] leading-snug text-fg-3">{c.description}</div>}
              <div className="num mt-1.5 grid grid-cols-4 gap-2 pl-[18px] text-[10.5px]">
                <div>
                  <div className="text-fg-3">first short</div>
                  <div className={c.first_shortfall_day === null ? "text-normal" : "text-fg"}>{c.first_shortfall_day === null ? "none" : fmtDay(c.first_shortfall_date)}</div>
                </div>
                <div>
                  <div className="text-fg-3">zones short</div>
                  <div className="text-fg">{c.zones_ever_short} of {data.geo.zones.length}</div>
                </div>
                <div>
                  <div className="text-fg-3">deficit 21 d</div>
                  <div className="text-fg">{fmt(c.deficit_m3_total, 0)} m³</div>
                </div>
                <div>
                  <div className="text-fg-3">worst zone</div>
                  <div className={c.min_zone_ratio < 1 ? "text-act" : "text-fg"}>{fmt(c.min_zone_ratio * 100, 0)}%</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="space-y-3 border-t border-line px-3 py-3">
        <Slider label="Demand reduction" value={settings.demand_reduction} max={0.4} onCommit={(v) => setSettings({ demand_reduction: v })} hint="Tighter rotation, deficit irrigation of understorey crops" />
        <Slider label="Surface-channel seepage cut" value={settings.loss_reduction} max={0.8} onCommit={(v) => setSettings({ loss_reduction: v })} hint="Repairs and lining; also removes detected branch leakage" />
        <p className="text-[10.5px] leading-snug text-fg-3">
          Moving a slider re-runs all three scenarios on the backend through the same {data.scenarios.baseline.ensemble_members}-member model. Nothing here is precomputed.
        </p>
      </div>
    </Panel>
  );
}

/** Where the water goes on the selected day: the model's balance closes to rounding error. */
export function BalanceBar() {
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const b = sc.balance;
  const parts = [
    { key: "Delivered to zones", v: b.delivered_lps[day], color: "#36c3b5" },
    { key: "Tunnel seepage", v: b.tunnel_loss_lps[day], color: "#8d7350" },
    { key: "Main channel seepage", v: b.main_loss_lps[day], color: "#a98f66" },
    { key: "Branch seepage and leakage", v: b.branch_loss_lps[day], color: "#cdb88c" },
    { key: "Spill over capacity", v: b.spill_lps[day], color: "#4ea9d8" },
  ];
  const total = b.source_lps[day];
  const sum = parts.reduce((a, p) => a + p.v, 0);
  return (
    <Panel
      title={`Water balance · ${fmtDay(sc.dates[day])}`}
      right={<span className="num text-[10px] text-fg-3">closure error over all runs {b.max_abs_residual_lps.toExponential(1)} L/s</span>}
      bodyClassName="px-3 py-2.5"
    >
      <div className="flex items-baseline gap-2">
        <span className="num text-[18px] leading-none text-fg">{fmt(total, 1)}</span>
        <span className="num text-[11px] text-fg-3">L/s leaves the mother well = {fmt(total * 86.4, 0)} m³/day</span>
      </div>
      <div className="mt-2 flex h-3 overflow-hidden rounded-sm">
        {parts.map((p) => (
          <div key={p.key} title={`${p.key}: ${fmt(p.v, 2)} L/s`} style={{ width: `${(p.v / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="num mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-fg-2">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ background: p.color }} />
            {p.key} <span className="text-fg">{fmt(p.v, 1)}</span>
            <span className="text-fg-3">{fmt((p.v / total) * 100, 0)}%</span>
          </span>
        ))}
        <span className="text-fg-3">sum {fmt(sum, 1)} L/s</span>
      </div>
    </Panel>
  );
}

export function DayDetail({ target }: { target: string }) {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const zone = sc.zones.find((z) => z.id === target);
  const supply = zone ? zone.supply_lps : sc.system.supply_lps;
  const demand = zone ? zone.demand_lps[day] : sc.system.demand_lps.central[day];
  const ratio = zone ? zone.ratio : sc.system.ratio;
  const risk = zone ? zone.risk[day] : sc.system.risk[day];
  const conf = zone ? sc.confidence.zones[zone.id][day] : sc.confidence.system[day];
  const first = zone ? zone.shortfall.first_day : sc.system.first_shortfall_day;
  const basis = sc.weather_basis[day];
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="text-[11.5px] text-fg-3">{k}</span>
      <span className="num text-right text-[12px] text-fg">{v}</span>
    </div>
  );
  return (
    <Panel
      title={`${zone ? `${zone.id} ${zone.name}` : "Whole oasis"} · ${fmtDay(sc.dates[day])}`}
      right={
        <>
          <RiskChip level={risk} />
          <GradeChip grade={conf.grade} index={conf.index} />
        </>
      }
      className="min-h-0 flex-1"
      bodyClassName="overflow-y-auto px-3 py-2"
    >
      {row("Delivered supply", `${fmt(supply.central[day], 1)} L/s`)}
      {row("P10 – P90", `${fmt(supply.p10[day], 1)} – ${fmt(supply.p90[day], 1)} L/s`)}
      {row("Required (demand)", `${fmt(demand * sc.required_supply_ratio, 1)} L/s`)}
      {row("Supply / demand", <span style={{ color: RISK_COLOR[risk] }}>{fmt(ratio.central[day] * 100, 0)}% <span className="text-fg-3">({fmt(ratio.p10[day] * 100, 0)}–{fmt(ratio.p90[day] * 100, 0)})</span></span>)}
      {zone && row("Ensemble runs short that day", `${fmt(zone.p_short[day] * 100, 0)}%`)}
      {row("First shortfall", first === null ? "none within 21 days" : `${fmtDay(sc.dates[first])} · ${first >= day ? inDays(first - day) : `${day - first} d earlier`}`)}
      {zone && zone.shortfall.predicted && row("Earliest – latest (P10–P90)", `${zone.shortfall.earliest_date ? fmtDay(zone.shortfall.earliest_date) : "—"} – ${zone.shortfall.latest_date ? fmtDay(zone.shortfall.latest_date) : "beyond horizon"}`)}
      {row(`ET₀ that day / ${sc.rotation_days}-day mean`, `${fmt(basis.et0_mm, 2)} / ${fmt(basis.et0_rotation_mm, 2)} mm`)}
      <div className="mt-1.5 flex items-center gap-1.5 border-t border-line pt-1.5 text-[10.5px] text-fg-3">
        <ProvTag kind={basis.provenance} short />
        ET₀ {basis.source === "provider" ? `from ${data.weather.mode === "live" ? "Meteomatics" : "demo weather"}` : basis.source === "fao56" ? "computed with FAO-56 Penman–Monteith" : "extended beyond the provider's horizon"}
      </div>
    </Panel>
  );
}

export function Assumptions() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const p = data.params;
  const st = data.state;
  const item = (k: string, v: string) => (
    <div className="flex items-baseline justify-between gap-3 py-[2.5px]">
      <span className="text-[11px] text-fg-3">{k}</span>
      <span className="num text-right text-[11px] text-fg-2">{v}</span>
    </div>
  );
  const head = (t: string) => <div className="label mb-0.5 mt-2.5 first:mt-0">{t}</div>;
  return (
    <Panel title="Model, starting state and assumptions" className="min-h-0 flex-1" bodyClassName="overflow-y-auto px-3 py-2.5">
      <p className="mb-2 text-[11px] leading-snug text-fg-2">
        Groundwater source → falaj tunnel → main channel → three branches → six farm zones. The source recedes as a linear reservoir; flow is routed with seepage losses and capacity limits; demand is crop evapotranspiration over each zone. Deterministic: no language model is involved in any number.
      </p>
      {head("Starting state · from sensors")}
      {item("Source head today", `${fmt(st.head_m, 3)} ± ${fmt(st.head_sd, 3)} m`)}
      {item("Observed trend", `${fmt(st.trend_m_per_day * 100, 2)} ± ${fmt(st.trend_se * 100, 2)} cm/day`)}
      {item("Basis", st.basis_label)}
      {item("Flume vs level check", `${fmt(st.main_bias, 3)} (${st.flow_observed ? "observed" : "design"})`)}
      {st.branch_checks.map((c: Bundle["state"]["branch_checks"][number]) => (
        <div key={c.branch}>{item(`Branch ${c.branch} balance`, c.anomaly ? `${fmt(c.excess_loss * 100, 1)}% excess loss` : c.verifiable ? "within design" : `unverified ${c.age_h === null ? "" : `${fmt(c.age_h, 0)} h`}`)}</div>
      ))}
      {head("Source · assumed")}
      {item("Discharge per metre of head", `${p.source.conductance_lps_per_m} L/s per m`)}
      {item("Specific yield × capture area", `${p.source.specific_yield} × ${fmt(p.source.capture_area_m2 / 1e6, 1)} km²`)}
      {item("Recharge threshold / fraction", `${p.source.recharge_threshold_mm} mm · ${p.source.recharge_fraction * 100}% of ${p.source.recharge_area_km2} km²`)}
      {head("Conveyance · assumed")}
      {item("Tunnel", `${p.channels.tunnel_length_km} km · ${fmt(p.channels.tunnel_loss_per_km * 100, 1)}% loss per km`)}
      {item("Main channel", `${p.channels.main_length_km} km · ${fmt(p.channels.main_loss_per_km * 100, 1)}%/km · cap ${p.channels.main_capacity_lps} L/s`)}
      {item("Branches", `${fmt(p.channels.branch_loss_per_km * 100, 1)}%/km · cap ${p.channels.branch_capacity_lps} L/s`)}
      {head("Demand · assumed")}
      {item("Crop coefficient (date palm)", `${p.demand.crop_coefficient}`)}
      {item("Application efficiency", `${p.demand.application_efficiency * 100}%`)}
      {item("Rotation length", `${p.demand.rotation_days} days`)}
      {head("Risk rules")}
      {item("ACT", `≥ ${p.risk.act_probability * 100}% of runs short within ${p.risk.act_window_days} d`)}
      {item("PREPARE", `≥ ${p.risk.prepare_probability * 100}% within ${p.risk.prepare_window_days} d`)}
      {item("WATCH", `≥ ${p.risk.watch_probability * 100}% within 21 d, or thin shrinking margin`)}
      {item("Escalation", `${p.risk.persistence_evaluations} consecutive daily evaluations`)}
      {head("Uncertainty")}
      <p className="text-[10.5px] leading-snug text-fg-3">
        The P10–P90 band comes from {sc.ensemble_members} runs that vary storage (±{p.uncertainty.storage_log_sd * 100}%), conductance (±{p.uncertainty.conductance_rel_sd * 100}%), seepage (±{p.uncertainty.loss_log_sd * 100}%), demand (±{p.uncertainty.demand_rel_sd * 100}%), the starting state, and a weather error that grows with lead time. These spreads are assumptions, not measured error statistics, and the model is not calibrated against real falaj discharge.
      </p>
      {sc.notes.length > 0 && head("Notes for this run")}
      {sc.notes.map((n) => (
        <p key={n} className="text-[10.5px] leading-snug text-fg-2">
          {n}
        </p>
      ))}
    </Panel>
  );
}
