"use client";

import { useState } from "react";
import { DeliveryQueue, Notices, SmsPreview, WarningCards, WarningDetail } from "@/components/alerts/panels";
import { useStore } from "@/lib/store";

export default function AlertsPage() {
  const warnings = useStore((s) => s.data)!.warnings.warnings;
  const select = useStore((s) => s.select);
  // deep link from the Operations view: /alerts?w=W-Z4-SUPPLY (this page only renders in the browser, after data has loaded)
  const [selected, setSelected] = useState<string | null>(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("w")));

  const current = warnings.find((w) => w.id === selected) ?? warnings[0] ?? null;

  const pick = (id: string) => {
    setSelected(id);
    const w = warnings.find((x) => x.id === id);
    // keep the other views pointed at the same zone
    select(w && w.type === "supply_shortfall" ? { type: "zone", id: w.affected_zones[0] } : null);
  };

  return (
    <div className="grid h-full grid-cols-[336px_minmax(0,1fr)_388px] gap-2.5 p-2.5">
      <div className="flex min-h-0 flex-col gap-2.5">
        <WarningCards selected={current?.id ?? null} onSelect={pick} />
        <Notices />
      </div>
      <div className="min-h-0 min-w-0">
        {current ? (
          <WarningDetail w={current} />
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-line bg-panel text-sm text-fg-3">
            No active warnings: supply covers demand in every zone across the 21-day horizon.
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-col gap-2.5">
        {current && <SmsPreview w={current} />}
        <DeliveryQueue selected={current?.id ?? null} />
      </div>
    </div>
  );
}
