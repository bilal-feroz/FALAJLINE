"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { RISK_COLOR, RISK_WORD, fmt, fmtLong } from "@/lib/format";
import { useStore } from "@/lib/store";
import type { RiskLevel } from "@/lib/types";
import { toXZ } from "@/twin/geo";
import { screen } from "@/twin/screen";
import { Prov } from "./ui";

/**
 * First-run guide: a short, step-by-step walk through the interface. Each step spotlights one part of the
 * screen (or a place in the twin), says in plain words what it is for, and moves the camera so the user
 * sees it. Replayable from the ? button in the top bar.
 */

const SEEN = "falajline:guided";

export function wasGuided() {
  try {
    return window.localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

function markGuided() {
  try {
    window.localStorage.setItem(SEEN, "1");
  } catch {
    /* storage blocked: the guide simply offers itself again next time */
  }
}

type P3 = [number, number, number];
/** What a step singles out: nothing (centred card), an element of the interface, or a place in the twin. */
type Target = { kind: "none" } | { kind: "dom"; sel: string; pad?: number } | { kind: "world"; pts: P3[]; pad?: number };
type Side = "right" | "left" | "below" | "above";
type Align = "start" | "center" | "end";

interface Step {
  kicker: string;
  title: string;
  body: ReactNode;
  target: Target;
  side?: Side[];
  align?: Align;
  enter?: () => void;
  leave?: () => void;
}

const st = () => useStore.getState();

function overviewCamera() {
  st().setMode("overview");
  st().select(null, false);
  st().flyTo("system");
}

function oasisCamera() {
  st().setMode("overview");
  st().select(null, false);
  st().flyTo("oasis");
}

function Legend() {
  const levels: RiskLevel[] = ["NORMAL", "WATCH", "PREPARE", "ACT"];
  return (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {levels.map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5 rounded-full px-2 py-[2px] font-mono text-[10.5px] uppercase tracking-[0.12em]" style={{ color: RISK_COLOR[l], background: `color-mix(in srgb, ${RISK_COLOR[l]} 12%, transparent)` }}>
          <span className="h-2 w-2 rounded-full" style={{ background: RISK_COLOR[l] }} />
          {RISK_WORD[l]}
        </span>
      ))}
    </div>
  );
}

