"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ChartLegend, TrendChart } from "@/components/charts/TrendChart";
import { KpiStrip, SensorPanel, WarningList, WeatherPanel, ZoneTable } from "@/components/ops/panels";
import { Panel } from "@/components/ui/primitives";
import { fmtDay } from "@/lib/format";
import { supplySeries } from "@/lib/series";
import { useScenario, useStore } from "@/lib/store";

const OasisMap = dynamic(() => import("@/components/ops/OasisMap"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center rounded-md border border-line bg-panel text-xs text-fg-3">Loading map…</div>,
});

export default function OperationsPage() {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const setDay = useStore((s) => s.setDay);
  const selection = useStore((s) => s.selection);
  const target = selection?.type === "zone" ? selection.id : "system";
  const zone = sc.zones.find((z) => z.id === target);

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_372px] gap-2.5 p-2.5">
      <div className="flex min-h-0 min-w-0 flex-col gap-2.5">
        <KpiStrip />
        <div className="min-h-0 flex-1">
          <OasisMap />
        </div>
        <div className="grid h-[176px] shrink-0 grid-cols-[minmax(0,1fr)_340px] gap-2.5">
          <Panel
            title={`${zone ? `${zone.id} ${zone.name}` : "Whole oasis"} · supply against demand, L/s`}
            right={
              <>
                <div className="hidden 2xl:block">
                  <ChartLegend required="Demand" brief />
                </div>
                <Link href="/forecast" className="ml-2 font-mono text-[10px] tracking-wide text-water hover:underline">
                  FORECAST →
                </Link>
              </>
            }
            bodyClassName="px-1 pb-1 pt-1"
          >
            <TrendChart points={supplySeries(data, sc, target)} selectedLabel={fmtDay(sc.dates[day])} todayLabel={fmtDay(sc.dates[0])} unit="L/s" compact requiredLabel="Demand" onSelect={setDay} />
          </Panel>
          <WeatherPanel />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-2.5">
        <WarningList />
        <ZoneTable />
        <SensorPanel />
      </div>
    </div>
  );
}
