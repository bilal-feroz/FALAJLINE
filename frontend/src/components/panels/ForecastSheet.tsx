"use client";

import { useEffect, useState } from "react";
import { RISK_COLOR, fmt, fmtDay, fmtLong, inDays } from "@/lib/format";
import { supplySeries } from "@/lib/series";
import { useScenario, useStore } from "@/lib/store";
import { Legend, TrendChart } from "../Chart";
import { Eyebrow, Prov } from "../ui";

function Slider({ label, hint, value, max, onCommit }: { label: string; hint: string; value: number; max: number; onCommit: (v: number) => void }) {
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setLocal(value);
  }
  useEffect(() => {
    if (local === value) return;
    const id = setTimeout(() => onCommit(local), 280);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <label className="block">
      <div className="flex items-baseline justify-between">
        <span className="text-[13.5px] text-ink-2">{label}</span>
        <span className="num text-[14.5px] text-ink">{Math.round(local * 100)}%</span>
      </div>
      <input type="range" className="slider mt-2 w-full" min={0} max={max} step={0.05} value={local} onChange={(e) => setLocal(parseFloat(e.target.value))} />
      <div className="mt-1 text-[12px] text-ink-3">{hint}</div>
    </label>
  );
}

export function ForecastSheet() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const setDay = useStore((s) => s.setDay);
  const scenarioId = useStore((s) => s.scenarioId);
  const setScenario = useStore((s) => s.setScenario);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const refreshing = useStore((s) => s.refreshing);
  const target = useStore((s) => s.forecastTarget);
  const setTarget = useStore((s) => s.setForecastTarget);
  const selection = useStore((s) => s.selection);

  // follow a zone selected in the twin
  useEffect(() => {
    if (selection?.type === "zone") setTarget(selection.id);
  }, [selection, setTarget]);

  const zone = sc.zones.find((z) => z.id === target);
  const first = zone ? zone.shortfall.first_day : sc.system.first_shortfall_day;
  const firstZone = zone ?? sc.zones.find((z) => z.shortfall.first_day === first);
  const tabs = [{ id: "system", label: "Oasis", risk: sc.system.risk[day] }, ...sc.zones.map((z) => ({ id: z.id, label: z.id, risk: z.risk[day] }))];

  return (
    <section className="glass glass-solid pointer-events-auto absolute inset-x-4 bottom-[104px] z-20 flex overflow-hidden rise" style={{ height: "42vh" }}>
      <div className="flex min-w-0 flex-1 flex-col px-6 pb-4 pt-5">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <Eyebrow>Water availability · {zone ? `${zone.id} ${zone.name}` : "whole oasis"} · L/s</Eyebrow>
            <h2 className="display mt-2 text-[30px] leading-tight text-ink">
              {first === null ? (
                <>Supply holds for 21 days.</>
              ) : (
                <>
                  {zone ? "This zone" : firstZone?.name.split(" · ")[0] + " " + (firstZone?.name.split(" · ")[1] ?? "")} falls short on <span className="italic text-act">{fmtLong(sc.dates[first])}</span>
                  <span className="text-ink-3">, {inDays(first)}.</span>
                </>
              )}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-ink/[0.06] p-1">
            {tabs.map((t) => (
              <button key={t.id} onClick={() => setTarget(t.id)} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] transition-colors ${target === t.id ? "bg-ink text-cream" : "text-ink-2 hover:text-ink"}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_COLOR[t.risk] }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 min-h-0 flex-1">
          <TrendChart points={supplySeries(data, sc, target)} selectedLabel={fmtDay(sc.dates[day])} todayLabel={fmtDay(sc.dates[0])} unit="L/s" onSelect={setDay} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-4">
          <Legend />
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-3">
            <Prov kind="modelled" /> {sc.ensemble_members} runs · deterministic model, no language model
          </span>
        </div>
      </div>

      <div className="flex w-[430px] shrink-0 flex-col border-l hairline px-5 pb-4 pt-5">
        <div className="flex items-center justify-between">
          <Eyebrow>Scenarios · same model, re-run</Eyebrow>
          {refreshing && <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-beige">recalculating</span>}
        </div>
        <ul className="mt-3 space-y-1.5">
          {data.comparison.map((c) => {
            const on = c.id === scenarioId;
            return (
              <li key={c.id}>
                <button onClick={() => setScenario(c.id)} className={`w-full rounded-2xl px-3.5 py-2.5 text-left transition-colors ${on ? "bg-ink/[0.1] ring-1 ring-ink/25" : "hover:bg-ink/[0.05]"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full border ${on ? "border-ink bg-ink" : "border-ink-3"}`} />
                    <span className="text-[14px] text-ink">{c.label}</span>
                    {c.days_gained !== null && c.days_gained > 0 && (
                      <span className="num ml-auto rounded-full bg-ok/15 px-2 py-[1px] text-[11.5px] text-ok">{c.beyond_horizon ? "no shortfall" : `+${c.days_gained} days`}</span>
                    )}
                  </div>
                  <div className="num mt-1.5 flex gap-4 pl-[18px] text-[12px] text-ink-3">
                    <span>
                      first short <span className="text-ink">{c.first_shortfall_day === null ? "none" : fmtDay(c.first_shortfall_date)}</span>
                    </span>
                    <span>
                      zones <span className="text-ink">{c.zones_ever_short}/6</span>
                    </span>
                    <span>
                      deficit <span className="text-ink">{fmt(c.deficit_m3_total, 0)} m³</span>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-auto space-y-4 pt-4">
          <Slider label="Demand reduction" hint="Tighter rotation, deficit irrigation of understorey crops" value={settings.demand_reduction} max={0.4} onCommit={(v) => setSettings({ demand_reduction: v })} />
          <Slider label="Channel seepage cut" hint="Lining and repairs; also fixes the detected leak" value={settings.loss_reduction} max={0.8} onCommit={(v) => setSettings({ loss_reduction: v })} />
        </div>
      </div>
    </section>
  );
}
