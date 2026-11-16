"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { setAppState } from "@/twin/CameraRig";
import { Guide, wasGuided } from "./Guide";
import { Intro } from "./Intro";
import { AlertsPanel } from "./panels/AlertsPanel";
import { ForecastSheet } from "./panels/ForecastSheet";
import { Inspector } from "./panels/Inspector";
import { MethodSheet } from "./panels/MethodSheet";
import { Overview } from "./panels/Overview";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";
import { Tour } from "./Tour";

const TwinScene = dynamic(() => import("@/twin/Scene"), { ssr: false });

const SEEN = "falajline:intro-seen";

export function Workspace() {
  const status = useStore((s) => s.status);
  const error = useStore((s) => s.error);
  const intro = useStore((s) => s.intro);
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const field = useStore((s) => s.field);
  const assets = useStore((s) => s.assets);
  const weatherMode = useStore((s) => s.data?.weather.mode);
  const load = useStore((s) => s.load);
  const loadField = useStore((s) => s.loadField);

  useEffect(() => {
    void load();
    void loadField();
    const id = setInterval(() => void useStore.getState().load(), 90_000);
    return () => clearInterval(id);
  }, [load, loadField]);

  // retry quietly while the backend is starting
  useEffect(() => {
    if (status !== "error") return;
    const id = setTimeout(() => void load(), 4000);
    return () => clearTimeout(id);
  }, [status, load]);

  // the opening sequence starts once the forecast, the terrain, the wide imagery and the UAE field are in
  useEffect(() => {
    if (intro !== "pending" || status !== "ready" || !assets.dem || !assets.far || field === null) return;
    const params = new URLSearchParams(window.location.search);
    let seen = false;
    try {
      seen = window.sessionStorage.getItem(SEEN) === "1";
      window.sessionStorage.setItem(SEEN, "1");
    } catch {
      /* storage blocked: play it */
    }
    if (params.has("intro")) seen = false;
    if (seen || params.has("skip")) {
      setAppState();
      useStore.getState().endIntro();
    } else {
      useStore.getState().startIntro();
    }
    if (params.has("present")) setTimeout(() => useStore.getState().setTour({ running: true, step: 0 }), seen ? 800 : 14500);
  }, [intro, status, assets.dem, assets.far, field]);

  // first visit: once the opening has landed, offer the guided tour (?guide forces it)
  useEffect(() => {
    if (intro !== "done") return;
    const params = new URLSearchParams(window.location.search);
    const force = params.has("guide");
    if (!force && (wasGuided() || params.has("skip") || params.has("present"))) return;
    const id = setTimeout(() => {
      if (!useStore.getState().tour.running) useStore.getState().setGuide({ open: true, step: 0 });
    }, force ? 300 : 900);
    return () => clearTimeout(id);
  }, [intro]);

  // the simulated delivery queue advances in the background
  useEffect(() => {
    const id = setInterval(() => useStore.getState().tickQueue(Date.now()), 400);
    return () => clearInterval(id);
  }, []);

  const ready = status === "ready" && intro === "done";
  return (
    <div className="relative h-full w-full overflow-hidden bg-ink grain">
      <TwinScene />
      <Intro />
      {ready && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <TopBar />
          {mode === "overview" && <Overview />}
          {mode === "overview" && selection && <Inspector />}
          {mode === "forecast" && <ForecastSheet />}
          {mode === "alerts" && <AlertsPanel />}
          <Timeline />
          <MethodSheet />
          <Tour />
          <Guide />
          {weatherMode === "demo" && (
            <div className="glass-soft pointer-events-auto absolute left-1/2 top-[70px] z-30 -translate-x-1/2 px-4 py-1.5 text-[13px] text-prepare">Demo data · synthetic weather, not live Meteomatics data</div>
          )}
          {error && <div className="glass-soft pointer-events-auto absolute bottom-[100px] left-1/2 z-30 -translate-x-1/2 px-4 py-1.5 text-[13px] text-act">Last refresh failed: {error}. Showing the previous result.</div>}
        </div>
      )}
      {ready && (
        <div className="pointer-events-none absolute bottom-[96px] right-6 z-10 font-mono text-[10px] uppercase tracking-[0.12em] text-ink/70 mix-blend-multiply">
          Sentinel-2 cloudless 2023 by EOX · imagery © Esri, Maxar, Earthstar Geographics · SRTM · OpenStreetMap
        </div>
      )}
    </div>
  );
}
