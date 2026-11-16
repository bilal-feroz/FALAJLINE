"use client";

import type { ReactNode } from "react";
import { RISK_COLOR, STATUS_COLOR, fmt, fmtAge, fmtDay, fmtGst, inDays } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import type { ScenarioForecast, Sensor } from "@/lib/types";
import { FalajSection } from "../SectionChart";
import { Conf, Eyebrow, Prov, Risk, Spark } from "../ui";

function Row({ k, v, prov }: { k: string; v: ReactNode; prov?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[5px]">
      <span className="flex items-center gap-1.5 text-[13.5px] text-ink-3">
        {k}
        {prov && <Prov kind={prov} />}
      </span>
      <span className="num text-right text-[13.5px] text-ink">{v}</span>
    </div>
  );
}

/** Supply as a share of demand over 21 days, with the 100% line and the selected day. */
function RatioChart({ values, day, required }: { values: number[]; day: number; required: number }) {
  const W = 330;
  const H = 84;
  const max = Math.max(1.4, ...values) * 1.02;
  const min = Math.min(0.75, ...values) * 0.98;
  const x = (i: number) => 4 + (i / (values.length - 1)) * (W - 8);
  const y = (v: number) => H - 6 - ((v - min) / (max - min)) * (H - 12);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const firstShort = values.findIndex((v) => v < required);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      {firstShort >= 0 && <rect x={x(firstShort) - 4} y={0} width={W - x(firstShort) + 4} height={H} fill="#c2432b" opacity={0.12} rx={4} />}
      <line x1={0} x2={W} y1={y(required)} y2={y(required)} stroke="#a3865a" strokeDasharray="4 4" strokeWidth={1} />
      <text x={W} y={y(required) - 4} textAnchor="end" className="fill-[#8a6f47] font-mono text-[9.5px] uppercase tracking-[0.12em]">
        demand
      </text>
      <path d={d} fill="none" stroke="#1c1712" strokeWidth={1.8} strokeLinejoin="round" />
      <line x1={x(day)} x2={x(day)} y1={0} y2={H} stroke="#1c1712" strokeOpacity={0.35} />
      <circle cx={x(day)} cy={y(values[day])} r={3.2} fill={values[day] < required ? "#c2432b" : "#1c1712"} />
    </svg>
  );
}

function SensorBlock({ s }: { s: Sensor | undefined }) {
  const cycleFault = useStore((st) => st.cycleFault);
  if (!s) return null;
  const missing = s.status === "offline" || s.status === "stuck";
  return (
    <div className="mt-1 rounded-xl bg-ink/[0.04] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s.status] }} />
        <span className="num text-[13px] text-ink">{s.id}</span>
        <Prov kind="simulated" />
        <button onClick={() => cycleFault(s.id)} className="ml-auto font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink" title="Cycle this sensor ok, stale, offline">
          {s.status} · cycle
        </button>
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <div>
          <div className="num text-[17px] text-ink">{missing ? <span className="text-ink-3">no current reading</span> : `${fmt(s.last_value, s.kind === "level" ? 3 : 1)} ${s.unit}`}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {s.label} · {fmtAge(s.age_min)} ago · {s.valid_24h}/{s.expected_24h} in 24 h
          </div>
        </div>
        <Spark values={s.hourly.values.slice(-48)} width={96} height={26} color={s.status === "ok" ? "#a3865a" : STATUS_COLOR[s.status]} />
      </div>
    </div>
  );
}

