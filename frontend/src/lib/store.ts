"use client";

import { create } from "zustand";
import { retryMessage, stepQueue, syncQueue, type QueueState } from "./queue";
import type { Profile } from "@/twin/section";
import type { Bundle, CameraPreset, Mode, ScenarioForecast, Selection, WeatherField } from "./types";

const FAULT_CYCLE = ["ok", "stale", "offline"] as const;

export interface Caption {
  kicker: string;
  title: string;
  body?: string;
}

export interface Layers {
  gauges: boolean;
  flow: boolean;
  labels: boolean;
  wells: boolean;
}

interface Store {
  data: Bundle | null;
  field: WeatherField | null;
  status: "idle" | "loading" | "ready" | "error";
  refreshing: boolean;
  error: string | null;

  mode: Mode;
  day: number; // 0 = today, 1..21 = forecast days
  playing: boolean;
  playSpeed: number; // ms per day while playing
  scenarioId: string;
  faults: Record<string, string> | null; // null = backend demo default
  settings: { demand_reduction: number; loss_reduction: number };
  selection: Selection | null;
  hover: string | null;
  layers: Layers;
  camera: { preset: CameraPreset; zone?: string; nonce: number };
  intro: "pending" | "playing" | "done";
  introRun: number;
  tour: { running: boolean; step: number; caption: Caption | null; highlight: string | null };
  guide: { open: boolean; step: number }; // the step-by-step onboarding
  methodOpen: boolean;
  alertId: string | null;
  forecastTarget: string;
  queue: QueueState;
  assets: { dem: boolean; far: boolean; near: boolean; core: boolean; palms: number };
  profile: Profile | null; // long profile of the falaj, built by the twin from the elevation model

  load: () => Promise<void>;
  loadField: () => Promise<void>;
  setMode: (m: Mode) => void;
  setDay: (day: number) => void;
  setPlaying: (playing: boolean, speed?: number) => void;
  setScenario: (id: string) => void;
  cycleFault: (sensorId: string) => void;
  setFaults: (faults: Record<string, string> | null) => void;
  setSettings: (s: Partial<{ demand_reduction: number; loss_reduction: number }>) => void;
  select: (s: Selection | null, fly?: boolean) => void;
  setHover: (id: string | null) => void;
  toggleLayer: (k: keyof Layers, value?: boolean) => void;
  flyTo: (preset: CameraPreset, zone?: string) => void;
  startIntro: () => void;
  endIntro: () => void;
  setTour: (t: Partial<Store["tour"]>) => void;
  setGuide: (g: Partial<Store["guide"]>) => void;
  setMethodOpen: (open: boolean) => void;
  setAlertId: (id: string | null) => void;
  setForecastTarget: (t: string) => void;
  tickQueue: (now: number) => void;
  setLink: (online: boolean) => void;
  retry: (id: string) => void;
  resetQueue: () => void;
  setAsset: (a: Partial<Store["assets"]>) => void;
  setProfile: (p: Profile) => void;
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
  field: null,
  status: "idle",
  refreshing: false,
  error: null,

  mode: "overview",
  day: 0,
  playing: false,
  playSpeed: 900,
  scenarioId: "baseline",
  faults: null,
  settings: { demand_reduction: 0.15, loss_reduction: 0.45 },
  selection: null,
  hover: null,
  layers: { gauges: true, flow: true, labels: true, wells: false },
  camera: { preset: "system", nonce: 0 },
  intro: "pending",
  introRun: 0,
  tour: { running: false, step: 0, caption: null, highlight: null },
  guide: { open: false, step: 0 },
  methodOpen: false,
  alertId: null,
  forecastTarget: "system",
  queue: { online: true, messages: [] },
  assets: { dem: false, far: false, near: false, core: false, palms: 0 },
  profile: null,

