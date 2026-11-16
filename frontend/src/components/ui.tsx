"use client";

import type { ReactNode } from "react";
import { GRADE_COLOR, RISK_COLOR, RISK_WORD } from "@/lib/format";
import type { Grade, Provenance, RiskLevel } from "@/lib/types";

const PROV: Record<string, { text: string; title: string; cls: string }> = {
  live: { text: "Live", title: "Live data from an external provider", cls: "text-cream bg-ink" },
  observed: { text: "Obs", title: "Real-world data from an external provider", cls: "text-ink border border-ink/45" },
  simulated: { text: "Sim", title: "Synthetic stand-in for field data that is not connected", cls: "text-beige border border-dashed border-beige/60" },
  modelled: { text: "Model", title: "Computed by the FALAJLINE model", cls: "text-ink-3 border border-ink-4/70" },
  unavailable: { text: "N/A", title: "Missing: shown as missing, never replaced by a number", cls: "text-act border border-act/50 hatch" },
  conceptual: { text: "Concept", title: "Illustrative engineering reconstruction, not a survey", cls: "text-beige-2 border border-dashed border-beige-2/60" },
  representative: { text: "Repr", title: "A representative location, not a surveyed boundary", cls: "text-beige-2 border border-dashed border-beige-2/60" },
};

export function Prov({ kind, className = "" }: { kind: Provenance | "live" | string; className?: string }) {
  const p = PROV[kind] ?? PROV.modelled;
  return (
    <span title={p.title} className={`inline-flex shrink-0 items-center rounded-full px-1.5 font-mono text-[10px] font-medium uppercase leading-[15px] tracking-[0.12em] ${p.cls} ${className}`}>
      {p.text}
    </span>
  );
}

export function Risk({ level, size = "sm" }: { level: RiskLevel; size?: "sm" | "md" }) {
  const c = RISK_COLOR[level];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-mono font-medium uppercase tracking-[0.14em] ${size === "md" ? "px-2.5 py-[3px] text-[11.5px]" : "px-2 py-[1px] text-[10.5px]"}`}
      style={{ color: c, background: `color-mix(in srgb, ${c} 13%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 38%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {RISK_WORD[level]}
    </span>
  );
}

export function Conf({ grade, index }: { grade: Grade; index?: number }) {
  return (
    <span
      title="Data-quality confidence index with itemised reasons. Not a statistical probability."
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[1px] font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-2"
      style={{ boxShadow: "inset 0 0 0 1px rgb(28 23 18 / 0.14)" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: GRADE_COLOR[grade] }} />
      Conf {index ?? grade.toLowerCase()}
    </span>
  );
}

export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`eyebrow ${className}`}>{children}</div>;
}

export function Glass({ children, className = "", style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`glass ${className}`} style={style}>
      {children}
    </div>
  );
}

export function Section({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border-t hairline px-5 py-4 first:border-t-0 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <Eyebrow>{title}</Eyebrow>
          <div className="flex items-center gap-1.5">{right}</div>
        </div>
      )}
      {children}
    </section>
  );
}

/** A small line chart; gaps stay gaps. */
export function Spark({ values, width = 120, height = 26, color = "#1c1712", fill = false, mark }: { values: (number | null)[]; width?: number; height?: number; color?: string; fill?: boolean; mark?: number }) {
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return <div className="hatch rounded-sm" style={{ width, height }} title="No data" />;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  let d = "";
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  const area = fill ? `${d}L${x(values.length - 1)},${height}L${x(0)},${height}Z` : "";
  return (
    <svg width={width} height={height} className="shrink-0 overflow-visible">
      {fill && <path d={area} fill={color} opacity={0.1} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" strokeLinecap="round" />
      {mark !== undefined && values[mark] !== null && values[mark] !== undefined && <circle cx={x(mark)} cy={y(values[mark] as number)} r={2.4} fill={color} />}
    </svg>
  );
}

export function IconButton({ onClick, label, children, active = false }: { onClick: () => void; label: string; children: ReactNode; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${active ? "bg-ink text-cream" : "text-ink-2 hover:bg-ink/10 hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

export function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 text-[13px] text-ink-2 hover:text-ink" aria-pressed={on}>
      <span className={`relative h-[14px] w-[24px] rounded-full transition-colors ${on ? "bg-ink" : "bg-ink/15"}`}>
        <span className={`absolute top-[2px] h-[10px] w-[10px] rounded-full transition-all ${on ? "left-[12px] bg-cream" : "left-[2px] bg-ink-3"}`} />
      </span>
      {label}
    </button>
  );
}
