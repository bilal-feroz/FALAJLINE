"use client";

import { useEffect, useState } from "react";
import { fmt, fmtLong } from "@/lib/format";
import { useStore, type Caption } from "@/lib/store";

/**
 * Presentation mode: a scripted walk through the story, driven by the live data. It is also the script
 * for the submission video, so every number in a caption is read from the current forecast.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Step {
  caption: () => Caption;
  run: (alive: () => boolean) => Promise<void>;
}

function steps(): Step[] {
  const st = useStore.getState;
  const data = st().data!;
  const base = data.scenarios.baseline;
  const first = base.system.first_shortfall_day ?? 7;
  const firstZone = base.zones.find((z) => z.shortfall.first_day === first) ?? base.zones[0];
  const head0 = base.source.head_m.central[0];
  const head21 = base.source.head_m.central[21];
  const flow0 = base.main.flow_lps.central[0];
  const flow21 = base.main.flow_lps.central[21];
  const reduced = data.comparison.find((c) => c.id === "reduced_demand");
  const et0 = base.weather_basis.map((b) => b.et0_mm);
  const play = async (from: number, to: number, ms: number, alive: () => boolean) => {
    st().setDay(from);
    for (let d = from; d <= to && alive(); d++) {
      st().setDay(d);
      await sleep(ms);
    }
  };
  const actWarning = data.warnings.warnings.find((w) => w.level === "ACT" && w.type === "supply_shortfall") ?? data.warnings.warnings[0];

  return [
    {
      caption: () => ({ kicker: "01 · Live data", title: "Live weather sets the water demand.", body: `Meteomatics forecasts for Al Ain feed the crop model: reference evapotranspiration ${fmt(et0[0], 1)} mm today, ${fmt(et0[21], 1)} mm in three weeks.` }),
      run: async () => {
        st().setFaults(null);
        st().setScenario("baseline");
        st().setMode("overview");
        st().select(null, false);
        st().setDay(0);
        st().setTour({ highlight: "weather" });
        st().flyTo("system");
        await sleep(7000);
      },
    },
    {
      caption: () => ({ kicker: "02 · The source", title: "The mother well is receding.", body: `Head above the tunnel falls from ${fmt(head0, 2)} m to ${fmt(head21, 2)} m over 21 days; flow at the shari'a from ${fmt(flow0, 0)} to ${fmt(flow21, 0)} L/s. The wet stretch of tunnel shrinks with it.` }),
      run: async (alive) => {
        st().setTour({ highlight: null });
        st().select({ type: "source", id: "MW-1" });
        await sleep(2400);
        await play(0, 21, 300, alive);
        await sleep(900);
      },
    },
    {
      caption: () => ({ kicker: "03 · Where it hits first", title: `${firstZone.name.replace(" · ", ", ")} runs short on ${fmtLong(base.dates[first])}.`, body: `${first} days before it happens. Each sight-glass is a farm outlet: water level against the ring of full demand.` }),
      run: async (alive) => {
        st().setDay(0);
        st().select({ type: "zone", id: firstZone.id });
        await sleep(2200);
        await play(0, Math.min(21, first + 1), 420, alive);
        await sleep(1200);
      },
    },
    {
      caption: () => ({ kicker: "04 · What to do", title: "Warnings say who, when and what to do.", body: "Every recommended action is tested in the model before it is offered, and the message to farm operators is ready in English and Arabic." }),
      run: async () => {
        st().setDay(0);
        st().setAlertId(actWarning?.id ?? null);
        st().setMode("alerts");
        await sleep(8500);
      },
    },
    {
      caption: () => ({ kicker: "05 · Test the fix", title: reduced?.days_gained ? `Cut demand 15% and gain ${reduced.days_gained} days.` : "Test a response before acting.", body: "Scenarios are re-run through the same model on the server, not drawn by hand." }),
      run: async () => {
        st().setForecastTarget("system");
        st().setMode("forecast");
        await sleep(2200);
        st().setScenario("reduced_demand");
        await sleep(5600);
      },
    },
    {
      caption: () => ({ kicker: "06 · Trust", title: "A sensor fails. The warning holds.", body: "The source is re-estimated from the main flume, confidence drops with an itemised reason, and the level stays where the evidence puts it." }),
      run: async () => {
        st().setScenario("baseline");
        st().setMode("overview");
        st().select(null, false);
        st().flyTo("oasis");
        st().setTour({ highlight: "health" });
        await sleep(1600);
        st().setFaults({ "S-GW-01": "offline", "S-OUT-Z2": "offline", "S-FL-B": "stale" });
        await sleep(6400);
      },
    },
    {
      caption: () => ({ kicker: "Falajline", title: "See the shortage before the farms do.", body: "Live Meteomatics weather · real Sentinel-2 canopy · a deterministic water model for Al Ain's aflaj." }),
      run: async () => {
        st().setTour({ highlight: null });
        st().setFaults(null);
        st().flyTo("system");
        await sleep(6000);
      },
    },
  ];
}

export function Tour() {
  const tour = useStore((s) => s.tour);
  const setTour = useStore((s) => s.setTour);
  const [total, setTotal] = useState(7);

  useEffect(() => {
    if (!tour.running) return;
    let alive = true;
    const isAlive = () => alive && useStore.getState().tour.running;
    (async () => {
      const list = steps();
      setTotal(list.length);
      for (let i = 0; i < list.length && isAlive(); i++) {
        setTour({ step: i, caption: list[i].caption() });
        await list[i].run(isAlive);
      }
      if (alive) {
        setTour({ running: false, caption: null, highlight: null, step: 0 });
        useStore.getState().setPlaying(false);
      }
    })();
    return () => {
      alive = false;
      useStore.getState().setPlaying(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour.running]);

  if (!tour.running || !tour.caption) return null;
  const c = tour.caption;
  return (
    <div className="pointer-events-none absolute left-1/2 top-[76px] z-40 w-[820px] -translate-x-1/2">
      <div key={tour.step} className="glass px-7 py-5 rise">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11.5px] uppercase tracking-[0.22em] text-beige">{c.kicker}</span>
          <div className="flex gap-1.5">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`h-1 rounded-full transition-all ${i === tour.step ? "w-6 bg-ink" : i < tour.step ? "w-2 bg-ink/60" : "w-2 bg-ink/20"}`} />
            ))}
          </div>
        </div>
        <h2 className="display mt-2.5 text-[34px] leading-[1.05] text-ink">{c.title}</h2>
        {c.body && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{c.body}</p>}
      </div>
    </div>
  );
}
