"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import uae from "@/data/uae-outline.json";
import { useStore } from "@/lib/store";

/**
 * Opening sequence: the outline of the UAE draws itself, a marker lands on Al Ain, and the view zooms in
 * until the real oasis outline and the conceptual falaj fill the frame, then hands over to the digital twin.
 *
 * The country outline is Natural Earth (public domain); the oasis outline is OpenStreetMap; the falaj line is
 * the same conceptual alignment used everywhere else in the app.
 */

const W = 1000;
const H = 620;
const K = 140; // viewBox units per degree of latitude
const LON0 = 54.0;
const LAT0 = 24.35;
const KX = Math.cos((24.3 * Math.PI) / 180);
const ZOOM = 78;

const AL_AIN: [number, number] = [55.7666, 24.2171];

const T_MARK = 1500;
const T_ZOOM = 3200;
const D_ZOOM = 2700;
const T_HOLD = T_ZOOM + D_ZOOM;
const T_FADE = T_HOLD + 900;
const D_FADE = 800;

const project = ([lon, lat]: number[]): [number, number] => [W / 2 + (lon - LON0) * KX * K, H / 2 - (lat - LAT0) * K];
const toPath = (ring: number[][], close = true) => ring.map((p, i) => `${i ? "L" : "M"}${project(p).map((v) => v.toFixed(2)).join(" ")}`).join("") + (close ? "Z" : "");
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function Intro({ onDone }: { onDone: () => void }) {
  const geo = useStore((s) => s.data?.geo);
  const group = useRef<SVGGElement>(null);
  const detail = useRef<SVGGElement>(null);
  const country = useRef<SVGGElement>(null);
  const marker = useRef<SVGGElement>(null);
  const captions = useRef<SVGGElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [phase, setPhase] = useState(0); // 0 country, 1 Al Ain, 2 zooming, 3 arrived

  const countryPaths = useMemo(() => (uae.rings as number[][][]).map((r) => toPath(r)), []);

  // Frame the oasis and the falaj together: focus on the midpoint between the oasis and the mother well.
  const focusLonLat = useMemo<[number, number]>(() => {
    if (!geo) return [AL_AIN[0] + 0.04, AL_AIN[1] - 0.006];
    const [w, s, , n] = geo.oasis.bbox;
    return [(w + geo.network.mother_well[0]) / 2, (s + n) / 2 - 0.004];
  }, [geo]);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now() - (reduced ? T_HOLD : 0);
    let raf = 0;
    let last = -1;
    const [fx, fy] = project(focusLonLat);
    const [ax, ay] = project(AL_AIN);

    const frame = (now: number) => {
      const t = now - start;
      const z = ease(clamp01((t - T_ZOOM) / D_ZOOM));
      const s = Math.exp(Math.log(ZOOM) * z);
      // keep the focus point on a straight screen path while the scale grows exponentially
      const k = (1 - 1 / s) / (1 - 1 / ZOOM);
      const cx = fx + (W / 2 - fx) * k;
      const cy = fy + (H / 2 - fy) * k;
      group.current?.setAttribute("transform", `translate(${cx.toFixed(3)} ${cy.toFixed(3)}) scale(${s.toFixed(4)}) translate(${-fx} ${-fy})`);

      const near = clamp01((Math.log(s) - Math.log(9)) / (Math.log(34) - Math.log(9)));
      if (detail.current) detail.current.style.opacity = String(near);
      if (country.current) country.current.style.opacity = String(1 - 0.72 * near);
      if (captions.current) captions.current.style.opacity = String(clamp01((t - T_HOLD + 500) / 500));
      if (marker.current) {
        const appear = clamp01((t - T_MARK) / 500);
        marker.current.style.opacity = String(appear * (1 - near));
        const pulse = ((t - T_MARK) / 1400) % 1;
        const dot = marker.current.children[0] as SVGCircleElement;
        const ring = marker.current.children[1] as SVGCircleElement;
        dot.setAttribute("r", String(4.2 / s));
        ring.setAttribute("r", String((5 + 20 * pulse) / s));
        ring.setAttribute("opacity", String(0.8 * (1 - pulse)));
        dot.setAttribute("cx", String(ax));
        dot.setAttribute("cy", String(ay));
        ring.setAttribute("cx", String(ax));
        ring.setAttribute("cy", String(ay));
      }

      const p = t < T_MARK ? 0 : t < T_ZOOM ? 1 : t < T_HOLD ? 2 : 3;
      if (p !== last) {
        last = p;
        setPhase(p);
      }
      if (root.current) root.current.style.opacity = String(1 - clamp01((t - T_FADE) / D_FADE));
      if (t >= T_FADE) useStore.getState().introArrive(); // start the twin's camera descent as the map dissolves
      if (t >= T_FADE + D_FADE) finish();
      else raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const key = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLonLat]);

  // where things end up on screen once the zoom has finished (viewBox units), for the closing captions
  const finalPos = (lonLat: number[]): [number, number] => {
    const [fx, fy] = project(focusLonLat);
    const [x, y] = project(lonLat);
    return [W / 2 + ZOOM * (x - fx), H / 2 + ZOOM * (y - fy)];
  };

  const graticule = useMemo(() => {
    const lines: string[] = [];
    for (let lon = 51; lon <= 57; lon++) lines.push(`M${project([lon, 22]).join(" ")}L${project([lon, 26.6]).join(" ")}`);
    for (let lat = 22; lat <= 26.5; lat += 1) lines.push(`M${project([50.6, lat]).join(" ")}L${project([57.2, lat]).join(" ")}`);
    return lines.join("");
  }, []);

  const captionsReady = phase >= 2 && geo;
  const crumbs = ["United Arab Emirates", "Al Ain, Abu Dhabi Emirate", "Al Ain Oasis falaj system"];
  const crumb = Math.min(2, phase === 3 ? 2 : phase);

  return (
    <div ref={root} className="fixed inset-0 z-[100] bg-bg" role="dialog" aria-label="FALAJLINE introduction">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full">
        <defs>
          <radialGradient id="intro-glow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#0e3f47" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#07090a" stopOpacity="0" />
          </radialGradient>
          <style>{`
            .intro-draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: intro-draw 2.3s cubic-bezier(.6,.05,.2,1) .15s forwards; }
            .intro-fill { opacity: 0; animation: intro-in 1.2s ease-out 1.5s forwards; }
            .intro-grid { opacity: 0; animation: intro-in 1.6s ease-out .2s forwards; }
            @keyframes intro-draw { to { stroke-dashoffset: 0; } }
            @keyframes intro-in { to { opacity: 1; } }
            @media (prefers-reduced-motion: reduce) { .intro-draw, .intro-fill, .intro-grid { animation-duration: .01s; animation-delay: 0s; } }
          `}</style>
        </defs>
        <rect width={W} height={H} fill="url(#intro-glow)" />

        <g ref={group}>
          <path d={graticule} className="intro-grid" fill="none" stroke="#1c2223" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <g ref={country}>
            {countryPaths.map((d, i) => (
              <g key={i}>
                <path d={d} className="intro-fill" fill="#cdb88c" fillOpacity={0.05} stroke="none" />
                <path d={d} pathLength={1} className="intro-draw" fill="none" stroke="#cdb88c" strokeWidth={i === 0 ? 1.7 : 1.1} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </g>
            ))}
          </g>

          {/* Al Ain Oasis and its falaj, revealed as the view closes in */}
          <g ref={detail} style={{ opacity: 0 }}>
            {geo && (
              <>
                {geo.zones.map((z) => (
                  <path key={z.id} d={toPath(z.polygon)} fill="#36c3b5" fillOpacity={0.07} stroke="#36c3b5" strokeOpacity={0.35} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
                ))}
                <path d={toPath(geo.oasis.outline)} fill="none" stroke="#cdb88c" strokeWidth={1.8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                <path d={toPath(geo.network.tunnel, false)} fill="none" stroke="#4ea9d8" strokeWidth={1.6} strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
                <path d={toPath(geo.network.main_channel, false)} fill="none" stroke="#7fe3d8" strokeWidth={2.4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                {Object.values(geo.network.branches).map((b, i) => (
                  <path key={i} d={toPath(b, false)} fill="none" stroke="#7fe3d8" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                ))}
                {[...geo.network.access_shafts, geo.network.mother_well].map((p, i, all) => {
                  const [x, y] = project(p);
                  const well = i === all.length - 1;
                  return <circle key={i} cx={x} cy={y} r={(well ? 5 : 2.4) / ZOOM} fill={well ? "#4ea9d8" : "#07090a"} stroke="#4ea9d8" strokeWidth={1.3} vectorEffect="non-scaling-stroke" />;
                })}
              </>
            )}
          </g>

          <g ref={marker} style={{ opacity: 0 }}>
            <circle fill="#36c3b5" />
            <circle fill="none" stroke="#36c3b5" strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          </g>
        </g>

        {/* closing captions, placed where each feature comes to rest */}
        <g ref={captions} style={{ opacity: 0 }} fontFamily="var(--font-geist-mono)" fontSize={9.5} letterSpacing={0.8}>
          {captionsReady &&
            (() => {
              const [w, , , n] = geo.oasis.bbox;
              const oasis = finalPos([w + 0.002, n]);
              const well = finalPos(geo.network.mother_well);
              const mid = finalPos([(geo.network.sharia[0] + geo.network.mother_well[0]) / 2, (geo.network.sharia[1] + geo.network.mother_well[1]) / 2]);
              return (
                <>
                  <text x={oasis[0]} y={oasis[1] - 14} fill="#cdb88c">AL AIN OASIS · {geo.oasis.area_ha.toFixed(0)} HA · OPENSTREETMAP OUTLINE</text>
                  <text x={mid[0] + 40} y={mid[1] - 34} fill="#4ea9d8" textAnchor="middle">FALAJ TUNNEL · {geo.tunnel_length_km} KM · CONCEPTUAL ALIGNMENT</text>
                  <text x={well[0]} y={well[1] + 22} fill="#4ea9d8" textAnchor="end">MOTHER WELL · UMM AL-FALAJ</text>
                </>
              );
            })()}
        </g>
      </svg>

      <div className="pointer-events-none absolute left-8 top-7 flex items-center gap-2.5">
        <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden>
          <path d="M1 3h8c3 0 3 8 6 8h6" fill="none" stroke="var(--color-water)" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M1 11h4" stroke="var(--color-sand)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className="font-mono text-[13px] font-medium tracking-[0.3em] text-fg">FALAJLINE</span>
      </div>

      <div className="pointer-events-none absolute bottom-10 left-8 max-w-xl">
        <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em]">
          {crumbs.map((c, i) => (
            <span key={c} className="flex items-center gap-2 transition-colors duration-500" style={{ color: i === crumb ? "var(--color-water)" : i < crumb ? "var(--color-fg-3)" : "var(--color-fg-4)" }}>
              {i > 0 && <span className="text-fg-4">›</span>}
              {c}
            </span>
          ))}
        </div>
        <h1 className="mt-3 text-[30px] font-medium leading-tight tracking-tight text-fg">
          Seeing an oasis run short of water
          <br />
          <span className="text-fg-2">before its farms do.</span>
        </h1>
        <p className="mt-3 max-w-md text-[13px] leading-relaxed text-fg-3">
          Early warning intelligence for the traditional falaj irrigation systems of Al Ain Oasis: live weather, a simulated sensor network and a deterministic 21-day water model.
        </p>
        <div className="num mt-4 text-[11px] text-fg-3 transition-opacity duration-500" style={{ opacity: phase >= 1 ? 1 : 0 }}>
          24.217°N 55.767°E
        </div>
      </div>

      <button
        onClick={finish}
        className="absolute bottom-10 right-8 rounded-[5px] border border-line-2 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-3 transition-colors hover:border-water hover:text-fg"
      >
        Skip intro
      </button>
      <div className="pointer-events-none absolute bottom-4 right-8 font-mono text-[9px] tracking-wide text-fg-4">
        Country outline: Natural Earth · Oasis outline © OpenStreetMap contributors
      </div>
    </div>
  );
}
