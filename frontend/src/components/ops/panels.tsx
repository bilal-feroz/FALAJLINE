"use client";

import Link from "next/link";
import { GradeChip, Panel, ProvTag, RiskChip, Sparkline, Stat } from "@/components/ui/primitives";
import { RISK_COLOR, STATUS_COLOR, fmt, fmtAge, fmtDay, fmtGst, inDays } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";

/** Headline indicators for the selected timeline day. */
export function KpiStrip() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const level = data.telemetry.sensors.find((s) => s.id === "S-GW-01");
  const flume = data.telemetry.sensors.find((s) => s.id === "S-FL-MAIN");

  const liveHead = day === 0 && level?.status === "ok" && level.last_value !== null;
  const liveFlow = day === 0 && flume?.status === "ok" && flume.last_value !== null;
  const head = liveHead ? level!.last_value! : sc.source.head_m.central[day];
  const flow = liveFlow ? flume!.last_value! : sc.main.flow_lps.central[day];
  const supply = sc.system.supply_lps.central[day];
  const demand = sc.system.demand_lps.central[day];
  const margin = (supply / demand - 1) * 100;
  const first = sc.system.first_shortfall_day;
  const firstZone = sc.zones.find((z) => z.shortfall.first_day === first);
  const risk = sc.system.risk[day];
  const conf = sc.confidence.system[day];
  const short = sc.system.zones_short[day];

  return (
    <div className="grid grid-cols-5 divide-x divide-line rounded-md border border-line bg-panel">
      <Stat
        label="Source head"
        value={fmt(head, 2)}
        unit="m above invert"
        tag={<ProvTag kind={liveHead ? "simulated" : "modelled"} short />}
        sub={day === 0 ? `trend ${fmt(data.state.trend_m_per_day * 100, 1)} cm/day · ${data.state.basis === "level_sensor" ? "7-day fit" : "fallback estimate"}` : `${fmt((sc.source.head_m.central[day] / sc.source.head_m.central[0] - 1) * 100, 0)}% vs today`}
      />
      <Stat
        label="Main channel flow"
        value={fmt(flow, 1)}
        unit="L/s"
        tag={<ProvTag kind={liveFlow ? "simulated" : "modelled"} short />}
        sub={day === 0 ? `at the shari'a · capacity ${fmt(sc.main.capacity_lps, 0)} L/s` : `${fmt((sc.main.flow_lps.central[day] / sc.main.flow_lps.central[0] - 1) * 100, 0)}% vs today · P10–P90 ${fmt(sc.main.flow_lps.p10[day], 0)}–${fmt(sc.main.flow_lps.p90[day], 0)}`}
      />
      <Stat
        label="Supply margin"
        value={`${margin >= 0 ? "+" : ""}${fmt(margin, 0)}%`}
        accent={margin < 0 ? RISK_COLOR.ACT : margin < 8 ? RISK_COLOR.PREPARE : undefined}
        tag={<ProvTag kind="modelled" short />}
        sub={`delivered ${fmt(supply, 1)} · required ${fmt(demand, 1)} L/s`}
      />
      <Stat
        label="First shortfall"
        value={first === null ? "none" : fmtDay(sc.dates[first])}
        accent={first === null ? RISK_COLOR.NORMAL : first - day <= 7 ? RISK_COLOR.ACT : RISK_COLOR.PREPARE}
        tag={<ProvTag kind="modelled" short />}
        sub={
          first === null
            ? "no zone falls short within 21 days"
            : `${firstZone?.id ?? ""} ${firstZone?.name ?? ""} · ${first - day > 0 ? inDays(first - day) : first === day ? "this day" : `began ${day - first} d earlier`}`
        }
      />
      <div className="flex min-w-0 flex-col justify-between gap-1 px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="label">System state</span>
          <GradeChip grade={conf.grade} index={conf.index} />
        </div>
        <div>
          <RiskChip level={risk} size="lg" solid />
        </div>
        <div className="truncate text-[11px] text-fg-3">
          {short.length ? `${short.length} of ${sc.zones.length} zones below demand` : `${sc.system.zones_at_risk[day].length} of ${sc.zones.length} zones at PREPARE or above`}
        </div>
      </div>
    </div>
  );
}

