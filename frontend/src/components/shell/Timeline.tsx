"use client";

import { useCallback, useRef } from "react";
import { GradeChip, ProvTag, RiskChip } from "@/components/ui/primitives";
import { RISK_COLOR, fmtDay, fmtWeekday, parseDay } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";

/**
 * The 21-day timeline that drives every view. Each column is a day; each of the six thin rows is a farm
 * zone coloured by its risk state on that day, so the way a shortage spreads is visible at a glance.
 */
export function Timeline() {
  const sc = useScenario();
  const day = useStore((s) => s.day);
  const playing = useStore((s) => s.playing);
  const setDay = useStore((s) => s.setDay);
  const setPlaying = useStore((s) => s.setPlaying);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const pick = useCallback(
    (clientX: number) => {
      const el = track.current;
      if (!el || !sc) return;
      const r = el.getBoundingClientRect();
      const n = sc.dates.length;
      setDay(Math.floor(((clientX - r.left) / r.width) * n));
    },
    [sc, setDay],
  );

  if (!sc) return null;
  const n = sc.dates.length;
  const g = sc.guidance[day];
  const conf = sc.confidence.system[day];
  const firsts = new Map<number, string[]>();
  sc.zones.forEach((z) => {
    if (z.shortfall.first_day !== null) firsts.set(z.shortfall.first_day, [...(firsts.get(z.shortfall.first_day) ?? []), z.id]);
  });

  return (
    <footer className="flex h-[92px] items-stretch border-t border-line bg-panel">
      <div className="flex w-[208px] shrink-0 items-center gap-3 border-r border-line px-4">
        <button
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Pause timeline" : "Play timeline"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-2 text-fg-2 transition-colors hover:border-water hover:text-water"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 2v8M9 2v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="num text-[17px] font-medium leading-none text-fg">{fmtDay(sc.dates[day])}</span>
            <span className="num text-[11px] text-fg-3">{fmtWeekday(sc.dates[day])}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="num text-[11px] text-water">{day === 0 ? "TODAY" : `DAY +${day}`}</span>
            <ProvTag kind={day === 0 ? "simulated" : "modelled"} short />
            {day !== 0 && (
              <button onClick={() => setDay(0)} className="font-mono text-[10px] tracking-wide text-fg-3 underline-offset-2 hover:text-fg-2 hover:underline">
                reset
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="relative min-w-0 flex-1 px-4 py-2">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Forecast day"
          aria-valuemin={0}
          aria-valuemax={n - 1}
          aria-valuenow={day}
          aria-valuetext={fmtDay(sc.dates[day])}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setDay(day + 1);
            if (e.key === "ArrowLeft") setDay(day - 1);
            if (e.key === "Home") setDay(0);
            if (e.key === "End") setDay(n - 1);
          }}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            setPlaying(false);
            pick(e.clientX);
          }}
          onPointerMove={(e) => dragging.current && pick(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          className="grid h-full cursor-pointer select-none touch-none outline-none"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {sc.dates.map((iso, i) => {
            const d = parseDay(iso);
            const selected = i === day;
            const showMonth = i === 0 || d.getUTCDate() === 1;
            return (
              <div key={iso} className="relative flex flex-col items-stretch px-[1.5px]">
                <div className="num flex h-3.5 items-end justify-center text-[9px] leading-none text-act">
                  {firsts.get(i)?.join(" ") ?? ""}
                </div>
                <div
                  className={`mt-0.5 flex flex-1 flex-col gap-px overflow-hidden rounded-[3px] transition-opacity ${selected ? "opacity-100" : i < day ? "opacity-55" : "opacity-80 hover:opacity-100"}`}
                  style={{ outline: selected ? "1.5px solid var(--color-fg)" : "none", outlineOffset: 1 }}
                >
                  {sc.zones.map((z) => (
                    <div
                      key={z.id}
                      className="flex-1"
                      title={`${z.id} · ${fmtDay(iso)} · ${z.risk[i]} · supply ${(z.ratio.central[i] * 100).toFixed(0)}% of demand`}
                      style={{ background: RISK_COLOR[z.risk[i]], opacity: z.ratio.central[i] < sc.required_supply_ratio ? 1 : z.risk[i] === "NORMAL" ? 0.28 : 0.6 }}
                    />
                  ))}
                </div>
                <div className={`num mt-1 text-center text-[10px] leading-none ${selected ? "text-fg" : "text-fg-3"}`}>
                  {d.getUTCDate()}
                  {showMonth && <span className="ml-0.5 text-[8.5px] text-fg-3">{fmtDay(iso).split(" ")[1]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex w-[380px] shrink-0 flex-col justify-center gap-1.5 border-l border-line px-4">
        <div className="flex items-center gap-2">
          <RiskChip level={g.level} size="md" />
          <GradeChip grade={conf.grade} index={conf.index} />
          <span className="ml-auto font-mono text-[9.5px] tracking-wide text-fg-3">IF THE FORECAST HOLDS</span>
        </div>
        <div className="truncate text-[13px] font-medium text-fg" title={g.headline}>
          {g.headline}
        </div>
        <div className="line-clamp-2 text-[11.5px] leading-snug text-fg-2" title={g.action}>
          {g.action}
        </div>
      </div>
    </footer>
  );
}
