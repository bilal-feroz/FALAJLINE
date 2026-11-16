"use client";

import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { ProvTag } from "@/components/ui/primitives";
import { RISK_COLOR, STATUS_COLOR, fmt, fmtAge } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import type { Bundle, EadWells, ScenarioForecast } from "@/lib/types";

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics · Oasis outline © OpenStreetMap contributors · Wells: Environment Agency – Abu Dhabi",
    },
  },
  layers: [
    { id: "ground", type: "background", paint: { "background-color": "#0b0e0f" } },
    { id: "imagery", type: "raster", source: "imagery", paint: { "raster-saturation": -0.45, "raster-brightness-max": 0.62, "raster-contrast": 0.12 } },
  ],
};

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: "FeatureCollection", features });

function zonesFC(data: Bundle, sc: ScenarioForecast, day: number, selected: string | null): FC {
  return fc(
    data.geo.zones.map((z) => {
      const f = sc.zones.find((x) => x.id === z.id)!;
      return {
        type: "Feature",
        properties: { id: z.id, color: RISK_COLOR[f.risk[day]], short: f.ratio.central[day] < sc.required_supply_ratio, selected: selected === z.id },
        geometry: { type: "Polygon", coordinates: [z.polygon] },
      };
    }),
  );
}

function networkFC(data: Bundle, sc: ScenarioForecast, day: number): FC {
  const n = data.geo.network;
  const frac = (v: number, ref: number) => Math.max(0.15, Math.min(1, v / ref));
  const feats: GeoJSON.Feature[] = [
    { type: "Feature", properties: { kind: "tunnel", w: 1 }, geometry: { type: "LineString", coordinates: n.tunnel } },
    { type: "Feature", properties: { kind: "channel", w: frac(sc.main.flow_lps.central[day], sc.main.flow_lps.central[0]) * 4 }, geometry: { type: "LineString", coordinates: n.main_channel } },
  ];
  for (const b of sc.branches) {
    feats.push({ type: "Feature", properties: { kind: "channel", w: frac(b.flow_lps[day], b.flow_lps[0]) * 2.6 }, geometry: { type: "LineString", coordinates: n.branches[b.id] } });
  }
  return fc(feats);
}

function sensorsFC(data: Bundle): FC {
  return fc(
    data.telemetry.sensors.map((s) => ({
      type: "Feature",
      properties: {
        id: s.id,
        color: STATUS_COLOR[s.status],
        html: `<div style="font-family:var(--font-geist-mono);font-size:10px;color:#cdb88c;letter-spacing:.08em">SIMULATED SENSOR</div><div style="margin-top:2px"><b>${s.id}</b> · ${s.label}</div><div style="color:#a4aca9">${s.last_value === null ? "no reading" : `${fmt(s.last_value, s.kind === "level" ? 3 : 1)} ${s.unit}`} · ${s.status} · ${fmtAge(s.age_min)} ago</div>`,
      },
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
    })),
  );
}

type View = "oasis" | "system" | "region";

