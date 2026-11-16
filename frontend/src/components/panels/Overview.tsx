"use client";

import { useEffect, useRef, useState } from "react";
import { RISK_COLOR, RISK_WORD, STATUS_COLOR, compass, fmt, fmtAge, fmtDay, fmtLong, inDays } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import { Conf, Eyebrow, Prov, Risk, Spark } from "../ui";

function WindArrow({ deg }: { deg: number | null }) {
  if (deg === null) return null;
  // arrow points where the wind is going
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" style={{ transform: `rotate(${deg + 180}deg)` }} aria-hidden>
      <path d="M7 1.5v11M7 1.5 4 5M7 1.5 10 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Kpi({ label, value, unit, sub, prov, accent }: { label: string; value: string; unit?: string; sub: string; prov: string; accent?: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <Eyebrow className="truncate">{label}</Eyebrow>
        <Prov kind={prov} />
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="display text-[30px]" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
        {unit && <span className="num text-[12px] text-ink-3">{unit}</span>}
      </div>
      <div className="mt-0.5 truncate text-[12.5px] text-ink-3">{sub}</div>
    </div>
  );
}

export function Overview() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const select = useStore((s) => s.select);
  const selection = useStore((s) => s.selection);
  const cycleFault = useStore((s) => s.cycleFault);
  const setFaults = useStore((s) => s.setFaults);
  const faults = useStore((s) => s.faults);
  const highlight = useStore((s) => s.tour.highlight);
  const [sensorsOpen, setSensorsOpen] = useState(false);
  const weatherRef = useRef<HTMLElement>(null);
  const healthRef = useRef<HTMLElement>(null);
  // the presentation points at a section: bring it into view
  useEffect(() => {
    const el = highlight === "weather" ? weatherRef.current : highlight === "health" ? healthRef.current : null;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlight]);

  const level = sc.system.risk[day];
  const conf = sc.confidence.system[day];
  const first = sc.system.first_shortfall_day;
  const firstZone = sc.zones.find((z) => z.shortfall.first_day === first);
  const shortNow = sc.system.zones_short[day];
  const supply = sc.system.supply_lps.central[day];
  const demand = sc.system.demand_lps.central[day];
  const margin = (supply / demand - 1) * 100;
  const flow = sc.main.flow_lps.central;
  const head = sc.source.head_m.central;

  const oasis = data.weather.locations.find((l) => l.id === "oasis")!;
  const wd = oasis.daily.find((d) => d.date === sc.dates[day]);
  const et0 = sc.weather_basis.map((b) => b.et0_mm);
  const live = data.weather.mode === "live";
  const recharge = data.rain_history.available ? data.rain_history.locations?.find((l) => l.id === "recharge") : undefined;
  const t = data.telemetry;
  const down = t.sensors.filter((s) => s.status !== "ok");
  const lastPass = t.satellite.passes.filter((p) => p.status === "valid").at(-1);

  let sentence: string;
  if (shortNow.length) sentence = `${shortNow.length} of ${sc.zones.length} zones are below demand on ${fmtLong(sc.dates[day])}.`;
  else if (first !== null && firstZone) sentence = `${firstZone.name.replace(" · ", ", ")} falls below demand on ${fmtLong(sc.dates[first])}, ${first - day === 0 ? "today" : inDays(first - day)}.`;
  else sentence = `Supply covers demand in every zone through ${fmtLong(sc.dates[sc.dates.length - 1])}.`;

  return (
    <aside className="glass pointer-events-auto absolute bottom-[104px] left-4 top-[76px] z-20 flex w-[396px] flex-col overflow-hidden rise">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="px-5 pb-4 pt-5">
          <div className="flex items-center justify-between">
            <Eyebrow>System state · {fmtDay(sc.dates[day])}</Eyebrow>
            <Conf grade={conf.grade} index={conf.index} />
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="display text-[58px] italic" style={{ color: RISK_COLOR[level] }}>
              {RISK_WORD[level]}
            </span>
          </div>
          <p className="mt-2 text-[15px] leading-snug text-ink-2">{sentence}</p>
        </section>

        <section className="grid grid-cols-3 gap-3 border-t hairline px-5 py-4">
          <Kpi label="Flow" value={fmt(flow[day], 1)} unit="L/s" sub={day === 0 ? `${fmt(((flow[21] - flow[0]) / flow[0]) * 100, 0)}% by ${fmtDay(sc.dates[21])}` : `${fmt(((flow[day] - flow[0]) / flow[0]) * 100, 0)}% vs today`} prov="modelled" />
          <Kpi label="Margin" value={`${margin >= 0 ? "+" : ""}${fmt(margin, 0)}`} unit="%" sub={`${fmt(supply, 0)} of ${fmt(demand, 0)} L/s`} prov="modelled" accent={margin < 0 ? RISK_COLOR.ACT : margin < 6 ? RISK_COLOR.PREPARE : undefined} />
          <Kpi label="Source" value={fmt(head[day], 2)} unit="m" sub={`${fmt(data.state.trend_m_per_day * 100, 1)} cm/day`} prov={day === 0 ? "simulated" : "modelled"} />
        </section>

        <section className="border-t hairline px-5 py-4">
          <div className="mb-2.5 flex items-center justify-between">
            <Eyebrow>Farm zones · supply / demand</Eyebrow>
            <Prov kind="modelled" />
          </div>
          <ul className="-mx-2">
            {sc.zones.map((z) => {
              const r = z.ratio.central[day];
              const color = RISK_COLOR[z.risk[day]];
              const active = selection?.type === "zone" && selection.id === z.id;
              const pct = Math.min(1, r / 1.5);
              return (
                <li key={z.id}>
                  <button
                    onClick={() => select(active ? null : { type: "zone", id: z.id })}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-[7px] text-left transition-colors ${active ? "bg-ink/10" : "hover:bg-ink/5"}`}
                  >
                    <span className="num w-6 text-[13px] text-ink">{z.id}</span>
                    <span className="w-[92px] truncate text-[13.5px] text-ink-2">{z.name.replace(" Grove · ", " · ")}</span>
                    <span className="relative h-1.5 flex-1 rounded-full bg-ink/10">
                      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct * 100}%`, background: color, opacity: 0.85 }} />
                      <span className="absolute -top-1 h-3.5 w-px bg-ink/70" style={{ left: `${(1 / 1.5) * 100}%` }} />
                    </span>
                    <span className="num w-10 text-right text-[13px]" style={{ color }}>
                      {fmt(r * 100, 0)}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section ref={weatherRef} className={`border-t hairline px-5 py-4 transition-colors ${highlight === "weather" ? "bg-ink/[0.06]" : ""}`}>
          <div className="mb-3 flex items-center justify-between">
            <Eyebrow>Weather · {live ? "Meteomatics" : "demo data"}</Eyebrow>
            <Prov kind={live ? "live" : "simulated"} />
          </div>
          <div className="flex items-start gap-4">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="display text-[40px]">{fmt(wd?.t_max_c, 0)}°</span>
                <span className="num text-[12.5px] text-ink-3">/ {fmt(wd?.t_min_c, 0)}°</span>
              </div>
              <div className="mt-0.5 text-[12.5px] text-ink-3">Al Ain · {fmtDay(sc.dates[day])}</div>
            </div>
            <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-ink-3">Wind</dt>
              <dd className="num flex items-center justify-end gap-1 text-ink">
                <WindArrow deg={wd?.wind_dir_deg ?? null} />
                {fmt(wd?.wind_mean_ms, 1)} m/s {compass(wd?.wind_dir_deg)}
              </dd>
              <dt className="text-ink-3">ET₀</dt>
              <dd className="num text-right text-ink">{fmt(wd?.et0_mm, 2)} mm</dd>
              <dt className="text-ink-3">Rain</dt>
              <dd className="num text-right text-ink">
                {wd?.precip_mm === null || wd?.precip_mm === undefined ? "n/a" : `${fmt(wd.precip_mm, 1)} mm`}
                {wd?.prob_precip_pct !== null && wd?.prob_precip_pct !== undefined && <span className="text-ink-3"> · {fmt(wd.prob_precip_pct, 0)}%</span>}
              </dd>
              <dt className="text-ink-3">Humidity</dt>
              <dd className="num text-right text-ink">{fmt(wd?.rh_mean_pct, 0)}%</dd>
            </dl>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">ET₀ 21 d</span>
            <Spark values={et0} width={180} height={22} fill mark={day} />
          </div>
          {recharge?.last_recharge_event && (
            <p className="mt-3 text-[13px] leading-snug text-ink-3">
              Last recharge-capable rain upstream: <span className="text-ink">{fmtLong(recharge.last_recharge_event.date)}, {fmt(recharge.last_recharge_event.mm, 0)} mm</span>, {recharge.last_recharge_event.days_ago} days ago.
            </p>
          )}
        </section>

        <section ref={healthRef} className={`border-t hairline px-5 py-4 transition-colors ${highlight === "health" ? "bg-ink/[0.06]" : ""}`}>
          <div className="mb-2.5 flex items-center justify-between">
            <Eyebrow>Data health</Eyebrow>
            <button onClick={() => setSensorsOpen(!sensorsOpen)} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink">
              {sensorsOpen ? "Hide" : "Sensors"}
            </button>
          </div>
          <div className="flex items-baseline justify-between text-[13.5px]">
            <span className="text-ink-2">
              {t.health.ok} of {t.sensors.length} sensors reporting
            </span>
            <Prov kind="simulated" />
          </div>
          {down.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {down.map((s) => (
                <span key={s.id} className="num rounded-full px-2 py-[1px] text-[11.5px]" style={{ color: STATUS_COLOR[s.status], boxShadow: `inset 0 0 0 1px ${STATUS_COLOR[s.status]}55` }}>
                  {s.id} {s.status}
                </span>
              ))}
            </div>
          )}
          {lastPass && (
            <div className="mt-2.5 flex items-baseline justify-between text-[13.5px]">
              <span className="text-ink-2">
                Canopy NDVI <span className="num text-ink">{fmt(lastPass.oasis, 2)}</span> · Sentinel-2 {fmtDay(lastPass.time)}
              </span>
              <Prov kind="observed" />
            </div>
          )}
          {sensorsOpen && (
            <div className="mt-3 rise">
              <p className="mb-2 text-[12.5px] leading-snug text-ink-3">Click a sensor to cycle it ok, stale, offline and watch confidence respond. The warning holds.</p>
              <ul className="-mx-2">
                {t.sensors.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => cycleFault(s.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left hover:bg-ink/5" title={s.status_detail}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[s.status] }} />
                      <span className="num w-[78px] text-[12.5px] text-ink">{s.id}</span>
                      <Spark values={s.hourly.values.slice(-48)} width={72} height={14} color={s.status === "ok" ? "#a3865a" : STATUS_COLOR[s.status]} />
                      <span className="num ml-auto text-[12px] text-ink-3">{s.status === "ok" ? fmtAge(s.age_min) : s.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-3">
                <button onClick={() => setFaults({})} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink">
                  All healthy
                </button>
                {faults !== null && (
                  <button onClick={() => setFaults(null)} className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3 hover:text-ink">
                    Demo faults
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="border-t hairline px-5 py-2.5">
        <Risk level={level} />
        <span className="ml-2 text-[12.5px] text-ink-3">{sc.scenario.label}</span>
      </div>
    </aside>
  );
}
