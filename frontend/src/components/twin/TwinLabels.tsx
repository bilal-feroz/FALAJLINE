"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { RISK_COLOR, fmt } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import { anim } from "./anim";
import { DIVIDER, SHAFT_XS, SHARIA_X, WELL_X, Z1, ZONES, ground, tunnelInvert, waterTable } from "./layout";

type Getter = () => [number, number, number];

/**
 * Labels are plain DOM elements laid over the canvas. The scene projects each anchor to screen space every
 * frame (see LabelProjector in TwinScene) and moves the element, which keeps the text crisp at any zoom.
 */
export const labelTargets = new Map<HTMLElement, Getter>();

function Label({ at, children }: { at: Getter; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    labelTargets.set(el, at);
    return () => {
      labelTargets.delete(el);
    };
  }, [at]);
  return (
    <div ref={ref} className="absolute left-0 top-0 opacity-0 will-change-transform">
      {children}
    </div>
  );
}

function Tag({ title, sub, color = "#a4aca9", border = "var(--color-line-2)" }: { title: ReactNode; sub?: ReactNode; color?: string; border?: string }) {
  return (
    <div className="whitespace-nowrap rounded-[4px] border bg-bg/80 px-1.5 py-0.5 text-center" style={{ borderColor: border }}>
      <div className="text-[10.5px] leading-tight text-fg">{title}</div>
      {sub && (
        <div className="font-mono text-[8.5px] leading-tight tracking-[0.06em]" style={{ color }}>
          {sub}
        </div>
      )}
    </div>
  );
}

const AT_WELL: Getter = () => [WELL_X, ground(WELL_X, 0) + 3.4, 0];
const AT_SHAFTS: Getter = () => [SHAFT_XS[3], ground(SHAFT_XS[3], 0) + 2.6, 0];
const AT_SHARIA: Getter = () => [SHARIA_X, 3.4, 0];
const AT_DIVIDER: Getter = () => [DIVIDER.x, 2.4, DIVIDER.z];
const AT_TUNNEL: Getter = () => [-24, tunnelInvert(-24) - 1.9, 0.6];
const AT_AQUIFER: Getter = () => [-38, -10, Z1 * 0.62];
const AT_WATER_TABLE: Getter = () => [-67, waterTable(-67, anim.head) + 0.3, Z1];
const AT_ZONE: Getter[] = ZONES.map((z) => () => [z.cx, 5.4, z.cz]);

export function TwinLabels({ underground, surface }: { underground: boolean; surface: boolean }) {
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <Label at={AT_WELL}>
        <Tag title="Mother well" sub="UMM AL-FALAJ" color="#4ea9d8" />
      </Label>
      <Label at={AT_SHAFTS}>
        <Tag title="Access shafts" sub="THAQBA" />
      </Label>
      {surface && (
        <>
          <Label at={AT_SHARIA}>
            <Tag title="Shari'a" sub="FALAJ SURFACES" color="#36c3b5" />
          </Label>
          <Label at={AT_DIVIDER}>
            <Tag title="Divider" sub="TIMED SHARES" />
          </Label>
          {ZONES.map((layout, i) => {
            const z = sc.zones.find((x) => x.id === layout.id)!;
            const color = RISK_COLOR[z.risk[day]];
            return (
              <Label key={layout.id} at={AT_ZONE[i]}>
                <div className="whitespace-nowrap rounded-[4px] border bg-bg/80 px-1.5 py-0.5" style={{ borderColor: `${color}88` }}>
                  <span className="font-mono text-[11px] font-medium text-fg">{layout.id}</span>
                  <span className="ml-1.5 font-mono text-[11px]" style={{ color }}>
                    {fmt(z.ratio.central[day] * 100, 0)}%
                  </span>
                </div>
              </Label>
            );
          })}
        </>
      )}
      {underground && (
        <>
          <Label at={AT_TUNNEL}>
            <Tag title="Falaj tunnel" sub="7 KM · LENGTH COMPRESSED" />
          </Label>
          <Label at={AT_AQUIFER}>
            <Tag title="Groundwater body" sub="CONCEPTUAL" color="#4ea9d8" />
          </Label>
          <Label at={AT_WATER_TABLE}>
            <Tag title="Water table" sub={`${fmt(sc.source.head_m.central[day], 2)} M ABOVE INVERT`} color="#36c3b5" border="color-mix(in srgb, var(--color-water) 45%, transparent)" />
          </Label>
        </>
      )}
    </div>
  );
}
