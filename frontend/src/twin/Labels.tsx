"use client";

import { useFrame } from "@react-three/fiber";
import { useCallback, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { RISK_COLOR, fmt } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import type { Dem } from "./dem";
import { frame } from "./frame";
import { CITIES, toXZ } from "./geo";
import { GAUGE_H } from "./Gauges";
import type { Net } from "./net";
import { screen } from "./screen";

/**
 * Text is plain DOM laid over the canvas: crisp at any zoom and styled like the rest of the interface.
 * Each label registers a world anchor and a visibility rule; the projector moves it every frame.
 */
interface Anchor {
  pos: () => [number, number, number];
  vis: () => number;
}
const registry = new Map<HTMLElement, Anchor>();

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function LabelProjector() {
  const v = useMemo(() => new THREE.Vector3(), []);
  const w = useMemo(() => new THREE.Vector3(), []);
  // runs after the frame is rendered, so labels sit exactly on what is on screen
  useFrame(({ camera, size }) => {
    screen.project = (x, y, z) => {
      w.set(x, y, z).project(camera);
      if (w.z < -1 || w.z > 1) return null;
      return [(w.x * 0.5 + 0.5) * size.width, (-w.y * 0.5 + 0.5) * size.height];
    };
    registry.forEach((a, el) => {
      const [x, y, z] = a.pos();
      v.set(x, y, z).project(camera);
      const on = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      const py = (-v.y * 0.5 + 0.5) * size.height;
      // keep labels out from under the top bar and the timeline
      const film = useStore.getState().film;
      const safe = Math.min(1, Math.max(0, (py - (film ? 24 : 84)) / 36)) * Math.min(1, Math.max(0, (size.height - (film ? 24 : 118) - py) / 36));
      const o = on ? a.vis() * safe : 0;
      el.style.opacity = o.toFixed(3);
      el.style.visibility = o < 0.01 ? "hidden" : "visible";
      if (o >= 0.01) el.style.transform = `translate3d(${((v.x * 0.5 + 0.5) * size.width).toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
    });
  }, 2);
  return null;
}

function Label({ anchor, children, align = "bottom" }: { anchor: Anchor; children: ReactNode; align?: "bottom" | "left" | "center" }) {
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    registry.set(el, { pos: () => anchorRef.current.pos(), vis: () => anchorRef.current.vis() });
    return () => {
      registry.delete(el);
    };
  }, []);
  const shift = align === "bottom" ? "translate(-50%, calc(-100% - 8px))" : align === "left" ? "translate(-4px, -50%)" : "translate(-50%, -50%)";
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 opacity-0 will-change-transform" style={{ visibility: "hidden" }}>
      <div style={{ transform: shift }}>{children}</div>
    </div>
  );
}

/** A place name on the map: small caps in ink, with a hairline leader down to the point. */
function Place({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="glass-soft whitespace-nowrap rounded-full px-2.5 py-[3px] text-center">
        <span className="text-[12.5px] font-medium leading-none text-ink">{title}</span>
        {sub && <span className="ml-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.14em] text-ink-3">{sub}</span>}
      </div>
      <span className="h-3 w-px bg-ink/50" />
    </div>
  );
}

export function LabelLayer({ net, dem }: { net: Net; dem: Dem }) {
  const sc = useScenario();
  const day = useStore((s) => s.day);
  const layers = useStore((s) => s.layers);
  const selection = useStore((s) => s.selection);
  const film = useStore((s) => s.film);
  const near = (max: number) => () => 1 - smooth(max * 0.7, max, frame.altitude);
  const far = (min: number) => () => smooth(min, min * 1.4, frame.altitude);
  const built = (from: number) => () => smooth(from, from + 0.15, frame.reveal);
  const h = (x: number, z: number) => dem.heightAt(x, z);
  const tunnelMid = useMemo(() => {
    const i = Math.floor(net.shafts.length * 0.55);
    return net.shafts[i];
  }, [net]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {/* the regional map of the opening sequence (a recording sets its own type over it) */}
      {!film && CITIES.map((c) => {
        const [x, z] = toXZ(c.lon, c.lat);
        return (
          <Label key={c.name} align="left" anchor={{ pos: () => [x, -260, z], vis: () => frame.region * smooth(40000, 90000, frame.altitude) }}>
            <span className="flex items-center gap-2">
              <span className={`h-[7px] w-[7px] rounded-full border ${c.name === "Al Ain" ? "border-cream bg-cream" : "border-cream/70"}`} />
              <span className={`font-mono text-[11.5px] uppercase tracking-[0.2em] ${c.name === "Al Ain" ? "text-cream" : "text-cream-3"}`}>{c.name}</span>
            </span>
          </Label>
        );
      })}

      <Label anchor={{ pos: () => [net.well[0], h(...net.well) + 250, net.well[1]], vis: () => built(0)() * near(30000)() }}>
        <Place title="Mother well" sub="source" />
      </Label>
      <Label anchor={{ pos: () => [tunnelMid[0], h(...tunnelMid) + 20, tunnelMid[1]], vis: () => built(0.1)() * near(24000)() * far(2400)() }}>
        <Place title="Falaj tunnel" sub="7 km underground" />
      </Label>
      <Label anchor={{ pos: () => [net.sharia[0], h(...net.sharia) + 22, net.sharia[1]], vis: () => built(0.3)() * near(2300)() }}>
        <Place title="Shari'a" sub="water surfaces" />
      </Label>
      <Label anchor={{ pos: () => [net.divider[0], h(...net.divider) + 20, net.divider[1]], vis: () => built(0.4)() * near(1500)() }}>
        <Place title="Divider" sub="timed shares" />
      </Label>

      {sc &&
        net.zones.map((z, i) => {
          const zf = sc.zones.find((q) => q.id === z.id)!;
          const ratio = zf.ratio.central[day];
          const color = RISK_COLOR[zf.risk[day]];
          const active = selection?.type === "zone" && selection.id === z.id;
          return (
            <Label key={z.id} anchor={{ pos: () => [z.centroid[0], h(...z.centroid) + GAUGE_H + 12, z.centroid[1]], vis: () => smooth(0.62 + i * 0.04, 0.8 + i * 0.04, frame.reveal) * near(9000)() * (layers.gauges ? 1 : 0) }}>
              <div className={`flex items-center gap-1.5 whitespace-nowrap rounded-full py-[3px] pl-1.5 pr-2.5 ${active ? "glass-ink" : "glass-soft"}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 0 2px ${active ? "rgba(246,239,225,0.15)" : "rgba(255,255,255,0.6)"}` }} />
                <span className={`font-mono text-[12px] font-medium ${active ? "text-cream" : "text-ink"}`}>{z.id}</span>
                <span className={`font-mono text-[12px] ${active ? "text-cream-2" : "text-ink-2"}`}>{fmt(ratio * 100, 0)}%</span>
              </div>
            </Label>
          );
        })}
    </div>
  );
}
