"use client";

import { useCallback, useEffect, useRef } from "react";
import { RISK_COLOR, fmtDay, fmtWeekday, parseDay } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import { Risk } from "./ui";

/**
 * Twenty-one days that drive every view. Each column is a day, each of its six cells a farm zone coloured
 * by risk, so the way a shortage spreads through the oasis is visible at a glance.
 */
export function Timeline() {
  const sc = useScenario();
  const day = useStore((s) => s.day);
  const playing = useStore((s) => s.playing);
  const speed = useStore((s) => s.playSpeed);
  const setDay = useStore((s) => s.setDay);
  const setPlaying = useStore((s) => s.setPlaying);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const st = useStore.getState();
      if (st.day >= 21) st.setPlaying(false);
      else st.setDay(st.day + 1);
    }, speed);
    return () => clearInterval(id);
  }, [playing, speed]);

  const pick = useCallback(
    (clientX: number) => {
      const el = track.current;
      if (!el || !sc) return;
      const r = el.getBoundingClientRect();
      setDay(Math.floor(((clientX - r.left) / r.width) * sc.dates.length));
    },
    [sc, setDay],
  );

  if (!sc) return null;
  const n = sc.dates.length;
  const g = sc.guidance[day];
  const firsts = new Map<number, string[]>();
  sc.zones.forEach((z) => {
    if (z.shortfall.first_day !== null) firsts.set(z.shortfall.first_day, [...(firsts.get(z.shortfall.first_day) ?? []), z.id]);
  });

  return (
    <footer data-tour="timeline" className="glass pointer-events-auto absolute inset-x-4 bottom-4 z-30 flex h-[76px] items-stretch overflow-hidden rounded-[20px]">
      <div className="flex w-[214px] shrink-0 items-center gap-3.5 border-r hairline pl-4 pr-3">
        <button
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Pause" : "Play the 21-day forecast"}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-cream transition-transform hover:scale-105"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3.2 2v8M8.8 2v8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3.5 1.6v8.8l7-4.4z" fill="currentColor" /></svg>
          )}
        </button>
        <div className="min-w-0">
          <div className="display text-[25px] text-ink">{fmtDay(sc.dates[day])}</div>
          <div className="mt-1 flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            <span className={day === 0 ? "text-ink" : ""}>{day === 0 ? "Today" : `+${day} d`}</span>
            <span>· {fmtWeekday(sc.dates[day])}</span>
            {day !== 0 && (
              <button onClick={() => setDay(0)} title="Back to today" className="ml-0.5 rounded-full px-1.5 text-ink-3 ring-1 ring-ink/15 hover:bg-ink/5 hover:text-ink">
                today
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="relative min-w-0 flex-1 px-4 pb-2 pt-1.5">
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
            const sel = i === day;
            const first = firsts.get(i);
            return (
              <div key={iso} className="relative flex flex-col px-[2px]">
                <div className="num h-3 text-center text-[10px] leading-3 text-act">{first ? first.join(" ") : ""}</div>
                <div className={`mt-[3px] flex flex-1 flex-col gap-[2px] rounded-[5px] p-[2px] transition-colors ${sel ? "bg-ink/20" : i < day ? "opacity-60" : "hover:bg-ink/8"}`}>
                  {sc.zones.map((z) => {
                    const short = z.ratio.central[i] < sc.required_supply_ratio;
                    return (
                      <div
                        key={z.id}
                        title={`${z.id} · ${fmtDay(iso)} · ${z.risk[i]} · ${(z.ratio.central[i] * 100).toFixed(0)}% of demand`}
                        className="flex-1 rounded-[2px]"
                        style={{ background: RISK_COLOR[z.risk[i]], opacity: short ? 1 : z.risk[i] === "NORMAL" ? 0.22 : 0.5 }}
                      />
                    );
                  })}
                </div>
                <div className={`num mt-1 text-center text-[11px] leading-none ${sel ? "text-ink" : "text-ink-3"}`}>
                  {d.getUTCDate()}
                  {(i === 0 || d.getUTCDate() === 1) && <span className="ml-0.5 text-[9.5px] uppercase tracking-wider text-ink-4">{fmtDay(iso).split(" ")[1]}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div data-tour="guidance" className="flex w-[390px] shrink-0 flex-col justify-center gap-1 border-l hairline px-5">
        <div className="flex items-center gap-2">
          <Risk level={g.level} />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">If the forecast holds</span>
        </div>
        <div className="truncate text-[14.5px] text-ink" title={g.headline}>
          {g.headline}
        </div>
        <div className="line-clamp-1 text-[13px] text-ink-3" title={g.action}>
          {g.action}
        </div>
      </div>
    </footer>
  );
}