function useSteps(): Step[] {
  const data = useStore((s) => s.data);
  return useMemo(() => {
    if (!data) return [];
    const geo = data.geo;
    const base = data.scenarios.baseline;
    const first = base.system.first_shortfall_day;
    const fz = base.zones.find((z) => z.shortfall.first_day === first) ?? base.zones[0];
    const fzGeo = geo.zones.find((z) => z.id === fz.id) ?? geo.zones[0];
    const gaugeTop = (z: (typeof geo.zones)[number]): P3 => {
      const [x, zz] = toXZ(z.centroid.lon, z.centroid.lat);
      return [x, 165, zz];
    };
    const ground = (ring: [number, number][]): P3[] =>
      ring.map(([lon, lat]) => {
        const [x, z] = toXZ(lon, lat);
        return [x, 4, z];
      });
    const oasis = [...ground(geo.oasis.outline), ...geo.zones.map(gaugeTop)];
    const zone = [...ground(fzGeo.polygon), gaugeTop(fzGeo)];
    const pct = fmt(fz.ratio.central[0] * 100, 0);
    const name = fz.name.replace(" · ", ", ");
    const reduced = data.comparison.find((c) => c.id === "reduced_demand");

    return [
      {
        kicker: "Welcome",
        title: "Know when the oasis will run short of water, three weeks ahead.",
        body: "FALAJLINE is a digital twin of one falaj, the underground channel that carries groundwater 7 km from a mother well to six farm zones in Al Ain Oasis. This tour takes about a minute.",
        target: { kind: "none" },
        enter: () => {
          overviewCamera();
          st().setDay(0);
        },
      },
      {
        kicker: "The twin",
        title: "This is the oasis, in 3D",
        body: "Real satellite imagery on real terrain. The palm groves keep their colour; the city around them is drawn like a map. Drag to move around, scroll to zoom.",
        target: { kind: "world", pts: oasis, pad: 14 },
        side: ["left", "right"],
        enter: oasisCamera,
      },
      {
        kicker: "Farm zones",
        title: "Six zones, each coloured by risk",
        body: (
          <>
            <Legend />
            The glass column in each zone is its water supply against its demand. When the water sits below the dark ring, the farms get less than they need.
          </>
        ),
        target: { kind: "world", pts: zone, pad: 14 },
        side: ["right", "left"],
        enter: oasisCamera,
      },
      {
        kicker: "Details",
        title: "Click a zone to open it",
        body: `${name} gets ${pct}% of what it needs today and first runs short on ${first === null ? "no day in the next three weeks" : fmtLong(base.dates[first])}. Its panel shows the 21-day outlook, satellite canopy health and the recommended action.`,
        target: { kind: "dom", sel: '[data-tour="inspector"]' },
        side: ["left", "below"],
        enter: () => {
          st().setMode("overview");
          st().select({ type: "zone", id: fz.id });
        },
      },
      {
        kicker: "Overview",
        title: "The whole oasis at a glance",
        body: "The overall state (Normal, Watch, Prepare or Act), today's flow and safety margin, the mother well's level, every zone and live weather from Meteomatics.",
        target: { kind: "dom", sel: '[data-tour="overview"]' },
        side: ["right"],
        enter: overviewCamera,
      },
      {
        kicker: "Trust",
        title: "Every number says where it comes from",
        body: (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <Prov kind="live" />
              <Prov kind="observed" />
              <Prov kind="simulated" />
              <Prov kind="modelled" />
            </div>
            LIVE and OBS are real data: Meteomatics weather and Sentinel-2 satellite imagery. SIM marks the simulated field sensors. MODEL is calculated by the water model. Nothing simulated is passed off as a measurement.
          </>
        ),
        target: { kind: "dom", sel: '[data-tour="kpis"]' },
        side: ["right"],
        enter: overviewCamera,
      },
      {
        kicker: "The next 21 days",
        title: "Press play to see the future",
        body: "Each column is a day and each row a zone. Press play or drag across it and the whole twin follows the forecast: the columns drain, the borders change colour and the flow in the channels thins.",
        target: { kind: "dom", sel: '[data-tour="timeline"]', pad: 4 },
        side: ["above"],
        align: "start",
        enter: () => {
          overviewCamera();
          st().setDay(0);
          st().setPlaying(true, 420);
        },
        leave: () => {
          st().setPlaying(false);
          st().setDay(0);
        },
      },
      {
        kicker: "What to do",
        title: "Who is hit first, and the step to take now",
        body: "If the forecast holds, this is the advice for today. It changes as you move through the timeline.",
        target: { kind: "dom", sel: '[data-tour="guidance"]', pad: 2 },
        side: ["above"],
        align: "end",
        enter: overviewCamera,
      },
      {
        kicker: "Forecast view",
        title: "Test a response before acting",
        body: `Supply against demand for the next 21 days, with the uncertainty band. On the right, try a response: cutting demand by 15% ${reduced?.days_gained ? `buys ${reduced.days_gained} more days` : "moves the shortage later"}. Each scenario is re-run by the same model, not drawn by hand.`,
        target: { kind: "dom", sel: '[data-tour="forecast"]', pad: 4 },
        side: ["above"],
        align: "end",
        enter: () => {
          st().select(null, false);
          st().setMode("forecast");
        },
      },
      {
        kicker: "Alerts view",
        title: "Warnings, ready to send",
        body: "Each warning says which zone, from when, how sure the model is and why, and what to do. The message to farm operators is written in English and Arabic. Delivery is simulated: nothing is sent.",
        target: { kind: "dom", sel: '[data-tour="alerts"]' },
        side: ["left"],
        align: "start",
        enter: () => st().setMode("alerts"),
      },
      {
        kicker: "The source",
        title: "Where the water comes from",
        body: "The mother well, 7 km up the falaj. Where the tunnel lies below the water table it collects water. As the well level falls, that wet stretch gets shorter and less water reaches the farms.",
        target: { kind: "dom", sel: '[data-tour="inspector"]' },
        side: ["left", "below"],
        align: "end",
        enter: () => {
          st().setMode("overview");
          st().select({ type: "source", id: "MW-1" });
        },
      },
      {
        kicker: "You're ready",
        title: "Explore on your own",
        body: "Click a zone, a channel or the mother well. Present plays the whole story by itself, and this guide is always on the ? button.",
        target: { kind: "dom", sel: '[data-tour="actions"]', pad: 4 },
        side: ["below"],
        align: "end",
        enter: overviewCamera,
      },
    ];
  }, [data]);
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Move the spotlight onto the target and the card beside it. Runs every frame: the camera may be flying. */
function place(t: Target, sides: Side[], align: Align, hole: HTMLDivElement, card: HTMLDivElement, dim: HTMLDivElement) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  let r: { x: number; y: number; w: number; h: number; round: number } | null = null;
  if (t.kind === "dom") {
    const el = document.querySelector(t.sel);
    if (el) {
      const b = el.getBoundingClientRect();
      const p = t.pad ?? 8;
      if (b.width > 0) r = { x: b.left - p, y: b.top - p, w: b.width + 2 * p, h: b.height + 2 * p, round: Math.min(26, b.height / 2 + p) };
    }
  } else if (t.kind === "world") {
    // the box around the place as it is drawn right now, whatever the camera is doing
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const q of t.pts) {
      const s = screen.project(...q);
      if (!s) continue;
      x0 = Math.min(x0, s[0]);
      y0 = Math.min(y0, s[1]);
      x1 = Math.max(x1, s[0]);
      y1 = Math.max(y1, s[1]);
    }
    if (x1 > x0) {
      const p = t.pad ?? 12;
      const w = x1 - x0 + 2 * p;
      const h = y1 - y0 + 2 * p;
      r = { x: x0 - p, y: y0 - p, w, h, round: Math.min(90, Math.min(w, h) * 0.32) };
    }
  }
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const M = 16;
  const TOP = 76; // under the top bar
  const gap = 20;
  if (!r) {
    dim.style.opacity = "1";
    hole.style.opacity = "0";
    card.style.left = `${(W - cw) / 2}px`;
    card.style.top = `${(H - ch) / 2}px`;
    return;
  }
  dim.style.opacity = "0";
  hole.style.opacity = "1";
  hole.style.left = `${r.x}px`;
  hole.style.top = `${r.y}px`;
  hole.style.width = `${r.w}px`;
  hole.style.height = `${r.h}px`;
  hole.style.borderRadius = `${r.round}px`;

  const fits: Record<Side, boolean> = {
    right: r.x + r.w + gap + cw <= W - M,
    left: r.x - gap - cw >= M,
    below: r.y + r.h + gap + ch <= H - M,
    above: r.y - gap - ch >= M,
  };
  const side = [...sides, "right", "left", "below", "above"].find((s) => fits[s as Side]) as Side | undefined;
  const along = (start: number, size: number, own: number) => (align === "start" ? start : align === "end" ? start + size - own : start + size / 2 - own / 2);
  let x: number;
  let y: number;
  if (side === "right" || side === "left") {
    x = side === "right" ? r.x + r.w + gap : r.x - gap - cw;
    y = clamp(along(r.y, r.h, ch), TOP, H - ch - M);
  } else if (side === "below" || side === "above") {
    x = clamp(along(r.x, r.w, cw), M, W - cw - M);
    y = side === "below" ? r.y + r.h + gap : r.y - gap - ch;
  } else {
    x = (W - cw) / 2;
    y = (H - ch) / 2;
  }
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
}

