"use client";

import { useEffect, useState } from "react";
import { fmtDay, fmtGst } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { Mode } from "@/lib/types";

/** The falaj in one line: water leaves the well, drops through the tunnel and surfaces at the shari'a. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.64} viewBox="0 0 22 14" aria-hidden>
      <path d="M1 3.5h7.5c3.2 0 3.2 7 6.4 7H21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="1.6" cy="3.5" r="1.4" fill="#b8955f" />
      <path d="M1 11h3.5" stroke="#b8955f" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

const MODES: { id: Mode; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "forecast", label: "Forecast" },
  { id: "alerts", label: "Alerts" },
];

function Source({ dot, label, value, title }: { dot: string; label: string; value: string; title: string }) {
  return (
    <div title={title} className="flex items-center gap-2 whitespace-nowrap px-1">
      <span className="relative flex h-1.5 w-1.5">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{label}</span>
      <span className="font-mono text-[11.5px] text-ink-2">{value}</span>
    </div>
  );
}

/** Top bar: the mark, the mode switch, each data source with its freshness, the clock in Gulf time, Present and help. */
export function TopBar() {
  const data = useStore((s) => s.data)!;
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const tour = useStore((s) => s.tour);
  const setTour = useStore((s) => s.setTour);
  const setMethodOpen = useStore((s) => s.setMethodOpen);
  const startIntro = useStore((s) => s.startIntro);
  const [clock, setClock] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    tick();
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, []);

  const w = data.weather;
  const urgent = data.warnings.counts.ACT + data.warnings.counts.PREPARE;
  const health = data.telemetry.health;
  const sat = data.telemetry.satellite;
  const lastPass = sat.passes.filter((p) => p.status === "valid").at(-1);

  return (
    <header className="pointer-events-none absolute inset-x-4 top-4 z-30 flex items-start justify-between gap-3">
      <div className="glass pointer-events-auto flex h-11 items-center gap-3 rounded-full pl-4 pr-5">
        <button onClick={startIntro} title="Replay the opening" className="flex items-center gap-2.5 text-ink">
          <Mark />
          <span className="font-mono text-[13.5px] font-medium tracking-[0.34em] text-ink">FALAJLINE</span>
        </button>
        <span className="h-4 w-px bg-ink/15" />
        <span className="display whitespace-nowrap text-[18px] italic text-ink-2">Al Ain Oasis</span>
      </div>

      <nav data-tour="modes" className="glass pointer-events-auto flex h-11 items-center gap-1 rounded-full p-1" aria-label="Mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            aria-pressed={mode === m.id}
            className={`relative flex h-9 items-center gap-2 rounded-full px-4 text-[14px] transition-colors ${mode === m.id ? "bg-ink text-cream" : "text-ink-2 hover:text-ink"}`}
          >
            {m.label}
            {m.id === "alerts" && urgent > 0 && (
              <span className={`num flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[11.5px] ${mode === m.id ? "bg-cream text-ink" : "bg-act text-cream"}`}>{urgent}</span>
            )}
          </button>
        ))}
      </nav>

      <div data-tour="actions" className="glass pointer-events-auto flex h-11 items-center gap-3 rounded-full pl-4 pr-1.5">
        <Source
          dot={w.mode === "live" ? (w.status === "ok" ? "#7d9a5c" : "#c4972f") : "#d0772c"}
          label="Meteomatics"
          value={w.mode === "live" ? (w.status === "ok" ? `live ${fmtGst(w.retrieved_at)}` : "stale") : "demo data"}
          title={`${w.source}. Retrieved ${fmtGst(w.retrieved_at, true)} GST${w.forecast_issued_at ? `, issued ${fmtGst(w.forecast_issued_at, true)} GST` : ""}. ${w.parameters.filter((p) => p.status === "ok").length} parameters, ${w.queries_today} queries today.`}
        />
        <Source dot="#a3865a" label="Sensors" value={`sim ${health.ok}/${health.ok + health.stale + health.offline + health.stuck}`} title={data.telemetry.note} />
        {lastPass && <Source dot="#3b342a" label="Sentinel-2" value={fmtDay(lastPass.time)} title={sat.source ?? sat.label} />}
        <span className="h-4 w-px bg-ink/15" />
        <span className="num whitespace-nowrap text-[12.5px] text-ink-2">{clock ? `${fmtGst(new Date(clock).toISOString())} GST` : ""}</span>
        <button
          onClick={() => setTour({ running: !tour.running, step: 0, caption: null })}
          className={`flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors ${tour.running ? "bg-act text-cream" : "bg-ink text-cream hover:bg-ink-2"}`}
        >
          {tour.running ? (
            <svg width="9" height="9" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
          ) : (
            <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 1v8l7-4z" fill="currentColor" /></svg>
          )}
          {tour.running ? "Stop" : "Present"}
        </button>
        <button
          onClick={() => useStore.getState().setGuide({ open: true, step: 0 })}
          className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 hover:bg-ink/10 hover:text-ink"
          aria-label="Guided tour"
          title="Guided tour"
        >
          <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M5.3 5.4a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.5-.7 1v.3M7 10.2v.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
        </button>
        <button onClick={() => setMethodOpen(true)} className="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 hover:bg-ink/10 hover:text-ink" aria-label="Data and method" title="Data and method">
          <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M7 6.2V10M7 4.1v.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
      </div>
    </header>
  );
}
