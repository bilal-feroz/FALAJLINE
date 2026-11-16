"use client";

import { fmt } from "@/lib/format";
import { useStore } from "@/lib/store";
import { waterAboveInvert, wetStart, type Profile } from "@/twin/section";

const W = 332;
const H = 176;
const PAD = { l: 4, r: 4, t: 26, b: 22 };
const EX = 6; // water level exaggeration, labelled on the chart

/**
 * Long section of the falaj from the shari'a to the mother well: ground from the elevation model, the tunnel,
 * and the water table for the selected day against today. Where the tunnel lies below the water table it
 * collects water (the wet stretch); as the head falls that stretch shortens and the flow drops.
 */
export function SectionChart({ head, head0, profile }: { head: number; head0: number; profile: Profile }) {
  const p = profile;
  const lo = Math.min(...p.invert) - 7;
  const hi = Math.max(...p.ground) + 4;
  const x = (s: number) => PAD.l + (s / p.L) * (W - PAD.l - PAD.r);
  const y = (e: number) => PAD.t + ((hi - e) / (hi - lo)) * (H - PAD.t - PAD.b);
  const bottom = H - PAD.b;
  const pts = (f: (i: number) => number) => p.s.map((s, i) => `${x(s).toFixed(1)},${Math.min(bottom, y(f(i))).toFixed(1)}`).join(" ");
  const wt = (h: number) => (i: number) => p.invert[i] + EX * waterAboveInvert(p, p.s[i], h);

  const ground = pts((i) => p.ground[i]);
  const water = pts(wt(head));
  const water0 = pts(wt(head0));
  const tunnel = pts((i) => p.invert[i]);
  const s0 = wetStart(p, head);
  const wetIdx = p.s.findIndex((s) => s >= s0);
  const wet = p.s.slice(wetIdx).map((s, k) => `${x(s).toFixed(1)},${y(p.invert[wetIdx + k]).toFixed(1)}`).join(" ");
  const wetLen = p.L - s0;
  const shafts = p.s.filter((_, i) => i % 12 === 6 && i < p.s.length - 6).map((s) => p.s.indexOf(s));
  const changed = Math.abs(head - head0) > 0.005;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible" role="img" aria-label={`Long section of the falaj. Wet stretch ${fmt(wetLen / 1000, 1)} km.`}>
      <defs>
        <linearGradient id="sec-sand" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#d8c49c" stopOpacity="0.75" />
          <stop offset="1" stopColor="#c7b089" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="sec-water" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#6f969a" stopOpacity="0.5" />
          <stop offset="1" stopColor="#6f969a" stopOpacity="0.12" />
        </linearGradient>
        <clipPath id="sec-clip">
          <rect x={0} y={0} width={W} height={bottom} />
        </clipPath>
      </defs>

      <g clipPath="url(#sec-clip)">
        <polygon points={`${x(0)},${bottom} ${ground} ${x(p.L)},${bottom}`} fill="url(#sec-sand)" />
        <polygon points={`${x(0)},${bottom} ${water} ${x(p.L)},${bottom}`} fill="url(#sec-water)" />
        {shafts.map((i) => (
          <line key={i} x1={x(p.s[i])} x2={x(p.s[i])} y1={y(p.ground[i])} y2={y(p.invert[i])} stroke="#3a3329" strokeOpacity={0.28} strokeWidth={0.8} />
        ))}
        {changed && <polyline points={water0} fill="none" stroke="#45666b" strokeWidth={1} strokeDasharray="3 3" strokeOpacity={0.7} />}
        <polyline points={water} fill="none" stroke="#45666b" strokeWidth={1.4} />
        <polyline points={tunnel} fill="none" stroke="#17130e" strokeWidth={2} strokeLinejoin="round" />
        {wetIdx >= 0 && wetLen > 0 && <polyline points={wet} fill="none" stroke="#4c8b93" strokeWidth={3.2} strokeLinecap="round" />}
        <polyline points={ground} fill="none" stroke="#3a3329" strokeWidth={1.1} />
      </g>

      {/* mother well */}
      <line x1={x(p.L) - 1} x2={x(p.L) - 1} y1={y(p.ground[p.ground.length - 1]) - 10} y2={y(p.invert[p.invert.length - 1]) + 4} stroke="#17130e" strokeWidth={1.6} />
      <circle cx={x(p.L) - 1} cy={y(p.ground[p.ground.length - 1]) - 10} r={2.4} fill="#17130e" />
      <text x={x(p.L) - 6} y={12} textAnchor="end" className="fill-ink font-mono text-[10px] uppercase tracking-[0.12em]">
        Mother well →
      </text>
      <text x={x(0)} y={12} className="fill-ink font-mono text-[10px] uppercase tracking-[0.12em]">
        ← Shari&apos;a · oasis
      </text>
      {wetLen > 0 && (
        <text x={x(p.L) - 8} y={Math.min(bottom - 4, y(p.invert[p.invert.length - 1]) + 16)} textAnchor="end" className="fill-[#3d6f76] font-mono text-[10px] uppercase tracking-[0.12em]">
          Wet stretch {fmt(wetLen / 1000, 1)} km
        </text>
      )}
      <text x={W - PAD.r} y={H - 4} textAnchor="end" className="fill-ink-3 font-mono text-[9.5px] uppercase tracking-[0.12em]">
        {fmt(p.L / 1000, 1)} km · water level ×{EX}
      </text>
      <text x={PAD.l} y={H - 4} className="fill-ink-3 font-mono text-[9.5px] uppercase tracking-[0.12em]">
        {changed ? "dashed: today" : "conceptual tunnel"}
      </text>
    </svg>
  );
}

export function FalajSection({ day }: { day: number }) {
  const profile = useStore((s) => s.profile);
  const data = useStore((s) => s.data);
  const scenarioId = useStore((s) => s.scenarioId);
  if (!profile || !data) return null;
  const sc = data.scenarios[scenarioId] ?? data.scenarios.baseline;
  return <SectionChart profile={profile} head={sc.source.head_m.central[day]} head0={sc.source.head_m.central[0]} />;
}