function ZoneBody({ id, sc }: { id: string; sc: ScenarioForecast }) {
  const data = useStore((s) => s.data)!;
  const day = useStore((s) => s.day);
  const setMode = useStore((s) => s.setMode);
  const z = sc.zones.find((q) => q.id === id)!;
  const r = z.ratio.central[day];
  const sat = data.telemetry.satellite;
  const series = sat.passes.map((p) => p.zones[id] ?? null);
  const last = [...sat.passes].reverse().find((p) => p.zones[id] !== null && p.zones[id] !== undefined);
  const change = sat.change_30d?.[id];
  const warning = data.warnings.warnings.find((w) => w.type === "supply_shortfall" && w.affected_zones[0] === id);
  const first = z.shortfall.first_day;
  return (
    <>
      <div className="flex items-end gap-3">
        <span className="display text-[52px]" style={{ color: RISK_COLOR[z.risk[day]] }}>
          {fmt(r * 100, 0)}%
        </span>
        <span className="mb-2 text-[13.5px] leading-tight text-ink-3">
          of demand
          <br />
          on {fmtDay(sc.dates[day])}
        </span>
      </div>
      <div className="mt-3">
        <RatioChart values={z.ratio.central} day={day} required={sc.required_supply_ratio} />
      </div>
      <div className="mt-3 divide-y divide-ink/[0.06]">
        <Row k="Delivered / demand" v={`${fmt(z.supply_lps.central[day], 1)} / ${fmt(z.demand_lps[day], 1)} L/s`} prov="modelled" />
        <Row k="First shortfall" v={first === null ? "none in 21 days" : `${fmtDay(sc.dates[first])} · ${first >= day ? inDays(first - day) : "under way"}`} />
        {z.shortfall.predicted && <Row k="Earliest – latest" v={`${z.shortfall.earliest_date ? fmtDay(z.shortfall.earliest_date) : "—"} – ${z.shortfall.latest_date ? fmtDay(z.shortfall.latest_date) : "beyond"}`} />}
        <Row k="Deficit, 21 days" v={`${fmt(z.deficit_m3_total, 0)} m³`} />
        <Row
          k="Canopy NDVI"
          prov={last ? "observed" : "unavailable"}
          v={
            last ? (
              <span className="flex items-center gap-2">
                <Spark values={series} width={56} height={14} color="#a3865a" />
                {fmt(last.zones[id], 2)}
                {change !== null && change !== undefined && <span className="text-ink-3">{change >= 0 ? "+" : ""}{fmt(change, 2)}</span>}
              </span>
            ) : (
              "unavailable"
            )
          }
        />
      </div>
      <SensorBlock s={data.telemetry.sensors.find((s) => s.id === `S-OUT-${id}`)} />
      {warning && warning.actions[0] && (
        <div className="mt-4">
          <Eyebrow>Recommended</Eyebrow>
          <p className="mt-1.5 text-[14px] leading-snug text-ink">{warning.actions[0].action}</p>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-3">{warning.actions[0].rationale}</p>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button onClick={() => setMode("forecast")} className="h-8 flex-1 rounded-full bg-ink/10 text-[13px] text-ink hover:bg-ink/15">
          Forecast
        </button>
        {warning && (
          <button onClick={() => { useStore.setState({ alertId: warning.id }); setMode("alerts"); }} className="h-8 flex-1 rounded-full bg-ink text-[13px] text-cream hover:bg-ink-2">
            Open warning
          </button>
        )}
      </div>
    </>
  );
}

function SourceBody({ sc }: { sc: ScenarioForecast }) {
  const data = useStore((s) => s.data)!;
  const day = useStore((s) => s.day);
  const head = sc.source.head_m;
  const recharge = data.rain_history.available ? data.rain_history.locations?.find((l) => l.id === "recharge") : undefined;
  return (
    <>
      <div className="flex items-end gap-3">
        <span className="display text-[52px]">{fmt(head.central[day], 2)}</span>
        <span className="mb-2 text-[13.5px] leading-tight text-ink-3">
          m of head above
          <br />
          the tunnel, {fmtDay(sc.dates[day])}
        </span>
      </div>
      <div className="mt-2">
        <Spark values={head.central} width={354} height={36} fill mark={day} color="#3a3329" />
      </div>
      <div className="mt-4">
        <Eyebrow className="mb-2">Along the falaj · long section</Eyebrow>
        <FalajSection day={day} />
      </div>
      <div className="mt-3 divide-y divide-ink/[0.06]">
        <Row k="Discharge into the falaj" v={`${fmt(sc.source.discharge_lps.central[day], 1)} L/s`} prov="modelled" />
        <Row k="P10 – P90 head" v={`${fmt(head.p10[day], 2)} – ${fmt(head.p90[day], 2)} m`} />
        <Row k="Observed trend" v={`${fmt(data.state.trend_m_per_day * 100, 1)} ± ${fmt(data.state.trend_se * 100, 1)} cm/day`} prov="simulated" />
        <Row k="Change by day 21" v={`${fmt(((sc.source.discharge_lps.central[21] / sc.source.discharge_lps.central[0]) - 1) * 100, 0)}% flow`} />
        {recharge?.last_recharge_event && <Row k="Last recharge rain" v={`${fmtDay(recharge.last_recharge_event.date)} · ${fmt(recharge.last_recharge_event.mm, 0)} mm`} prov="observed" />}
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-ink-3">Basis: {data.state.basis_label}.</p>
      <SensorBlock s={data.telemetry.sensors.find((s) => s.id === "S-GW-01")} />
    </>
  );
}

function ChannelBody({ id, sc }: { id: string; sc: ScenarioForecast }) {
  const data = useStore((s) => s.data)!;
  const day = useStore((s) => s.day);
  if (id === "main") {
    return (
      <>
        <div className="flex items-end gap-3">
          <span className="display text-[52px]">{fmt(sc.main.flow_lps.central[day], 1)}</span>
          <span className="mb-2 text-[13.5px] text-ink-3">L/s at the shari&apos;a</span>
        </div>
        <div className="mt-3 divide-y divide-ink/[0.06]">
          <Row k="Reaching the divider" v={`${fmt(sc.main.divider_lps[day], 1)} L/s`} prov="modelled" />
          <Row k="P10 – P90" v={`${fmt(sc.main.flow_lps.p10[day], 1)} – ${fmt(sc.main.flow_lps.p90[day], 1)} L/s`} />
          <Row k="Capacity used" v={`${fmt((sc.main.flow_lps.central[day] / sc.main.capacity_lps) * 100, 0)}%`} />
          <Row k="Seepage in the tunnel" v={`${fmt(sc.balance.tunnel_loss_lps[day], 1)} L/s`} />
        </div>
        <SensorBlock s={data.telemetry.sensors.find((s) => s.id === "S-FL-MAIN")} />
      </>
    );
  }
  const b = sc.branches.find((q) => q.id === id)!;
  const check = data.state.branch_checks.find((c) => c.branch === id);
  return (
    <>
      <div className="flex items-end gap-3">
        <span className="display text-[52px]">{fmt(b.flow_lps[day], 1)}</span>
        <span className="mb-2 text-[13.5px] text-ink-3">L/s entering the branch</span>
      </div>
      <div className="mt-3 divide-y divide-ink/[0.06]">
        <Row k="Delivered to outlets" v={`${fmt(b.delivered_lps[day], 1)} L/s`} prov="modelled" />
        <Row k="Lost along the branch" v={`${fmt(b.loss_lps[day], 1)} L/s`} />
        <Row k="Share at the divider" v={`${fmt(b.share * 100, 1)}%`} />
      </div>
      {check && <p className={`mt-3 rounded-xl px-3 py-2 text-[13px] leading-snug ${check.anomaly ? "bg-prepare/10 text-prepare" : "bg-ink/[0.04] text-ink-3"}`}>{check.note}</p>}
      <SensorBlock s={data.telemetry.sensors.find((s) => s.id === `S-FL-${id}`)} />
    </>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  if (!selection) return null;

  let eyebrow = "";
  let title = "";
  let meta = "";
  let chips: ReactNode = null;
  let body: ReactNode = null;
  if (selection.type === "zone") {
    const z = sc.zones.find((q) => q.id === selection.id)!;
    const conf = sc.confidence.zones[z.id][day];
    eyebrow = `Farm zone ${z.id}`;
    title = z.name;
    meta = `${fmt(z.area_ha, 1)} ha · ${z.position}-end on branch ${z.branch}`;
    chips = (
      <>
        <Risk level={z.risk[day]} />
        <Conf grade={conf.grade} index={conf.index} />
      </>
    );
    body = <ZoneBody id={z.id} sc={sc} />;
  } else if (selection.type === "source" || selection.type === "tunnel") {
    eyebrow = selection.type === "source" ? "Source" : "Falaj tunnel";
    title = selection.type === "source" ? "Mother well" : "Tunnel, 7 km";
    meta = "Umm al-falaj · conceptual position on the Al Jaww plain";
    chips = <Risk level={sc.system.risk[day]} />;
    body = <SourceBody sc={sc} />;
  } else if (selection.type === "main" || selection.type === "branch") {
    const b = sc.branches.find((q) => q.id === selection.id);
    eyebrow = selection.type === "main" ? "Main channel" : "Branch";
    title = selection.type === "main" ? "Shari'a to divider" : (b?.name ?? selection.id);
    meta = "Surface channel · conceptual alignment";
    chips = b ? <Risk level={b.risk[day]} /> : null;
    body = <ChannelBody id={selection.id} sc={sc} />;
  } else if (selection.type === "sensor") {
    const s = data.telemetry.sensors.find((q) => q.id === selection.id);
    eyebrow = "Sensor";
    title = s?.id ?? selection.id;
    meta = s ? `${s.label} · every ${s.interval_min} min` : "";
    chips = s ? (
      <span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: STATUS_COLOR[s.status] }}>
        {s.status}
      </span>
    ) : null;
    body = (
      <>
        <p className="text-[13.5px] leading-snug text-ink-2">{s?.status_detail}</p>
        <SensorBlock s={s} />
        {s && s.rejected.length > 0 && <p className="mt-2 text-[12.5px] text-ink-3">{s.rejected.length} reading rejected as an outlier at {fmtGst(s.rejected[0].time, true)}.</p>}
      </>
    );
  }

  return (
    <aside data-tour="inspector" className="glass pointer-events-auto absolute bottom-[104px] right-4 top-[76px] z-20 flex w-[396px] flex-col overflow-hidden rise">
      <div className="flex items-start gap-3 px-5 pb-3 pt-5">
        <div className="min-w-0 flex-1">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="display mt-2 text-[30px] text-ink">{title}</h2>
          <p className="mt-1 text-[13px] text-ink-3">{meta}</p>
        </div>
        <button onClick={() => select(null, false)} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-full text-ink-3 hover:bg-ink/10 hover:text-ink">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="flex items-center gap-2 px-5 pb-3">{chips}</div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t hairline px-5 pb-5 pt-4">{body}</div>
    </aside>
  );
}