export default function OasisMap() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const labels = useRef<Map<string, HTMLDivElement>>(new Map());
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("oasis");
  const [wells, setWells] = useState<EadWells | null>(null);
  const selectedZone = selection?.type === "zone" ? selection.id : null;

  // real EAD monitoring-well locations (context only; the public layer has no water levels)
  useEffect(() => {
    let alive = true;
    fetch("/api/geo/ead-wells")
      .then((r) => (r.ok ? r.json() : null))
      .then((w: EadWells | null) => alive && setWells(w ?? { available: false, wells: [], reason: "Request failed" }))
      .catch(() => alive && setWells({ available: false, wells: [], reason: "Request failed" }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const geo = useStore.getState().data!.geo;
    const [w, s, e, n] = geo.oasis.bbox;
    const map = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      bounds: [w - 0.002, s - 0.0015, e + 0.003, n + 0.0015],
      attributionControl: { compact: true },
      maxZoom: 17.5,
      minZoom: 9,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-right");

    // "style.load" fires as soon as the style is ready, so the overlays appear without waiting for imagery tiles
    map.once("style.load", () => {
      const empty = fc([]);
      map.addSource("zones", { type: "geojson", data: empty });
      map.addSource("network", { type: "geojson", data: empty });
      map.addSource("sensors", { type: "geojson", data: empty });
      map.addSource("wells", { type: "geojson", data: empty });
      map.addSource("oasis", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: geo.oasis.outline } } });
      map.addSource("shafts", {
        type: "geojson",
        data: fc(geo.network.access_shafts.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }))),
      });

      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "short"], 0.5, 0.26] } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 3, 1], "line-opacity": 0.9 } });
      map.addLayer({ id: "oasis-line", type: "line", source: "oasis", paint: { "line-color": "#cdb88c", "line-width": 1.4, "line-opacity": 0.85 } });
      map.addLayer({ id: "tunnel", type: "line", source: "network", filter: ["==", ["get", "kind"], "tunnel"], paint: { "line-color": "#4ea9d8", "line-width": 1.6, "line-dasharray": [2, 2.5], "line-opacity": 0.9 } });
      map.addLayer({ id: "channels-glow", type: "line", source: "network", filter: ["==", ["get", "kind"], "channel"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#36c3b5", "line-width": ["*", ["get", "w"], 2.4], "line-opacity": 0.18, "line-blur": 3 } });
      map.addLayer({ id: "channels", type: "line", source: "network", filter: ["==", ["get", "kind"], "channel"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#7fe3d8", "line-width": ["get", "w"] } });
      map.addLayer({ id: "shafts", type: "circle", source: "shafts", paint: { "circle-radius": 2.4, "circle-color": "#0b0e0f", "circle-stroke-color": "#4ea9d8", "circle-stroke-width": 1.2 } });
      map.addLayer({ id: "wells", type: "circle", source: "wells", paint: { "circle-radius": 3.2, "circle-color": "#4ea9d8", "circle-opacity": 0.85, "circle-stroke-color": "#07090a", "circle-stroke-width": 1 } });
      map.addLayer({ id: "sensors", type: "circle", source: "sensors", paint: { "circle-radius": 4.6, "circle-color": ["get", "color"], "circle-stroke-color": "#07090a", "circle-stroke-width": 1.6 } });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, maxWidth: "280px" });
      for (const layer of ["sensors", "wells"]) {
        map.on("mousemove", layer, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "pointer";
          popup.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setHTML(String(f.properties.html)).addTo(map);
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
          popup.remove();
        });
      }
      map.on("click", "zones-fill", (e) => {
        const id = e.features?.[0]?.properties.id;
        if (id) useStore.getState().select({ type: "zone", id: String(id) });
      });
      map.on("mouseenter", "zones-fill", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "zones-fill", () => (map.getCanvas().style.cursor = ""));

      const marker = (lngLat: [number, number], html: string, anchor: maplibregl.PositionAnchor = "bottom") => {
        const node = document.createElement("div");
        node.innerHTML = html;
        new maplibregl.Marker({ element: node, anchor }).setLngLat(lngLat).addTo(map);
        return node;
      };
      const tag = (title: string, sub: string, color: string) =>
        `<div style="pointer-events:none;transform:translateY(-6px);padding:3px 7px;border-radius:4px;background:rgba(7,9,10,.82);border:1px solid ${color}55;white-space:nowrap">
           <div style="font-size:11px;color:#e8eae7">${title}</div>
           <div style="font-family:var(--font-geist-mono);font-size:9px;letter-spacing:.07em;color:${color}">${sub}</div></div>`;
      marker(geo.network.mother_well, tag("Mother well · umm al-falaj", "CONCEPTUAL POSITION", "#4ea9d8"));
      marker(geo.network.sharia, `<div style="margin-left:10px">${tag("Shari'a", "FALAJ SURFACES HERE", "#36c3b5")}</div>`, "left");
      marker([geo.recharge_area.lon, geo.recharge_area.lat], tag("Al Jaww plain recharge area", "UPSTREAM WEATHER SAMPLE · METEOMATICS", "#cdb88c"));
      for (const z of geo.zones) {
        const node = marker([z.centroid.lon, z.centroid.lat], "", "center");
        node.style.pointerEvents = "none";
        labels.current.set(z.id, node);
      }
      setReady(true);
    });

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    const labelStore = labels.current;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      labelStore.clear();
      setReady(false);
    };
  }, []);

  // push simulation state into the map whenever the timeline, scenario or data changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getSource("zones")) return;
    (map.getSource("zones") as GeoJSONSource).setData(zonesFC(data, sc, day, selectedZone));
    (map.getSource("network") as GeoJSONSource).setData(networkFC(data, sc, day));
    (map.getSource("sensors") as GeoJSONSource).setData(sensorsFC(data));
    for (const z of sc.zones) {
      const node = labels.current.get(z.id);
      if (!node) continue;
      const r = z.ratio.central[day];
      const color = RISK_COLOR[z.risk[day]];
      node.innerHTML = `<div style="text-align:center;text-shadow:0 1px 3px #000,0 0 8px #000">
        <div style="font-family:var(--font-geist-mono);font-size:11px;font-weight:600;color:#fff">${z.id}</div>
        <div style="font-family:var(--font-geist-mono);font-size:10px;color:${color}">${(r * 100).toFixed(0)}%</div></div>`;
    }
  }, [data, sc, day, ready, selectedZone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !wells || !map.getSource("wells")) return;
    (map.getSource("wells") as GeoJSONSource).setData(
      fc(
        wells.wells.map((w) => ({
          type: "Feature",
          properties: {
            html: `<div style="font-family:var(--font-geist-mono);font-size:10px;color:#4ea9d8;letter-spacing:.08em">OBSERVED · EAD MONITORING WELL</div><div style="margin-top:2px"><b>${w.id}</b> · measured ${String(w.frequency).toLowerCase()}</div><div style="color:#a4aca9">Location only. The public layer has no water levels.</div>`,
          },
          geometry: { type: "Point", coordinates: [w.lon, w.lat] },
        })),
      ),
    );
  }, [wells, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const geo = data.geo;
    const [w, s, e, n] = geo.oasis.bbox;
    const bounds: Record<View, LngLatBoundsLike> = {
      oasis: [w - 0.002, s - 0.0015, e + 0.003, n + 0.0015],
      system: [w - 0.004, Math.min(s, geo.network.mother_well[1]) - 0.012, geo.network.mother_well[0] + 0.012, n + 0.012],
      region: [w - 0.03, s - 0.06, geo.recharge_area.lon + 0.03, n + 0.06],
    };
    map.fitBounds(bounds[view], { duration: 900, padding: 24 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ready]);

  const views: [View, string][] = [["oasis", "Oasis"], ["system", "Falaj system"], ["region", "Recharge region"]];
  return (
    <div className="relative h-full w-full overflow-hidden rounded-md border border-line bg-[#0b0e0f]">
      <div ref={el} className="h-full w-full" />

      <div className="absolute left-3 top-3 flex items-center gap-2">
        <div className="flex rounded-[5px] border border-line-2 bg-bg/85 p-0.5 backdrop-blur-sm">
          {views.map(([id, label]) => (
            <button key={id} onClick={() => setView(id)} className={`rounded-[3px] px-2.5 py-1 text-[11px] ${view === id ? "bg-panel-3 text-fg" : "text-fg-3 hover:text-fg-2"}`}>
              {label}
            </button>
          ))}
        </div>
        {selectedZone && (
          <button onClick={() => select(null)} className="rounded-[5px] border border-line-2 bg-bg/85 px-2 py-1.5 text-[11px] text-fg-2 backdrop-blur-sm hover:text-fg">
            {selectedZone} selected · clear
          </button>
        )}
      </div>

      <div className="absolute bottom-3 left-3 max-w-[330px] rounded-md border border-line-2 bg-bg/85 px-3 py-2.5 text-[10.5px] text-fg-2 backdrop-blur-sm">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {(["NORMAL", "WATCH", "PREPARE", "ACT"] as const).map((l) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: RISK_COLOR[l] }} />
              <span className="font-mono text-[9.5px] tracking-wide">{l}</span>
            </span>
          ))}
          <span className="text-fg-3">zone label = supply as % of demand</span>
        </div>
        <div className="space-y-1 border-t border-line pt-1.5 leading-snug">
          <div className="flex items-start gap-1.5">
            <ProvTag kind="observed" short />
            <span>Oasis outline (OpenStreetMap, {fmt(data.geo.oasis.area_ha, 1)} ha){wells?.available ? ` · ${wells.wells.length} EAD monitoring wells, locations only` : ""}</span>
          </div>
          {wells && !wells.available && (
            <div className="flex items-start gap-1.5">
              <ProvTag kind="unavailable" short />
              <span>EAD monitoring wells: {wells.reason}</span>
            </div>
          )}
          <div className="flex items-start gap-1.5">
            <ProvTag kind="conceptual" short />
            <span>Zones, falaj alignment, mother well and sensor positions: a representative reconstruction, not a survey.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
