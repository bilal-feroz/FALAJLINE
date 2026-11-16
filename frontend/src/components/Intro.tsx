"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/format";
import { useStore } from "@/lib/store";
import { INTRO } from "@/twin/CameraRig";
import { frame } from "@/twin/frame";
import { RAMP_CSS } from "@/twin/Region";
import { Mark } from "./TopBar";

const BEATS = [
  { from: 0.5, to: 5.4, kicker: "United Arab Emirates · live", title: "Today, the desert pulls water from everything.", body: "Evaporative demand across the UAE, from the Meteomatics forecast." },
  { from: 5.8, to: 9.6, kicker: "Al Ain · Abu Dhabi Emirate", title: "An oasis fed by water that flows underground.", body: "Aflaj tunnels carry groundwater from the mountains to more than 147,000 date palms." },
  { from: 9.9, to: 12.2, kicker: "Falajline", title: "See the shortage before the farms do.", body: "A digital twin of one falaj, its source, its channels and the six groves it feeds." },
];

export function Intro() {
  const intro = useStore((s) => s.intro);
  const status = useStore((s) => s.status);
  const field = useStore((s) => s.field);
  const assets = useStore((s) => s.assets);
  const [beat, setBeat] = useState(-1);
  const [t, setT] = useState(0);

  const skip = () => {
    frame.introT = INTRO.END - 0.05;
  };

  useEffect(() => {
    if (intro !== "playing") return;
    let raf = 0;
    const loop = () => {
      const now = frame.introT;
      const b = BEATS.findIndex((x) => now >= x.from && now < x.to);
      setBeat((prev) => (prev === b ? prev : b));
      setT(Math.round(now * 10) / 10);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const key = (e: KeyboardEvent) => e.key === "Escape" && skip();
    window.addEventListener("keydown", key);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", key);
    };
  }, [intro]);

  if (intro === "done") return null;

  if (intro === "pending") {
    const steps = [status === "ready", assets.dem, assets.far, field !== null];
    const done = steps.filter(Boolean).length;
    return (
      <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 fade">
        <div className="flex items-center gap-3 text-cream">
          <Mark size={30} />
          <span className="font-mono text-[16px] font-medium tracking-[0.4em] text-cream">FALAJLINE</span>
        </div>
        <div className="h-px w-56 overflow-hidden bg-cream/10">
          <div className="h-px bg-cream transition-all duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <div className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-cream-3">
          {status === "error" ? "The FALAJLINE backend is not answering · retrying" : !steps[0] ? "Reading Meteomatics and the 21-day forecast" : !assets.dem ? "Loading terrain" : !assets.far ? "Loading satellite imagery" : "Loading the UAE weather field"}
        </div>
      </div>
    );
  }

  // without live Meteomatics access there is no evapotranspiration field on the map: say so, claim nothing
  const offline = { ...BEATS[0], kicker: "United Arab Emirates", body: "Live evaporative demand from Meteomatics is drawn here when the weather feed is connected." };
  const b = beat >= 0 ? (beat === 0 && !field?.available ? offline : BEATS[beat]) : null;
  const showLegend = t > 0.6 && t < 5.4 && field?.available;
  const uiAt = t >= INTRO.UI_AT;
  // a soft scrim keeps the titles legible as the camera comes down into the bright desert
  const scrim = Math.min(1, Math.max(0, (t - 5.2) / 1.6)) * (1 - Math.min(1, Math.max(0, (t - INTRO.UI_AT) / 1.4)));
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      <div className="absolute inset-0" style={{ opacity: scrim, background: "radial-gradient(120% 90% at 0% 100%, rgba(14,11,7,0.78) 0%, rgba(14,11,7,0.45) 32%, rgba(14,11,7,0) 62%)" }} />
      <div className="absolute left-10 top-9 flex items-center gap-3 text-cream fade">
        <Mark size={24} />
        <span className="font-mono text-[14px] font-medium tracking-[0.36em] text-cream">FALAJLINE</span>
      </div>

      {b && (
        <div key={beat} className="absolute bottom-24 left-10 max-w-[640px] rise">
          <div className="font-mono text-[12px] uppercase tracking-[0.24em] text-beige">{b.kicker}</div>
          <h1 className="display mt-4 text-[64px] leading-[0.98] text-cream">{b.title}</h1>
          <p className="mt-5 max-w-[460px] text-[16px] leading-relaxed text-cream-2">{b.body}</p>
        </div>
      )}

      {showLegend && field && (
        <div className="absolute right-10 top-10 w-[260px] fade">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream-3">Reference evapotranspiration · today</div>
          <div className="mt-3 h-2 rounded-full" style={{ background: RAMP_CSS }} />
          <div className="num mt-1.5 flex justify-between text-[12px] text-cream-2">
            <span>{fmt(field.min, 1)} mm</span>
            <span>{fmt(field.max, 1)} mm/day</span>
          </div>
          <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-cream-4">Meteomatics · 0.05° grid · {field.lats.length * field.lons.length} points</div>
        </div>
      )}

      <div className={`pointer-events-auto absolute bottom-9 right-10 transition-opacity duration-500 ${uiAt ? "opacity-0" : "opacity-100"}`}>
        <button onClick={skip} className="glass-ink rounded-full px-4 py-2 font-mono text-[11.5px] uppercase tracking-[0.2em] text-cream-2 hover:text-cream">
          Skip
        </button>
      </div>
      <div className="absolute bottom-3 right-10 font-mono text-[10px] uppercase tracking-[0.14em] text-cream-4">
        Natural Earth · Meteomatics · Sentinel-2 cloudless by EOX · imagery © Esri, Maxar, Earthstar Geographics · SRTM
      </div>
    </div>
  );
}
