"use client";

import { useEffect, useState } from "react";
import { fmtGst } from "@/lib/format";
import { useStore } from "@/lib/store";

const SHORT: Record<string, string> = {
  baseline: "Current operations",
  reduced_demand: "Reduced demand",
  improved_efficiency: "Improved efficiency",
};

function Source({ label, value, color, title, dashed }: { label: string; value: string; color: string; title: string; dashed?: boolean }) {
  return (
    <div title={title} className={`flex h-6 shrink-0 items-center gap-2 whitespace-nowrap rounded-[4px] border px-2 ${dashed ? "border-dashed" : ""}`} style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span className="font-mono text-[10px] tracking-[0.08em] text-fg-3">{label}</span>
      <span className="font-mono text-[10px] tracking-[0.06em]" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

export function TopBar() {
  const data = useStore((s) => s.data)!;
  const scenarioId = useStore((s) => s.scenarioId);
  const setScenario = useStore((s) => s.setScenario);
  const refreshing = useStore((s) => s.refreshing);
  const [clock, setClock] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setClock(Date.now());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  const w = data.weather;
  const live = w.mode === "live";
  const weatherColor = !live ? "var(--color-prepare)" : w.status === "ok" ? "var(--color-water-2)" : "var(--color-watch)";
  const weatherValue = !live ? "DEMO DATA" : w.status === "ok" ? `LIVE · METEOMATICS · ${fmtGst(w.retrieved_at)}` : `STALE · ${fmtGst(w.retrieved_at)}`;
  const health = data.telemetry.health;
  const down = health.stale + health.offline + health.stuck;

  return (
    <header className="flex h-11 items-center gap-4 border-b border-line bg-panel px-4">
      <button onClick={() => useStore.getState().openIntro()} title="Replay the introduction" className="flex items-center gap-2.5">
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden>
          <path d="M1 3h8c3 0 3 8 6 8h6" fill="none" stroke="var(--color-water)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M1 11h4" stroke="var(--color-sand)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="font-mono text-[13px] font-medium tracking-[0.3em] text-fg">FALAJLINE</span>
        <span className="hidden whitespace-nowrap text-[12px] text-fg-3 2xl:inline">Al Ain Oasis · falaj early warning</span>
      </button>

      <div className="ml-2 hidden min-w-0 items-center gap-2 overflow-hidden md:flex">
        <Source
          label="WEATHER"
          value={weatherValue}
          color={weatherColor}
          title={`${w.source}. Retrieved ${fmtGst(w.retrieved_at, true)} GST${w.forecast_issued_at ? `, forecast issued ${fmtGst(w.forecast_issued_at, true)} GST` : ""}. ${w.queries_today} API queries today.`}
        />
        <Source label="TELEMETRY" value={`SIMULATED · ${health.ok}/${health.ok + down} OK`} color="var(--color-sand)" dashed title={data.telemetry.note} />
        <Source label="MODEL" value="UNCALIBRATED" color="var(--color-fg-2)" title={data.meta.disclaimer} />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <div className="flex items-center rounded-[5px] border border-line-2 p-0.5" role="tablist" aria-label="Scenario">
          {data.scenario_order.map((id) => (
            <button
              key={id}
              role="tab"
              aria-selected={scenarioId === id}
              onClick={() => setScenario(id)}
              title={data.scenarios[id].scenario.description}
              className={`whitespace-nowrap rounded-[3px] px-2.5 py-1 text-[11px] transition-colors ${scenarioId === id ? "bg-panel-3 text-fg" : "text-fg-3 hover:text-fg-2"}`}
            >
              {SHORT[id] ?? id}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className={`h-1.5 w-1.5 rounded-full ${refreshing ? "bg-water" : "bg-fg-4"}`} title={refreshing ? "Refreshing" : "Idle"} />
          <span className="num text-[12px] text-fg-2">{clock ? fmtGst(new Date(clock).toISOString(), true) : "—"}</span>
          <span className="font-mono text-[10px] text-fg-3">GST</span>
        </div>
      </div>
    </header>
  );
}