export function ZoneTable() {
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const req = sc.required_supply_ratio;
  const scale = 1.5; // bar spans 0–150% of demand

  return (
    <Panel title="Farm zones · supply / demand, L/s" right={<ProvTag kind="modelled" short />} className="shrink-0">
      <table className="w-full text-[12px]">
        <tbody>
          {sc.zones.map((z) => {
            const r = z.ratio.central[day];
            const lo = z.ratio.p10[day];
            const hi = z.ratio.p90[day];
            const color = RISK_COLOR[z.risk[day]];
            const active = selection?.type === "zone" && selection.id === z.id;
            const first = z.shortfall.first_day;
            return (
              <tr
                key={z.id}
                onClick={() => select(active ? null : { type: "zone", id: z.id })}
                title={`${z.id} ${z.name} · ${fmt(z.area_ha, 1)} ha · ${first === null ? "no shortfall within 21 days" : `first shortfall ${fmtDay(sc.dates[first])}`}`}
                className={`h-[29px] cursor-pointer border-b border-line/70 last:border-0 hover:bg-panel-2 ${active ? "bg-panel-2" : ""}`}
              >
                <td className="w-[104px] pl-3">
                  <span className="num font-medium text-fg">{z.id}</span>
                  <span className="ml-1.5 text-[10.5px] text-fg-3">{z.name.replace(" Grove · ", " ").toLowerCase()}</span>
                </td>
                <td className="px-1.5">
                  <div className="relative h-3.5">
                    <div className="absolute inset-x-0 top-1.5 h-px bg-line-2" />
                    <div className="absolute top-1 h-1.5 rounded-sm opacity-30" style={{ left: `${(Math.min(lo, scale) / scale) * 100}%`, width: `${((Math.min(hi, scale) - Math.min(lo, scale)) / scale) * 100}%`, background: color }} />
                    <div className="absolute top-0.5 h-2.5 w-[3px] rounded-sm" style={{ left: `calc(${(Math.min(r, scale) / scale) * 100}% - 1px)`, background: color }} />
                    <div className="absolute top-0 h-3.5 w-px bg-fg/70" style={{ left: `${(req / scale) * 100}%` }} title="Required supply" />
                  </div>
                </td>
                <td className="num w-[68px] whitespace-nowrap text-right text-[10.5px] text-fg-3">
                  {fmt(z.supply_lps.central[day], 1)}/{fmt(z.demand_lps[day], 1)}
                </td>
                <td className="num w-11 text-right text-[12.5px]" style={{ color }}>
                  {fmt(r * 100, 0)}%
                </td>
                <td className="w-[80px] pr-3 text-right">
                  <RiskChip level={z.risk[day]} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

export function WarningList() {
  const w = useStore((s) => s.data)!.warnings;
  const day = useStore((s) => s.day);
  const sc = useScenario()!;
  return (
    <Panel
      title={`Active warnings · issued ${fmtGst(w.issued_at)} GST`}
      right={
        <Link href="/alerts" className="font-mono text-[10px] tracking-wide text-water hover:underline">
          OPEN ALERTS →
        </Link>
      }
      className="shrink-0"
    >
      {day > 0 && (
        <div className="border-b border-line bg-panel-2 px-3 py-1.5 text-[11px] text-fg-2">
          Timeline at {fmtDay(sc.dates[day])}: <span className="text-fg">{sc.guidance[day].headline}</span>
        </div>
      )}
      <ul>
        {w.warnings.slice(0, 3).map((x) => (
          <li key={x.id} className="border-b border-line/70 px-3 py-2 last:border-0">
            <Link href={`/alerts?w=${x.id}`} className="group block">
              <div className="flex items-center gap-2">
                <RiskChip level={x.level} />
                <span className="num text-[10.5px] text-fg-3">
                  {x.type === "supply_shortfall" ? (x.window.predicted ? inDays(x.window.lead_days) : "no central shortfall") : x.type === "branch_anomaly" ? "detected now" : "under way"}
                </span>
                <span className="ml-auto">
                  <GradeChip grade={x.confidence.grade} />
                </span>
              </div>
              <div className="mt-1 text-[12px] leading-snug text-fg group-hover:text-water">{x.title}</div>
              {x.actions[0] && <div className="mt-0.5 line-clamp-1 text-[11px] text-fg-3">→ {x.actions[0].action}</div>}
            </Link>
          </li>
        ))}
      </ul>
      {w.warnings.length > 3 && (
        <Link href="/alerts" className="block border-t border-line px-3 py-1.5 text-[11px] text-fg-3 hover:text-fg-2">
          + {w.warnings.length - 3} more · {w.counts.ACT} ACT · {w.counts.PREPARE} PREPARE · {w.counts.WATCH} WATCH · {w.notices.length} data notices
        </Link>
      )}
    </Panel>
  );
}

/** Sensor health. Clicking a row injects a fault so the effect of missing data can be seen live. */
export function SensorPanel() {
  const t = useStore((s) => s.data)!.telemetry;
  const faults = useStore((s) => s.faults);
  const cycleFault = useStore((s) => s.cycleFault);
  const resetFaults = useStore((s) => s.resetFaults);
  const sat = t.satellite;
  const satFault = !!t.faults[sat.id];
  return (
    <Panel
      title="Sensor network"
      right={
        <>
          <ProvTag kind="simulated" short />
          <button onClick={() => resetFaults(true)} className="font-mono text-[9.5px] tracking-wide text-fg-3 hover:text-fg-2" title="Clear every injected fault">
            ALL OK
          </button>
          {faults !== null && (
            <button onClick={() => resetFaults(false)} className="font-mono text-[9.5px] tracking-wide text-fg-3 hover:text-fg-2" title="Restore the default demo faults">
              DEFAULT
            </button>
          )}
        </>
      }
      className="min-h-[150px] flex-1"
      bodyClassName="overflow-y-auto"
    >
      <div className="border-b border-line px-3 py-1.5 text-[10.5px] leading-snug text-fg-3">
        No live falaj telemetry is connected. Click a sensor to cycle <span className="text-fg-2">ok → stale → offline</span> and watch confidence respond.
      </div>
      <ul>
        {t.sensors.map((s) => (
          <li key={s.id}>
            <button onClick={() => cycleFault(s.id)} title={`${s.label} · ${s.status_detail}`} className="flex w-full items-center gap-2 border-b border-line/60 px-3 py-[5px] text-left hover:bg-panel-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.status !== "ok" ? "pulse" : ""}`} style={{ background: STATUS_COLOR[s.status], color: STATUS_COLOR[s.status] }} />
              <span className="num w-[74px] shrink-0 text-[11px] text-fg">{s.id}</span>
              <Sparkline values={s.hourly.values} width={70} height={16} color={s.status === "ok" ? "#cdb88c" : STATUS_COLOR[s.status]} />
              <span className="num ml-auto text-[11px] text-fg-2">
                {s.status === "offline" || s.status === "stuck" ? <span className="text-fg-3">—</span> : fmt(s.last_value, s.kind === "level" ? 3 : 1)}
                <span className="ml-1 text-[9.5px] text-fg-3">{s.unit}</span>
              </span>
              <span className="num w-[58px] shrink-0 text-right text-[10px]" style={{ color: s.status === "ok" ? "var(--color-fg-3)" : STATUS_COLOR[s.status] }}>
                {s.status === "ok" ? fmtAge(s.age_min) : `${s.status} ${fmtAge(s.age_min)}`}
              </span>
            </button>
          </li>
        ))}
        <li>
          <button onClick={() => cycleFault(sat.id)} title={sat.note} className="flex w-full items-center gap-2 px-3 py-[5px] text-left hover:bg-panel-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sat.latest_status === "valid" ? STATUS_COLOR.ok : STATUS_COLOR.stale }} />
            <span className="num w-[74px] shrink-0 text-[11px] text-fg">{sat.id}</span>
            <span className="flex gap-0.5">
              {sat.passes.map((p) => (
                <span key={p.time} title={`${fmtGst(p.time, true)} · ${p.status === "valid" ? "valid pass" : "cloud-obscured: unavailable"}`} className={`h-3.5 w-2.5 rounded-[2px] ${p.status === "valid" ? "bg-sand/70" : "hatch border border-line-2"}`} />
              ))}
            </span>
            <span className="ml-auto text-[10.5px] text-fg-3">
              {sat.latest_status === "valid" ? `valid pass ${fmt(sat.latest_valid_age_days, 0)} d ago` : `obscured${satFault ? " (injected)" : ""} · not used`}
            </span>
          </button>
        </li>
      </ul>
    </Panel>
  );
}

export function WeatherPanel() {
  const w = useStore((s) => s.data)!.weather;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const prov = w.mode === "live" ? "observed" : "simulated";
  const basis = sc.weather_basis[day];
  return (
    <Panel
      title="Weather"
      right={
        <>
          <ProvTag kind={prov} short />
          <span className="num text-[10px] text-fg-3">{w.mode === "live" ? "Meteomatics" : "DEMO DATA"}</span>
        </>
      }
    >
      <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
        {w.locations.map((loc) => {
          const d = loc.daily.find((x) => x.date === sc.dates[day]);
          return (
            <div key={loc.id} className="min-w-0 px-3 py-2">
              <div className="truncate text-[11px] text-fg-2" title={`${loc.name} · ${loc.lat.toFixed(3)}°N ${loc.lon.toFixed(3)}°E · ${loc.role}`}>
                {loc.id === "oasis" ? "Al Ain Oasis" : "Al Jaww recharge area"}
              </div>
              <div className="num mt-0.5 text-[10px] text-fg-3">
                {loc.lat.toFixed(3)}°N {loc.lon.toFixed(3)}°E
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="num text-[19px] leading-none text-fg">{fmt(d?.t_max_c, 0)}°</span>
                <span className="num text-[11px] text-fg-3">/ {fmt(d?.t_min_c, 0)}°C</span>
              </div>
              <div className="num mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10.5px] text-fg-2">
                <span>RH {fmt(d?.rh_mean_pct, 0)}%</span>
                <span>wind {fmt(d?.wind_mean_ms, 1)} m/s</span>
                <span>rad {fmt(d?.rad_mean_w, 0)} W</span>
                <span className={d?.precip_mm ? "text-water-2" : ""}>rain {d?.precip_mm === null || d?.precip_mm === undefined ? "n/a" : `${fmt(d.precip_mm, 1)} mm`}</span>
                <span className="col-span-2">
                  ET₀ {fmt(d?.et0_mm, 2)} mm
                  <span className="text-fg-3"> · {d?.et0_source === "provider" ? "provider" : d?.et0_source === "fao56" ? "FAO-56 computed" : "extended"}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="num space-y-0.5 px-3 py-2 text-[10.5px] leading-relaxed text-fg-3">
        <div>
          Demand uses {sc.rotation_days}-day mean ET₀ <span className="text-fg-2">{fmt(basis.et0_rotation_mm, 2)} mm/day</span> for {fmtDay(sc.dates[day])}
        </div>
        <div>
          Retrieved <span className="text-fg-2">{fmtGst(w.retrieved_at, true)}</span> GST
          {w.forecast_issued_at && (
            <>
              {" "}· forecast issued <span className="text-fg-2">{fmtGst(w.forecast_issued_at, true)}</span>
            </>
          )}
        </div>
        <div>
          {w.cache.hit ? `Served from cache (${Math.round(w.cache.age_s / 60)} min old)` : "Fresh from the API"} · {w.queries_today} queries today
          {w.parameters.some((p) => p.status === "unsupported" || p.status === "unavailable") && (
            <span className="text-watch"> · {w.parameters.filter((p) => p.status === "unsupported" || p.status === "unavailable").map((p) => p.id).join(", ")} unavailable</span>
          )}
        </div>
      </div>
    </Panel>
  );
}
