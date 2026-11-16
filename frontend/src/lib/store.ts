"use client";

import { create } from "zustand";
import type { Bundle, Queue, ScenarioForecast, Selection } from "./types";

const FAULT_CYCLE = ["ok", "stale", "offline"] as const;

interface Store {
  data: Bundle | null;
  status: "idle" | "loading" | "ready" | "error";
  refreshing: boolean;
  error: string | null;

  day: number; // 0 = today, 1..21 = forecast days
  playing: boolean;
  scenarioId: string;
  faults: Record<string, string> | null; // null = backend demo default
  settings: { demand_reduction: number; loss_reduction: number };
  selection: Selection | null;

  load: () => Promise<void>;
  setDay: (day: number) => void;
  setPlaying: (playing: boolean) => void;
  setScenario: (id: string) => void;
  cycleFault: (sensorId: string) => void;
  resetFaults: (healthy: boolean) => void;
  setSettings: (s: Partial<{ demand_reduction: number; loss_reduction: number }>) => void;
  select: (s: Selection | null) => void;
  setQueue: (q: Queue) => void;
}

function faultParam(faults: Record<string, string> | null): string | null {
  if (faults === null) return null;
  const parts = Object.entries(faults)
    .filter(([, mode]) => mode && mode !== "ok")
    .map(([id, mode]) => `${id}:${mode}`);
  return parts.length ? parts.join(",") : "none";
}

let requestId = 0;

export const useStore = create<Store>((set, get) => ({
  data: null,
  status: "idle",
  refreshing: false,
  error: null,
  day: 0,
  playing: false,
  scenarioId: "baseline",
  faults: null,
  settings: { demand_reduction: 0.15, loss_reduction: 0.45 },
  selection: null,

  load: async () => {
    const id = ++requestId;
    const { faults, settings, data } = get();
    set(data ? { refreshing: true } : { status: "loading" });
    const qs = new URLSearchParams({
      demand_reduction: String(settings.demand_reduction),
      loss_reduction: String(settings.loss_reduction),
    });
    const fp = faultParam(faults);
    if (fp !== null) qs.set("faults", fp);
    try {
      const res = await fetch(`/api/state?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Backend returned HTTP ${res.status}`);
      }
      const bundle = (await res.json()) as Bundle;
      if (id !== requestId) return; // a newer request superseded this one
      set({ data: bundle, status: "ready", refreshing: false, error: null });
    } catch (e) {
      if (id !== requestId) return;
      const message = e instanceof Error ? e.message : "Unknown error";
      set(get().data ? { refreshing: false, error: message } : { status: "error", refreshing: false, error: message });
    }
  },

  setDay: (day) => set({ day: Math.max(0, Math.min(21, Math.round(day))) }),
  setPlaying: (playing) => set((s) => ({ playing, day: playing && s.day >= 21 ? 0 : s.day })),
  setScenario: (scenarioId) => set({ scenarioId }),

  cycleFault: (sensorId) => {
    const { data, faults } = get();
    const current = { ...(faults ?? data?.telemetry.faults ?? {}) };
    const now = current[sensorId] ?? "ok";
    const next = FAULT_CYCLE[(FAULT_CYCLE.indexOf(now as (typeof FAULT_CYCLE)[number]) + 1) % FAULT_CYCLE.length];
    if (next === "ok") delete current[sensorId];
    else current[sensorId] = next;
    set({ faults: current });
    void get().load();
  },

  resetFaults: (healthy) => {
    set({ faults: healthy ? {} : null });
    void get().load();
  },

  setSettings: (s) => {
    set((st) => ({ settings: { ...st.settings, ...s } }));
    void get().load();
  },

  select: (selection) => set({ selection }),
  setQueue: (queue) => set((s) => (s.data ? { data: { ...s.data, queue } } : {})),
}));

/** The forecast currently driving every view. */
export function useScenario(): ScenarioForecast | null {
  return useStore((s) => (s.data ? (s.data.scenarios[s.scenarioId] ?? s.data.scenarios.baseline) : null));
}
