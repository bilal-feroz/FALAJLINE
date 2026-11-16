"use client";

import { useState } from "react";
import { ChartLegend, TrendChart } from "@/components/charts/TrendChart";
import { Assumptions, BalanceBar, DayDetail, SCENARIO_COLOR, ScenarioPanel, ScenarioRatioChart } from "@/components/forecast/panels";
import { Panel, ProvTag } from "@/components/ui/primitives";
import { RISK_COLOR, fmtDay, inDays } from "@/lib/format";
import { sourceSeries, supplySeries } from "@/lib/series";
import { useScenario, useStore } from "@/lib/store";

export default function ForecastPage() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const setDay = useStore((s) => s.setDay);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const [local, setLocal] = useState<string>("system");
  const [tab, setTab] = useState<"day" | "model">("day");
  const target = selection?.type === "zone" ? selection.id : local;
  const pick = (id: string) => {
    setLocal(id);
    select(id === "system" ? null : { type: "zone", id });
  };

  const zone = sc.zones.find((z) => z.id === target);
  const first = zone ? zone.shortfall.first_day : sc.system.first_shortfall_day;
  const sel = fmtDay(sc.dates[day]);
  const today = fmtDay(sc.dates[0]);

  return (
    <div className="grid h-full grid-rows-[minmax(0,1fr)] grid-cols-[minmax(0,1fr)_404px] gap-2.5 p-2.5">
      <div className="flex min-h-0 min-w-0 flex-col gap-2.5">
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex rounded-[5px] border border-line-2 p-0.5">
            {[{ id: "system", name: "Whole oasis", risk: sc.system.risk[day] }, ...sc.zones.map((z) => ({ id: z.id, name: z.id, risk: z.risk[day] }))].map((t) => (
              <button key={t.id} onClick={() => pick(t.id)} className={`flex items-center gap-1.5 rounded-[3px] px-2.5 py-1 text-[11.5px] ${target === t.id ? "bg-panel-3 text-fg" : "text-fg-3 hover:text-fg-2"}`}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_COLOR[t.risk] }} />
                {t.name}
              </button>
            ))}
          </div>
          <div className="min-w-0 truncate text-[12.5px] text-fg-2">
            {first === null ? (
              <>
                <span className="text-normal">No shortfall</span> in the central forecast for {zone ? zone.name : "the oasis"} within 21 days.
              </>
            ) : (
              <>
                {zone ? zone.name : "First farm zone"} falls below demand on <span className="num text-fg">{fmtDay(sc.dates[first])}</span>, <span className="text-fg">{inDays(first)}</span>.
              </>
            )}
          </div>
          <span className="ml-auto shrink-0 text-[11px] text-fg-3">{sc.scenario.label}</span>
        </div>

        <Panel
          title={`${zone ? `${zone.id} ${zone.name}` : "Whole oasis"} · water availability, L/s`}
          right={
            <>
              <ProvTag kind="simulated" short />
              <ProvTag kind="modelled" short />
            </>
          }
          className="min-h-[220px] flex-1"
          bodyClassName="flex flex-col px-1 pb-2 pt-1"
        >
          <div className="min-h-0 flex-1">
            <TrendChart points={supplySeries(data, sc, target)} selectedLabel={sel} todayLabel={today} unit="L/s" requiredLabel="Required (demand)" onSelect={setDay} />
          </div>
          <div className="px-3 pt-1.5">
            <ChartLegend />
          </div>
        </Panel>

        <div className="grid h-[190px] shrink-0 grid-cols-3 gap-2.5">
          <Panel
            title="Supply as % of demand · three scenarios"
            bodyClassName="flex flex-col px-1 pb-1.5 pt-1"
          >
            <div className="min-h-0 flex-1">
              <ScenarioRatioChart target={target} />
            </div>
            <div className="flex flex-wrap gap-x-3 px-2 pt-1 text-[10px] text-fg-3">
              {data.scenario_order.map((id) => (
                <span key={id} className="flex items-center gap-1 whitespace-nowrap">
                  <span className="h-0.5 w-3" style={{ background: SCENARIO_COLOR[id] }} />
                  {data.scenarios[id].scenario.label.replace(" operating conditions", "").replace("Improved channel ", "").replace("Reduced water ", "Less ")}
                </span>
              ))}
            </div>
          </Panel>
          <Panel title="Source head above tunnel invert, m" bodyClassName="px-1 pb-1 pt-1">
            <TrendChart points={sourceSeries(data, sc, "head")} selectedLabel={sel} todayLabel={today} unit="m" digits={3} color="#4ea9d8" compact onSelect={setDay} />
          </Panel>
          <Panel title="Main channel flow at the shari'a, L/s" bodyClassName="px-1 pb-1 pt-1">
            <TrendChart points={sourceSeries(data, sc, "flow")} selectedLabel={sel} todayLabel={today} unit="L/s" compact onSelect={setDay} />
          </Panel>
        </div>

        <div className="shrink-0">
          <BalanceBar />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-2.5">
        <ScenarioPanel />
        <div className="flex shrink-0 rounded-[5px] border border-line-2 p-0.5">
          {([["day", "Selected day"], ["model", "Model and assumptions"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex-1 rounded-[3px] px-2.5 py-1 text-[11.5px] ${tab === id ? "bg-panel-3 text-fg" : "text-fg-3 hover:text-fg-2"}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === "day" ? <DayDetail target={target} /> : <Assumptions />}
      </div>
    </div>
  );
}
