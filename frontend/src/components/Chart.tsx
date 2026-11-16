"use client";

import { Area, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt } from "@/lib/format";
import type { ChartPoint } from "@/lib/series";
import { shortageWindow } from "@/lib/series";

const AXIS = { fontSize: 11.5, fill: "#6f6555", fontFamily: "var(--font-geist-mono)" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Tip({ active, payload, unit, digits, compare }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as ChartPoint & Record<string, number | null>;
  const row = (name: string, value: string, color: string, dashed = false) => (
    <div className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-2 text-ink-2">
        <span className="w-3" style={{ borderTop: `1.5px ${dashed ? "dashed" : "solid"} ${color}` }} />
        {name}
      </span>
      <span className="num text-ink">{value}</span>
    </div>
  );
  return (
    <div className="glass min-w-56 rounded-xl px-3.5 py-2.5 text-[13px]">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="display text-[18px] text-ink">{p.label}</span>
        <span className="num text-[11.5px] text-ink-3">{p.rel === 0 ? "today" : p.rel < 0 ? `${-p.rel} d ago` : `day +${p.rel}`}</span>
      </div>
      <div className="space-y-1">
        {p.rel <= 0 && row("Sensors (simulated)", p.obs === null ? "missing" : `${fmt(p.obs, digits)} ${unit}`, "#8a6f47")}
        {p.value !== null && row("Forecast", `${fmt(p.value, digits)} ${unit}`, "#1c1712")}
        {p.band && row("P10 – P90", `${fmt(p.band[0], digits)} – ${fmt(p.band[1], digits)}`, "#1c171266")}
        {p.required !== null && row("Demand", `${fmt(p.required, digits)} ${unit}`, "#a3865a", true)}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {compare?.map((c: any) => p[c.key] !== null && p[c.key] !== undefined && <div key={c.key}>{row(c.label, `${fmt(p[c.key] as number, digits)} ${unit}`, c.color)}</div>)}
        {p.value !== null && p.required !== null && (
          <div className={`num pt-1 text-right text-[12.5px] ${p.value < p.required ? "text-act" : "text-ink-3"}`}>
            {p.value < p.required ? `short by ${fmt(p.required - p.value, digits)} ${unit}` : `margin +${fmt(((p.value - p.required) / p.required) * 100, 0)}%`}
          </div>
        )}
      </div>
    </div>
  );
}

/** History, forecast, P10–P90 band, demand and the predicted shortage window on one axis. */
export function TrendChart({
  points,
  selectedLabel,
  todayLabel,
  unit,
  digits = 1,
  onSelect,
  compact = false,
  color = "#1c1712",
}: {
  points: ChartPoint[];
  selectedLabel: string;
  todayLabel: string;
  unit: string;
  digits?: number;
  onSelect?: (rel: number) => void;
  compact?: boolean;
  color?: string;
}) {
  const win = shortageWindow(points);
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={60}>
      <ComposedChart
        data={points}
        margin={{ top: 10, right: 12, bottom: 0, left: compact ? -16 : -8 }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={(e: any) => {
          const hit = points.find((p) => p.label === e?.activeLabel);
          if (hit && hit.rel >= 0) onSelect?.(hit.rel);
        }}
      >
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: "rgba(242,234,216,0.12)" }} interval={compact ? 6 : 3} minTickGap={10} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={compact ? 38 : 46} domain={["auto", "auto"]} tickFormatter={(v: number) => fmt(v, digits > 1 ? 2 : 0)} />
        <Tooltip content={<Tip unit={unit} digits={digits} />} cursor={{ stroke: "rgba(242,234,216,0.2)" }} isAnimationActive={false} />
        {win && <ReferenceArea x1={win.from} x2={win.to} fill="#c2432b" fillOpacity={0.13} stroke="none" ifOverflow="extendDomain" />}
        <Area dataKey="band" stroke="none" fill={color} fillOpacity={0.1} isAnimationActive={false} />
        <Line dataKey="required" stroke="#a3865a" strokeWidth={1.4} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        <Line dataKey="obs" stroke="#8a6f47" strokeWidth={1.3} dot={{ r: compact ? 1.2 : 1.7, fill: "#8a6f47", strokeWidth: 0 }} isAnimationActive={false} connectNulls={false} />
        <Line dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        <ReferenceLine x={todayLabel} stroke="rgba(242,234,216,0.25)" strokeDasharray="2 4" />
        <ReferenceLine x={selectedLabel} stroke="#1c1712" strokeWidth={1} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function Legend() {
  const item = (el: React.ReactNode, text: string) => (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      {el}
      {text}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
      {item(<span className="w-3.5 border-t-[1.5px] border-[#8a6f47]" />, "Sensor history · simulated")}
      {item(<span className="w-3.5 border-t-2 border-ink" />, "Forecast")}
      {item(<span className="h-2 w-3.5 rounded-sm bg-ink/15" />, "P10–P90 of assumptions")}
      {item(<span className="w-3.5 border-t-[1.5px] border-dashed border-beige" />, "Demand")}
      {item(<span className="h-2 w-3.5 rounded-sm bg-act/30" />, "Shortage window")}
    </div>
  );
}
