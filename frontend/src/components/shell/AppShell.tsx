"use client";

import { useEffect, type ReactNode } from "react";
import { useStore } from "@/lib/store";
import { NavRail } from "./NavRail";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";

const REFRESH_MS = 60_000; // server caches weather for hours; this only picks up new simulated readings
const PLAY_STEP_MS = 850;

export function AppShell({ children }: { children: ReactNode }) {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const weather = useStore((s) => s.data?.weather);
  const playing = useStore((s) => s.playing);
  const load = useStore((s) => s.load);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const { day, setDay, setPlaying } = useStore.getState();
      if (day >= 21) setPlaying(false);
      else setDay(day + 1);
    }, PLAY_STEP_MS);
    return () => clearInterval(id);
  }, [playing]);

  if (status !== "ready") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="font-mono text-[13px] tracking-[0.32em] text-fg">FALAJLINE</div>
        {status === "error" ? (
          <>
            <p className="max-w-md text-sm text-fg-2">The FALAJLINE backend is not answering.</p>
            <p className="num max-w-md rounded border border-line bg-panel px-3 py-2 text-[11px] text-prepare">{error}</p>
            <p className="max-w-md text-xs text-fg-3">
              Start it from the <span className="num text-fg-2">backend</span> folder with{" "}
              <span className="num text-fg-2">uvicorn app.main:app --port 8000</span>, then retry.
            </p>
            <button onClick={() => void load()} className="rounded border border-line-2 px-3 py-1.5 text-xs text-fg-2 hover:border-water hover:text-fg">
              Retry
            </button>
          </>
        ) : (
          <p className="text-xs text-fg-3">Reading weather, sensors and the 21-day forecast…</p>
        )}
      </div>
    );
  }

  const banner =
    weather?.mode === "demo"
      ? { tone: "prepare", text: weather.notice ?? "DEMO DATA: synthetic weather, not live.", extra: weather.live_error?.message }
      : weather?.status === "stale"
        ? { tone: "watch", text: weather.notice ?? "Weather data is stale.", extra: weather.live_error?.message }
        : null;

  return (
    <div className="grid h-full grid-cols-[60px_minmax(0,1fr)] grid-rows-[44px_auto_minmax(0,1fr)_auto]">
      <div className="col-span-2">
        <TopBar />
      </div>
      <div className="col-span-2">
        {banner && (
          <div
            className="flex items-center gap-3 border-b px-4 py-1.5 text-[12px]"
            style={{
              borderColor: `color-mix(in srgb, var(--color-${banner.tone}) 40%, transparent)`,
              background: `color-mix(in srgb, var(--color-${banner.tone}) 10%, transparent)`,
              color: `var(--color-${banner.tone})`,
            }}
          >
            <span className="font-mono text-[10px] tracking-[0.1em]">{weather?.mode === "demo" ? "DEMO DATA" : "STALE WEATHER"}</span>
            <span className="text-fg-2">{banner.text}</span>
            {banner.extra && <span className="num truncate text-[11px] text-fg-3">{banner.extra}</span>}
          </div>
        )}
        {error && (
          <div className="border-b border-act/40 bg-act/10 px-4 py-1.5 text-[12px] text-act">
            Last refresh failed: <span className="num">{error}</span>. Showing the previous result.
          </div>
        )}
      </div>
      <NavRail />
      <main className="min-h-0 min-w-0 overflow-hidden">{children}</main>
      <div className="col-span-2">
        <Timeline />
      </div>
    </div>
  );
}