  load: async () => {
    const id = ++requestId;
    const { faults, settings, data } = get();
    set(data ? { refreshing: true } : { status: "loading" });
    const qs = new URLSearchParams({ demand_reduction: String(settings.demand_reduction), loss_reduction: String(settings.loss_reduction) });
    const fp = faultParam(faults);
    if (fp !== null) qs.set("faults", fp);
    try {
      const res = await fetch(`/api/state?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Backend returned HTTP ${res.status}`);
      }
      const bundle = (await res.json()) as Bundle;
      if (id !== requestId) return; // superseded by a newer request
      // the twin is built from the geometry: keep the same object across refreshes so nothing is rebuilt
      const prevGeo = get().data?.geo;
      if (prevGeo && JSON.stringify(prevGeo) === JSON.stringify(bundle.geo)) bundle.geo = prevGeo;
      set((s) => ({
        data: bundle,
        status: "ready",
        refreshing: false,
        error: null,
        queue: syncQueue(s.queue, bundle.warnings.warnings, Date.now()),
      }));
    } catch (e) {
      if (id !== requestId) return;
      const message = e instanceof Error ? e.message : "Unknown error";
      set(get().data ? { refreshing: false, error: message } : { status: "error", refreshing: false, error: message });
    }
  },

  loadField: async () => {
    try {
      const res = await fetch("/api/weather/field");
      const field = (await res.json()) as WeatherField;
      set({ field });
    } catch {
      set({ field: { available: false, reason: "The weather field could not be loaded.", lats: [], lons: [], values: [], min: null, max: null } });
    }
  },

  setMode: (mode) => {
    const prev = get().mode;
    set({ mode });
    // the forecast sheet takes the lower half: frame the oasis in the space above it
    if (mode === "forecast" && prev !== "forecast") get().flyTo("oasis");
    if (mode === "overview" && prev === "forecast" && !get().selection) get().flyTo("system");
  },
  setDay: (day) => set({ day: Math.max(0, Math.min(21, Math.round(day))) }),
  setPlaying: (playing, speed) => set((s) => ({ playing, playSpeed: speed ?? s.playSpeed, day: playing && s.day >= 21 ? 0 : s.day })),
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
  setFaults: (faults) => {
    set({ faults });
    void get().load();
  },
  setSettings: (s) => {
    set((st) => ({ settings: { ...st.settings, ...s } }));
    void get().load();
  },

  select: (selection, fly = true) => {
    set({ selection });
    if (fly && selection?.type === "zone") get().flyTo("zone", selection.id);
    if (fly && (selection?.type === "source" || selection?.type === "tunnel")) get().flyTo("source");
  },
  setHover: (hover) => set((s) => (s.hover === hover ? s : { hover })),
  toggleLayer: (k, value) => set((s) => ({ layers: { ...s.layers, [k]: value ?? !s.layers[k] } })),
  flyTo: (preset, zone) => set((s) => ({ camera: { preset, zone, nonce: s.camera.nonce + 1 } })),

  startIntro: () => set((s) => ({ intro: "playing", introRun: s.introRun + 1, playing: false, selection: null, mode: "overview", day: 0 })),
  endIntro: () => set({ intro: "done" }),
  setTour: (t) => set((s) => ({ tour: { ...s.tour, ...t } })),
  setGuide: (g) => set((s) => ({ guide: { ...s.guide, ...g } })),
  setMethodOpen: (methodOpen) => set({ methodOpen }),
  setAlertId: (alertId) => set({ alertId }),
  setForecastTarget: (forecastTarget) => set({ forecastTarget }),

  tickQueue: (now) => set((s) => {
    const q = stepQueue(s.queue, now);
    return q === s.queue ? s : { queue: q };
  }),
  setLink: (online) => set((s) => ({ queue: { ...s.queue, online } })),
  retry: (id) => set((s) => ({ queue: retryMessage(s.queue, id, Date.now()) })),
  resetQueue: () => set((s) => ({ queue: syncQueue({ online: s.queue.online, messages: [] }, s.data?.warnings.warnings ?? [], Date.now()) })),
  setAsset: (a) => set((s) => ({ assets: { ...s.assets, ...a } })),
  setProfile: (profile) => set({ profile }),
}));

/** The forecast currently driving every view. */
export function useScenario(): ScenarioForecast | null {
  return useStore((s) => (s.data ? (s.data.scenarios[s.scenarioId] ?? s.data.scenarios.baseline) : null));
}
