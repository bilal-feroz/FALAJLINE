"use client";

import type { ReactNode } from "react";
import { GRADE_COLOR, RISK_COLOR } from "@/lib/format";
import type { Grade, Provenance, RiskLevel } from "@/lib/types";

const PROVENANCE: Record<string, { text: string; title: string; cls: string }> = {
  observed: { text: "OBSERVED", title: "Real-world data from an external provider", cls: "border-water-2/50 text-water-2" },
  simulated: { text: "SIMULATED", title: "Synthetic stand-in for field data that is not connected", cls: "border-sand/50 text-sand border-dashed" },
  modelled: { text: "MODELLED", title: "Computed by the FALAJLINE model", cls: "border-fg-3/60 text-fg-2" },
  unavailable: { text: "UNAVAILABLE", title: "Missing: shown as missing, never replaced by a number", cls: "border-act/50 text-act/90 hatch" },
  conceptual: { text: "CONCEPTUAL", title: "Illustrative engineering reconstruction, not a survey", cls: "border-earth/70 text-earth border-dashed" },
  representative: { text: "REPRESENTATIVE", title: "A representative location, not a surveyed boundary", cls: "border-earth/70 text-earth border-dashed" },
};

/** Small tag stating where a value comes from. Used next to every reading in the interface. */
export function ProvTag({ kind, short = false, className = "" }: { kind: Provenance | string; short?: boolean; className?: string }) {
  const p = PROVENANCE[kind] ?? PROVENANCE.modelled;
  return (
    <span
      title={p.title}
      className={`inline-flex shrink-0 items-center rounded-[3px] border px-1 font-mono text-[9px] leading-[14px] tracking-[0.08em] ${p.cls} ${className}`}
    >
      {short ? p.text.slice(0, 3) : p.text}
    </span>
  );
}

export function RiskChip({ level, size = "sm", solid = false }: { level: RiskLevel; size?: "sm" | "md" | "lg"; solid?: boolean }) {
  const color = RISK_COLOR[level];
  const pad = size === "lg" ? "px-2.5 py-1 text-[13px]" : size === "md" ? "px-2 py-0.5 text-[11px]" : "px-1.5 py-px text-[10px]";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border font-mono font-medium tracking-[0.08em] ${pad}`}
      style={{
        color: solid ? "#07090a" : color,
        background: solid ? color : `color-mix(in srgb, ${color} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} ${solid ? 100 : 45}%, transparent)`,
      }}
    >
      {!solid && <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />}
      {level}
    </span>
  );
}

export function GradeChip({ grade, index }: { grade: Grade; index?: number }) {
  const color = GRADE_COLOR[grade];
  return (
    <span
      title="Heuristic data-quality index, not a statistical probability"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border border-line-2 px-1.5 py-px font-mono text-[10px] tracking-[0.06em] text-fg-2"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      CONF {grade}
      {index !== undefined && <span className="text-fg-3">· {index}</span>}
    </span>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-md border border-line bg-panel ${className}`}>
      {(title || right) && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          <h2 className="label truncate text-fg-2">{title}</h2>
          <div className="flex shrink-0 items-center gap-1.5">{right}</div>
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/** A tiny line chart for a series that may contain gaps. Gaps are left as gaps. */
export function Sparkline({
  values,
  width = 96,
  height = 22,
  color = "#36c3b5",
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return <div className="hatch rounded-sm" style={{ width, height }} title="No data" />;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  let d = "";
  let pen = false;
  const gaps: [number, number][] = [];
  let gapStart: number | null = null;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      if (gapStart === null) gapStart = i;
    } else {
      if (gapStart !== null) {
        gaps.push([gapStart, i]);
        gapStart = null;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
  });
  if (gapStart !== null) gaps.push([gapStart, values.length - 1]);
  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible">
      {gaps.map(([a, b], i) => (
        <rect key={i} x={x(a)} y={1} width={Math.max(2, x(b) - x(a))} height={height - 2} fill="#e5484d" opacity={0.14} />
      ))}
      <path d={d} fill="none" stroke={color} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  tag,
  accent,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  tag?: ReactNode;
  accent?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="label truncate">{label}</span>
        {tag}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="num text-[24px] font-medium leading-none" style={accent ? { color: accent } : undefined}>
          {value}
        </span>
        {unit && <span className="num text-[11px] text-fg-3">{unit}</span>}
      </div>
      <div className="truncate text-[11px] text-fg-3">{sub}</div>
    </div>
  );
}
