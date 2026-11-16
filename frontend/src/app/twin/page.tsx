"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { TwinLabels } from "@/components/twin/TwinLabels";
import { LayerControls, SceneNote, SelectionPanel } from "@/components/twin/TwinOverlay";
import type { CameraPreset, Layers } from "@/components/twin/TwinScene";
import { RiskChip } from "@/components/ui/primitives";
import { fmt, fmtDay } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";

const TwinScene = dynamic(() => import("@/components/twin/TwinScene"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-fg-3">Building the digital twin…</div>,
});

export default function TwinPage() {
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const [layers, setLayers] = useState<Layers>({ surface: true, underground: true, flow: true, risk: true, sensors: true, labels: true });
  const [camera, setCamera] = useState<{ preset: CameraPreset; nonce: number }>({ preset: "overview", nonce: 0 });
  const g = sc.guidance[day];

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="absolute inset-0">
        <TwinScene layers={layers} preset={camera.preset} nonce={camera.nonce} />
      </div>
      {layers.labels && <TwinLabels underground={layers.underground} surface={layers.surface} />}

      <div className="pointer-events-none absolute inset-0 z-30 flex items-start justify-between gap-3 p-3">
        <LayerControls
          layers={layers}
          preset={camera.preset}
          onToggle={(k) => setLayers((l) => ({ ...l, [k]: !l[k] }))}
          onCamera={(preset) => setCamera((c) => ({ preset, nonce: c.nonce + 1 }))}
        />

        <div className="pointer-events-auto flex items-center gap-3 rounded-md border border-line-2 bg-bg/80 px-3 py-2 backdrop-blur-sm">
          <RiskChip level={g.level} size="md" />
          <div>
            <div className="text-[12.5px] text-fg">{g.headline}</div>
            <div className="num mt-0.5 text-[10.5px] text-fg-3">
              {fmtDay(sc.dates[day])} · source head {fmt(sc.source.head_m.central[day], 2)} m · main flow {fmt(sc.main.flow_lps.central[day], 1)} L/s · {sc.scenario.label.toLowerCase()}
            </div>
          </div>
        </div>

        <div className="flex max-h-full min-h-0">
          <SelectionPanel />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-30">
        <SceneNote />
      </div>
    </div>
  );
}
