"use client";

import type { ReactNode } from "react";
import { GradeChip, ProvTag, RiskChip, Sparkline } from "@/components/ui/primitives";
import { RISK_COLOR, STATUS_COLOR, fmt, fmtAge, fmtDay, fmtGst, inDays } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import type { Sensor } from "@/lib/types";
import type { CameraPreset, Layers } from "./TwinScene";

const LAYER_LABELS: [keyof Layers, string, string][] = [
  ["surface", "Surface", "Terrain cover, groves, channels and outlets"],
  ["underground", "Underground", "Cut the block open: groundwater, mother well, shafts and tunnel"],
  ["flow", "Flow", "Animated water: density and speed follow simulated flow"],
  ["risk", "Risk overlay", "Colour each farm zone by its risk state on the selected day"],
  ["sensors", "Sensors", "Simulated sensor posts, coloured by health"],
  ["labels", "Labels", "Component names"],
];

const CAMERAS: [CameraPreset, string][] = [
  ["overview", "Overview"],
  ["section", "Section"],
  ["source", "Source"],
  ["oasis", "Oasis"],
];

export function LayerControls({ layers, onToggle, onCamera, preset }: { layers: Layers; onToggle: (k: keyof Layers) => void; onCamera: (p: CameraPreset) => void; preset: CameraPreset }) {
  return (
    <div className="pointer-events-auto w-[168px] rounded-md border border-line-2 bg-bg/80 p-2.5 backdrop-blur-sm">
      <div className="label mb-1.5">Layers</div>
      <div className="space-y-0.5">
        {LAYER_LABELS.map(([key, label, title]) => (
          <button key={key} title={title} onClick={() => onToggle(key)} aria-pressed={layers[key]} className="flex w-full items-center gap-2 rounded-[3px] px-1.5 py-1 text-left text-[11.5px] hover:bg-panel-3">
            <span className={`flex h-3 w-3 items-center justify-center rounded-[2px] border ${layers[key] ? "border-water bg-water/90" : "border-fg-4"}`}>
              {layers[key] && (
                <svg width="8" height="8" viewBox="0 0 8 8">
                  <path d="M1.5 4.2 3.3 6l3.2-4" fill="none" stroke="#07090a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className={layers[key] ? "text-fg" : "text-fg-3"}>{label}</span>
          </button>
        ))}
      </div>
      <div className="label mb-1.5 mt-3">Camera</div>
      <div className="grid grid-cols-2 gap-1">
        {CAMERAS.map(([id, label]) => (
          <button key={id} onClick={() => onCamera(id)} className={`rounded-[3px] border px-1.5 py-1 text-[11px] ${preset === id ? "border-line-2 bg-panel-3 text-fg" : "border-line text-fg-3 hover:text-fg-2"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-2.5 text-[10px] leading-snug text-fg-3">Drag to rotate · right-drag to pan · scroll to zoom · click a component</div>
    </div>
  );
}

function Row({ k, v, tag }: { k: string; v: ReactNode; tag?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="flex items-center gap-1.5 text-[11.5px] text-fg-3">
        {k}
        {tag}
      </span>
      <span className="num text-right text-[12px] text-fg">{v}</span>
    </div>
  );
}

function SensorBlock({ sensor }: { sensor: Sensor | undefined }) {
  if (!sensor) return null;
  const missing = sensor.status === "offline" || sensor.status === "stuck";
  return (
    <div className="mt-2 border-t border-line pt-2">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[sensor.status] }} />
        <span className="num text-[11.5px] text-fg">{sensor.id}</span>
        <ProvTag kind="simulated" short />
        <span className="num ml-auto text-[10.5px]" style={{ color: sensor.status === "ok" ? "var(--color-fg-3)" : STATUS_COLOR[sensor.status] }}>
          {sensor.status} · {fmtAge(sensor.age_min)} ago
        </span>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div>
          <div className="num text-[17px] leading-none text-fg">
            {missing ? <span className="text-fg-3">no current reading</span> : fmt(sensor.last_value, sensor.kind === "level" ? 3 : 1)}
            {!missing && <span className="ml-1 text-[10.5px] text-fg-3">{sensor.unit}</span>}
          </div>
          <div className="mt-1 text-[10.5px] text-fg-3">
            {sensor.label} · {sensor.valid_24h}/{sensor.expected_24h} valid readings in 24 h
            {sensor.rejected.length > 0 && ` · ${sensor.rejected.length} outlier rejected`}
          </div>
        </div>
        <Sparkline values={sensor.hourly.values} width={112} height={30} color={sensor.status === "ok" ? "#cdb88c" : STATUS_COLOR[sensor.status]} />
      </div>
      {missing && <div className="mt-1.5 text-[10.5px] leading-snug text-watch">Last valid value {fmt(sensor.last_value, sensor.kind === "level" ? 3 : 1)} {sensor.unit}. Values shown above for this component are modelled.</div>}
    </div>
  );
}

/** Telemetry and forecast for whatever is selected in the scene, at the selected timeline day. */
export function SelectionPanel() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const sensors = data.telemetry.sensors;
  const byId = (id: string) => sensors.find((s) => s.id === id);
  const date = fmtDay(sc.dates[day]);
  const vsToday = (now: number, then: number) => `${now >= then ? "+" : ""}${fmt((now / then - 1) * 100, 0)}% vs today`;

  let title = "Falaj system";
  let subtitle = "Select the mother well, tunnel, a channel, a farm zone or a sensor";
  let chips: ReactNode = <RiskChip level={sc.system.risk[day]} />;
  let body: ReactNode;

  if (selection?.type === "zone") {
    const z = sc.zones.find((x) => x.id === selection.id)!;
    const conf = sc.confidence.zones[z.id][day];
    const pass = data.telemetry.satellite.passes[data.telemetry.satellite.passes.length - 1];
    const vi = pass?.zones[z.id];
    title = `${z.id} · ${z.name}`;
    subtitle = `${fmt(z.area_ha, 1)} ha · ${z.position}-end zone on branch ${z.branch}`;
    chips = (
      <>
        <RiskChip level={z.risk[day]} />
        <GradeChip grade={conf.grade} index={conf.index} />
      </>
    );
    body = (
      <>
        <Row k="Delivered at outlet" v={`${fmt(z.supply_lps.central[day], 1)} L/s`} tag={<ProvTag kind="modelled" short />} />
        <Row k="P10 – P90" v={`${fmt(z.supply_lps.p10[day], 1)} – ${fmt(z.supply_lps.p90[day], 1)} L/s`} />
        <Row k="Irrigation demand" v={`${fmt(z.demand_lps[day], 1)} L/s`} />
        <Row k="Supply / demand" v={<span style={{ color: RISK_COLOR[z.risk[day]] }}>{fmt(z.ratio.central[day] * 100, 0)}%</span>} />
        <Row k="First shortfall" v={z.shortfall.first_day === null ? "none within 21 days" : `${fmtDay(z.shortfall.first_date)} · ${z.shortfall.first_day >= day ? inDays(z.shortfall.first_day - day) : "under way"}`} />
        <Row k="Deficit over 21 days" v={`${fmt(z.deficit_m3_total, 0)} m³`} />
        <Row
          k="Vegetation index"
          tag={<ProvTag kind={vi === null || vi === undefined ? "unavailable" : "simulated"} short />}
          v={vi === null || vi === undefined ? "pass obscured: unavailable" : `${fmt(vi, 3)} · ${fmtGst(pass.time, true)}`}
        />
        <SensorBlock sensor={byId(`S-OUT-${z.id}`)} />
      </>
    );
  } else if (selection?.type === "branch") {
    const b = sc.branches.find((x) => x.id === selection.id)!;
    const check = data.state.branch_checks.find((c) => c.branch === b.id);
    title = b.name;
    subtitle = `Holds ${fmt(b.share * 100, 1)}% of the flow at the divider`;
    chips = <RiskChip level={b.risk[day]} />;
    body = (
      <>
        <Row k="Flow entering branch" v={`${fmt(b.flow_lps[day], 1)} L/s`} tag={<ProvTag kind="modelled" short />} />
        <Row k="Delivered to outlets" v={`${fmt(b.delivered_lps[day], 1)} L/s`} />
        <Row k="Lost along the branch" v={`${fmt(b.loss_lps[day], 1)} L/s · ${fmt((b.loss_lps[day] / b.flow_lps[day]) * 100, 0)}%`} />
        <Row k="Capacity used" v={`${fmt((b.flow_lps[day] / b.capacity_lps) * 100, 0)}% of ${fmt(b.capacity_lps, 0)} L/s`} />
        <Row k="Change" v={vsToday(b.flow_lps[day], b.flow_lps[0])} />
        {check && (
          <div className={`mt-2 rounded-[4px] border px-2 py-1.5 text-[11px] leading-snug ${check.anomaly ? "border-prepare/50 text-prepare" : "border-line text-fg-3"}`}>
            {check.note}
          </div>
        )}
        <SensorBlock sensor={byId(`S-FL-${b.id}`)} />
      </>
    );
  } else if (selection?.type === "main") {
    title = "Main channel";
    subtitle = "From the shari'a to the division structure";
    body = (
      <>
        <Row k="Flow at the shari'a" v={`${fmt(sc.main.flow_lps.central[day], 1)} L/s`} tag={<ProvTag kind="modelled" short />} />
        <Row k="P10 – P90" v={`${fmt(sc.main.flow_lps.p10[day], 1)} – ${fmt(sc.main.flow_lps.p90[day], 1)} L/s`} />
        <Row k="Reaching the divider" v={`${fmt(sc.main.divider_lps[day], 1)} L/s`} />
        <Row k="Capacity used" v={`${fmt((sc.main.flow_lps.central[day] / sc.main.capacity_lps) * 100, 0)}% of ${fmt(sc.main.capacity_lps, 0)} L/s`} />
        <Row k="Change" v={vsToday(sc.main.flow_lps.central[day], sc.main.flow_lps.central[0])} />
        <SensorBlock sensor={byId("S-FL-MAIN")} />
      </>
    );
  } else if (selection?.type === "tunnel") {
    title = "Falaj tunnel";
    subtitle = `${data.geo.tunnel_length_km} km from the mother well to the shari'a (length compressed in this view)`;
    body = (
      <>
        <Row k="Entering at the mother well" v={`${fmt(sc.source.discharge_lps.central[day], 1)} L/s`} tag={<ProvTag kind="modelled" short />} />
        <Row k="Leaving at the shari'a" v={`${fmt(sc.main.flow_lps.central[day], 1)} L/s`} />
        <Row k="Seepage along the tunnel" v={`${fmt(sc.balance.tunnel_loss_lps[day], 1)} L/s`} />
        <Row k="Access shafts (thaqba)" v="conceptual spacing" />
        <p className="mt-2 text-[11px] leading-snug text-fg-3">
          The bright sleeve at the upstream end marks the stretch below the water table, where the tunnel gains its water. It shortens as the water table falls.
        </p>
      </>
    );
  } else if (selection?.type === "sensor") {
    const s = byId(selection.id);
    title = s ? `${s.id}` : "Sensor";
    subtitle = s ? s.label : "";
    chips = s ? (
      <span className="font-mono text-[10px] tracking-wide" style={{ color: STATUS_COLOR[s.status] }}>
        {s.status.toUpperCase()}
      </span>
    ) : null;
    body = (
      <>
        <p className="text-[11px] leading-snug text-fg-3">{s?.status_detail}</p>
        <SensorBlock sensor={s} />
        <p className="mt-2 text-[10.5px] leading-snug text-fg-3">Inject or clear a fault on this sensor from the Operations view to see how confidence responds.</p>
      </>
    );
  } else {
    const isSource = selection?.type === "source";
    if (isSource) {
      title = "Mother well · groundwater source";
      subtitle = `Umm al-falaj, about ${data.geo.mother_well_depth_m} m deep (conceptual position)`;
    }
    const conf = sc.confidence.system[day];
    chips = (
      <>
        <RiskChip level={sc.system.risk[day]} />
        <GradeChip grade={conf.grade} index={conf.index} />
      </>
    );
    body = (
      <>
        <Row k="Head above tunnel invert" v={`${fmt(sc.source.head_m.central[day], 2)} m`} tag={<ProvTag kind="modelled" short />} />
        <Row k="P10 – P90" v={`${fmt(sc.source.head_m.p10[day], 2)} – ${fmt(sc.source.head_m.p90[day], 2)} m`} />
        <Row k="Discharge into the falaj" v={`${fmt(sc.source.discharge_lps.central[day], 1)} L/s`} />
        <Row k="Observed trend" v={`${fmt(data.state.trend_m_per_day * 100, 1)} cm/day`} tag={<ProvTag kind="simulated" short />} />
        <Row k="Rain-fed recharge that day" v={`${fmt(sc.source.recharge_m3d[day], 0)} m³`} />
        <Row k="Change" v={vsToday(sc.source.discharge_lps.central[day], sc.source.discharge_lps.central[0])} />
        {!isSource && (
          <>
            <Row k="Delivered to all zones" v={`${fmt(sc.system.supply_lps.central[day], 1)} L/s`} />
            <Row k="Total demand" v={`${fmt(sc.system.demand_lps.central[day], 1)} L/s`} />
            <Row k="Zones below demand" v={sc.system.zones_short[day].length ? sc.system.zones_short[day].join(", ") : "none"} />
          </>
        )}
        <p className="mt-2 text-[10.5px] leading-snug text-fg-3">Basis: {data.state.basis_label}.</p>
        <SensorBlock sensor={byId("S-GW-01")} />
      </>
    );
  }

  return (
    <div className="pointer-events-auto flex max-h-full w-[324px] flex-col rounded-md border border-line-2 bg-bg/85 backdrop-blur-sm">
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-medium text-fg">{title}</div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-fg-3">{subtitle}</div>
          </div>
          {selection && (
            <button onClick={() => select(null)} aria-label="Clear selection" className="rounded px-1 text-[14px] leading-none text-fg-3 hover:text-fg">
              ×
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {chips}
          <span className="num ml-auto text-[10.5px] text-fg-3">
            {date} · {day === 0 ? "today" : `day +${day}`}
          </span>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto px-3 py-2">{body}</div>
    </div>
  );
}

export function SceneNote() {
  return (
    <div className="pointer-events-auto max-w-[420px] rounded-md border border-line-2 bg-bg/80 px-3 py-2 text-[10.5px] leading-snug text-fg-3 backdrop-blur-sm">
      <div className="mb-1 flex items-center gap-1.5">
        <ProvTag kind="conceptual" short />
        <span className="text-fg-2">Conceptual engineering reconstruction</span>
      </div>
      Not a survey of protected heritage infrastructure. The tunnel section is compressed, the vertical scale is exaggerated, and changes in the water table are exaggerated further so that decimetres of decline are visible. The dashed sand line is today&apos;s water table.
    </div>
  );
}
