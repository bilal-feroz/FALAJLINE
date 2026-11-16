"use client";

import { Area, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt } from "@/lib/format";
import type { ChartPoint } from "@/lib/series";
import { shortageWindow } from "@/lib/series";

interface Props {
  points: ChartPoint[];
  selectedLabel: string;
  todayLabel: string;
  unit: string;
  digits?: number;
  color?: string;
  compact?: boolean;
  requiredLabel?: string;
  onSelect?: (rel: number) => void;
  compare?: { key: string; label: string; color: string }[]; // extra central lines keyed on the point
}

const AXIS = { fontSize: 10, fill: "#6c7573", fontFamily: "var(--font-geist-mono)" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Tip({ active, payload, unit, digits, requiredLabel, compare }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as ChartPoint & Record<string, number | null>;
  const row = (name: string, value: string, color: string, tag?: string) => (
    <div className="flex items-center justify-between gap-5">
      <span className="flex items-center gap-1.5 text-fg-2">
        <span className="h-0.5 w-3" style={{ background: color }} />
        {name}
        {tag && <span className="font-mono text-[9px] tracking-wider text-fg-3">{tag}</span>}
      </span>
      <span className="num text-fg">{value}</span>
    </div>
  );
  return (
    <div className="min-w-52 rounded-md border border-line-2 bg-panel-2 px-3 py-2 text-[11.5px] shadow-xl">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="num text-fg">{p.label}</span>
        <span className="num text-[10px] text-fg-3">{p.rel === 0 ? "today" : p.rel < 0 ? `${-p.rel} d ago` : `day +${p.rel}`}</span>
      </div>
      <div className="space-y-1">
        {p.rel <= 0 && row("Sensor reading", p.obs === null ? "missing" : `${fmt(p.obs, digits)} ${unit}`, "#cdb88c", "SIM")}
        {p.value !== null && row("Forecast", `${fmt(p.value, digits)} ${unit}`, "#36c3b5", "MOD")}
        {p.band && row("P10 – P90", `${fmt(p.band[0], digits)} – ${fmt(p.band[1], digits)}`, "#36c3b566")}
        {p.required !== null && row(requiredLabel ?? "Required", `${fmt(p.required, digits)} ${unit}`, "#e8eae7")}
        {p.value !== null && p.required !== null && (
          <div className={`num pt-0.5 text-right text-[11px] ${p.value < p.required ? "text-act" : "text-fg-3"}`}>
            {p.value < p.required ? `short by ${fmt(p.required - p.value, digits)} ${unit}` : `margin +${fmt(((p.value - p.required) / p.required) * 100, 0)}%`}
          </div>
        )}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {compare?.map((c: any) => p[c.key] !== null && p[c.key] !== undefined && <div key={c.key}>{row(c.label, `${fmt(p[c.key] as number, digits)} ${unit}`, c.color)}</div>)}
      </div>
    </div>
  );
}

/**
 * History (simulated sensor readings, with gaps left as gaps), forecast trajectory, P10–P90 interval,
 * the required supply and the predicted shortage window on one axis.
 */
export function TrendChart({ points, selectedLabel, todayLabel, unit, digits = 1, color = "#36c3b5", compact, requiredLabel, onSelect, compare }: Props) {
  const win = shortageWindow(points);
  const every = compact ? 6 : Math.max(1, Math.round(points.length / 12));
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={60}>
      <ComposedChart
        data={points}
        margin={{ top: 8, right: 10, bottom: 0, left: compact ? -14 : -6 }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={(e: any) => {
          const label = e?.activeLabel;
          const hit = points.find((p) => p.label === label);
          if (hit && hit.rel >= 0) onSelect?.(hit.rel);
        }}
      >
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "#1c2223" }} interval={every - 1} minTickGap={8} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={compact ? 40 : 46} domain={["auto", "auto"]} tickFormatter={(v: number) => fmt(v, digits > 1 ? 2 : 0)} />
        <Tooltip content={<Tip unit={unit} digits={digits} requiredLabel={requiredLabel} compare={compare} />} cursor={{ stroke: "#2a3233" }} isAnimationActive={false} />
        {win && <ReferenceArea x1={win.from} x2={win.to} fill="#e5484d" fillOpacity={0.09} stroke="none" ifOverflow="extendDomain" />}
        <Area dataKey="band" stroke="none" fill={color} fillOpacity={0.14} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="required" stroke="#e8eae7" strokeWidth={1.25} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="obs" stroke="#cdb88c" strokeWidth={1.25} dot={{ r: compact ? 1.2 : 1.8, fill: "#cdb88c", strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
        {compare?.map((c) => <Line key={c.key} dataKey={c.key} stroke={c.color} strokeWidth={1.4} strokeDasharray="2 3" dot={false} isAnimationActive={false} />)}
        <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
        <ReferenceLine x={todayLabel} stroke="#454d4c" strokeDasharray="2 3" />
        <ReferenceLine x={selectedLabel} stroke="#e8eae7" strokeWidth={1} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ChartLegend({ required = "Required supply (demand)", showRequired = true, brief = false }: { required?: string; showRequired?: boolean; brief?: boolean }) {
  const item = (el: React.ReactNode, text: string) => (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {el}
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-fg-3">
      {item(<span className="h-0.5 w-3.5 bg-sand" />, brief ? "Sensors (sim.)" : "Sensor history (simulated)")}
      {item(<span className="h-0.5 w-3.5 bg-water" />, "Forecast")}
      {item(<span className="h-2 w-3.5 rounded-sm bg-water/20" />, brief ? "P10–P90" : "P10–P90 of assumption ensemble")}
      {showRequired && item(<span className="h-0 w-3.5 border-t border-dashed border-fg" />, required)}
      {showRequired && item(<span className="h-2 w-3.5 rounded-sm bg-act/20" />, brief ? "Shortage" : "Predicted shortage window")}
    </div>
  );
}
