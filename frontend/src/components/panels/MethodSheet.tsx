"use client";

import type { ReactNode } from "react";
import { fmt, fmtDay, fmtGst } from "@/lib/format";
import { useStore } from "@/lib/store";
import { Eyebrow, Prov } from "../ui";

function Item({ prov, title, children }: { prov: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-2.5">
      <div className="w-14 shrink-0 pt-0.5">
        <Prov kind={prov} />
      </div>
      <div className="min-w-0">
        <div className="text-[14.5px] text-ink">{title}</div>
        <div className="mt-0.5 text-[13.5px] leading-snug text-ink-3">{children}</div>
      </div>
    </li>
  );
}

export function MethodSheet() {
  const open = useStore((s) => s.methodOpen);
  const setOpen = useStore((s) => s.setMethodOpen);
  const data = useStore((s) => s.data);
  if (!open || !data) return null;
  const w = data.weather;
  const sat = data.telemetry.satellite;
  const valid = sat.passes.filter((p) => p.status === "valid");
  const p = data.params;
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-cream/55 backdrop-blur-[2px] fade" onClick={() => setOpen(false)}>
      <div className="glass flex max-h-[84vh] w-[880px] flex-col overflow-hidden rise" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-8 pb-5 pt-7">
          <div>
            <Eyebrow>Data and method</Eyebrow>
            <h2 className="display mt-2 text-[38px] text-ink">What is real, what is simulated, what is modelled.</h2>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-ink-3 hover:bg-ink/10 hover:text-ink">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-8 overflow-y-auto border-t hairline px-8 pb-8 pt-5">
          <div>
            <Eyebrow>Inputs</Eyebrow>
            <ul className="mt-1 divide-y divide-ink/[0.06]">
              <Item prov={w.mode === "live" ? "live" : "simulated"} title="Weather · Meteomatics API">
                {w.parameters.filter((x) => x.status === "ok").length} parameters for the oasis and the Al Jaww recharge area, hourly and daily, 7 days back and 21 ahead: temperature, humidity, wind speed and direction, gusts, radiation, cloud, rain and its probability, soil moisture, evaporation and evapotranspiration. Plus a year of rainfall and today&apos;s evaporative-demand grid over the UAE. Retrieved {fmtGst(w.retrieved_at, true)} GST.
              </Item>
              <Item prov="observed" title="Vegetation · Copernicus Sentinel-2 L2A">
                Per-zone NDVI from {sat.passes.length} passes; cloud, shadow and cirrus removed with the scene classification, cloudy passes shown as unavailable. Latest clear pass {valid.length ? fmtDay(valid[valid.length - 1].time) : "—"}. Canopy condition only: never a groundwater measure.
              </Item>
              <Item prov="observed" title="Geography">
                Oasis outline from OpenStreetMap ({fmt(data.geo.oasis.area_ha, 0)} ha). Terrain from SRTM-derived AWS terrain tiles; imagery © Esri, Maxar, Earthstar Geographics. Groundwater monitoring-well locations from the Environment Agency – Abu Dhabi (no levels are public).
              </Item>
              <Item prov="simulated" title="Falaj sensor network">
                No live falaj telemetry is connected. Eleven sensors are synthesised from a hidden scenario run through the same hydraulics, with noise, gaps, a frozen-sensor mode and one bad reading. Health is detected from the data, not read from labels.
              </Item>
              <Item prov="conceptual" title="Network and zones">
                A representative falaj sized from documented Al Ain figures (7 km tunnel, mother well about 20 m deep). Zone boundaries, alignment and sensor positions are illustrative, not a survey of protected heritage.
              </Item>
            </ul>
          </div>
          <div>
            <Eyebrow>Model</Eyebrow>
            <ul className="mt-1 divide-y divide-ink/[0.06]">
              <Item prov="modelled" title="Water system">
                Groundwater source → tunnel → main channel → three branches → six zones. The source recedes as a linear reservoir ({p.source.conductance_lps_per_m} L/s per metre of head); flow is routed with seepage and capacity limits and the water balance closes to rounding error. Demand is FAO-56 crop evapotranspiration of date palms over a {p.demand.rotation_days}-day rotation.
              </Item>
              <Item prov="modelled" title="Forecast and uncertainty">
                21 days, {data.scenarios.baseline.ensemble_members} deterministic runs that vary storage, conductance, seepage, demand, the starting state and a weather error that grows with lead time. The band shows those assumptions, not a validated error.
              </Item>
              <Item prov="modelled" title="Warnings">
                Watch, Prepare, Act from the share of runs short within 21, 14 and 7 days, or the best estimate itself. A level is issued after two consecutive daily evaluations unless two sensors corroborate; losing a sensor never lowers a warning.
              </Item>
              <Item prov="modelled" title="Confidence">
                A data-quality index with itemised reasons, starting from a ceiling of 75 because the model is not calibrated against measured falaj discharge. Not a probability.
              </Item>
              <Item prov="unavailable" title="Limits">
                Telemetry is simulated; the model is uncalibrated; pumped-well and desalinated supplements that sustain Al Ain&apos;s aflaj today are not modelled. SMS delivery is simulated.
              </Item>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