export function Guide() {
  const guide = useStore((s) => s.guide);
  const setGuide = useStore((s) => s.setGuide);
  const steps = useSteps();
  const hole = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const dim = useRef<HTMLDivElement>(null);
  const step = guide.open ? steps[guide.step] : undefined;
  const last = guide.step >= steps.length - 1;

  const close = () => {
    markGuided();
    setGuide({ open: false, step: 0 });
    st().setPlaying(false);
    st().setDay(0);
    overviewCamera();
  };
  const next = () => (last ? close() : setGuide({ step: guide.step + 1 }));
  const back = () => setGuide({ step: Math.max(0, guide.step - 1) });

  // each step frames what it talks about, and undoes anything it started (the timeline playing)
  useEffect(() => {
    if (!step) return;
    if (st().tour.running) st().setTour({ running: false, caption: null, highlight: null });
    step.enter?.();
    return () => step.leave?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide.open, guide.step]);

  useEffect(() => {
    if (!step) return;
    let raf = 0;
    const loop = () => {
      if (hole.current && card.current && dim.current) place(step.target, step.side ?? [], step.align ?? "center", hole.current, card.current, dim.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [step]);

  useEffect(() => {
    if (!guide.open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  if (!step) return null;
  const welcome = guide.step === 0;
  return (
    <div className="pointer-events-auto fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Guided tour">
      {/* holds the scene still while the guide talks; dims everything when no part is singled out */}
      <div ref={dim} className="absolute inset-0 bg-[rgb(16_12_8/0.5)] transition-opacity duration-500" />
      <div
        ref={hole}
        className="pointer-events-none absolute opacity-0 transition-[left,top,width,height,border-radius,opacity] duration-500 ease-out"
        style={{ boxShadow: "0 0 0 2px rgb(246 239 225 / 0.95), 0 0 34px 8px rgb(246 239 225 / 0.28), 0 0 0 200vmax rgb(16 12 8 / 0.46)" }}
      />
      <div ref={card} className="glass glass-solid absolute w-[392px] p-6 transition-[left,top] duration-500 ease-out" style={{ left: "50%", top: "50%" }}>
        <div key={guide.step} className="fade">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-beige">{step.kicker}</span>
            <span className="flex items-center gap-2">
              <span className="num text-[11px] text-ink-4">
                {guide.step + 1} / {steps.length}
              </span>
              {!welcome && !last && (
                <button onClick={close} title="End the tour (Esc)" aria-label="End the tour" className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-ink/5 hover:text-ink">
                  <svg width="10" height="10" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                </button>
              )}
            </span>
          </div>
          <h2 className={`display mt-3 text-ink ${welcome ? "text-[34px] leading-[1.02]" : "text-[27px] leading-[1.05]"}`}>{step.title}</h2>
          <div className="mt-3 text-[14.5px] leading-relaxed text-ink-2">{step.body}</div>
        </div>
        <div className="mt-5 flex items-center gap-2">
          <div className="mr-auto flex gap-1">
            {steps.map((_, i) => (
              <span key={i} className={`h-1 rounded-full transition-all ${i === guide.step ? "w-5 bg-ink" : i < guide.step ? "w-1.5 bg-ink/50" : "w-1.5 bg-ink/15"}`} />
            ))}
          </div>
          {welcome ? (
            <button onClick={close} className="h-9 rounded-full px-3.5 text-[13px] text-ink-3 hover:text-ink">
              Skip
            </button>
          ) : (
            <button onClick={back} className="h-9 rounded-full px-3.5 text-[13px] text-ink-3 hover:text-ink">
              Back
            </button>
          )}
          <button onClick={next} className="h-9 rounded-full bg-ink px-4 text-[13px] font-medium text-cream hover:bg-ink-2">
            {welcome ? "Show me around" : last ? "Start exploring" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
