"use client";

import { useEffect, useState } from "react";
import { GradeChip, Panel, ProvTag, RiskChip } from "@/components/ui/primitives";
import { GRADE_COLOR, RISK_COLOR, RISK_MEANING, fmt, fmtDay, fmtGst, inDays } from "@/lib/format";
import { useScenario, useStore } from "@/lib/store";
import type { Queue, QueueMessage, Warning } from "@/lib/types";

const TYPE_LABEL: Record<Warning["type"], string> = {
  supply_shortfall: "Zone supply",
  source_recession: "Source",
  branch_anomaly: "Channel anomaly",
};

function when(w: Warning): string {
  if (w.type === "supply_shortfall") return w.window.predicted ? inDays(w.window.lead_days) : "margin eroding";
  return w.type === "branch_anomaly" ? "detected now" : "under way";
}

export function WarningCards({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const w = useStore((s) => s.data)!.warnings;
  return (
    <Panel
      title={`Warnings · issued ${fmtGst(w.issued_at)} GST`}
      right={
        <span className="num text-[10px] text-fg-3">
          {w.counts.ACT} ACT · {w.counts.PREPARE} PREPARE · {w.counts.WATCH} WATCH
        </span>
      }
      className="min-h-0 flex-1"
      bodyClassName="overflow-y-auto"
    >
      <ul>
        {w.warnings.map((x) => {
          const on = x.id === selected;
          return (
            <li key={x.id}>
              <button
                onClick={() => onSelect(x.id)}
                className={`relative block w-full border-b border-line/70 px-3 py-2.5 text-left transition-colors hover:bg-panel-2 ${on ? "bg-panel-2" : ""}`}
              >
                {on && <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: RISK_COLOR[x.level] }} />}
                <div className="flex items-center gap-2">
                  <RiskChip level={x.level} />
                  <span className="font-mono text-[9.5px] uppercase tracking-wide text-fg-3">{TYPE_LABEL[x.type]}</span>
                  <span className="num ml-auto text-[10.5px] text-fg-2">{when(x)}</span>
                </div>
                <div className="mt-1.5 text-[12.5px] leading-snug text-fg">{x.title}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <GradeChip grade={x.confidence.grade} index={x.confidence.index} />
                  {x.held_back && <span className="font-mono text-[9.5px] tracking-wide text-watch">HELD · PENDING CONFIRMATION</span>}
                  <span className="num ml-auto text-[10px] text-fg-3">{x.affected_zones.join(" ")}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function Notices() {
  const w = useStore((s) => s.data)!.warnings;
  if (!w.notices.length) return null;
  return (
    <Panel title={`Data-quality notices · ${w.notices.length}`} right={<ProvTag kind="unavailable" short />} className="max-h-[210px] shrink-0" bodyClassName="overflow-y-auto">
      <ul>
        {w.notices.map((n) => (
          <li key={n.id} className="border-b border-line/70 px-3 py-2 last:border-0">
            <div className="text-[11.5px] text-fg">{n.title}</div>
            <div className="mt-0.5 text-[10.5px] leading-snug text-fg-3">{n.detail}</div>
            <div className="mt-0.5 text-[10.5px] text-fg-2">→ {n.action}</div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3.5 py-2.5">
      <div className="label">{label}</div>
      <div className="mt-1.5 text-[12.5px] leading-snug text-fg">{children}</div>
    </div>
  );
}

/** Earliest / central / latest start of the shortage on the 21-day axis. */
function WindowStrip({ w }: { w: Warning }) {
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const n = sc.dates.length;
  const pos = (d: number) => `${((d + 0.5) / n) * 100}%`;
  const win = w.window;
  if (w.type !== "supply_shortfall") return null;
  const end = win.continues_beyond_horizon ? n - 1 : win.end_date ? sc.dates.indexOf(win.end_date) : null;
  return (
    <div className="px-3.5 pb-3 pt-1">
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-4 h-1.5 rounded-sm bg-line" />
        {win.earliest_day !== null && win.earliest_day !== undefined && (
          <div
            className="absolute top-4 h-1.5 rounded-sm"
            style={{ left: pos(win.earliest_day), right: win.latest_day === null || win.latest_day === undefined ? 0 : `calc(100% - ${pos(win.latest_day)})`, background: "color-mix(in srgb, var(--color-prepare) 35%, transparent)" }}
            title="P10–P90 range for the start of the shortfall across the assumption ensemble"
          />
        )}
        {win.start_day !== null && end !== null && (
          <div className="absolute top-[13px] h-3 rounded-sm bg-act/85" style={{ left: `${(win.start_day / n) * 100}%`, right: `${100 - ((end + 1) / n) * 100}%` }} title="Central forecast: supply below demand" />
        )}
        {win.start_day !== null && (
          <div className="num absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] text-act" style={{ left: pos(win.start_day) }}>
            {fmtDay(win.start_date)}
          </div>
        )}
        <div className="absolute top-2.5 h-5 w-px bg-fg" style={{ left: pos(day) }} title="Selected timeline day" />
      </div>
      <div className="num flex justify-between text-[9.5px] text-fg-3">
        <span>{fmtDay(sc.dates[0])} today</span>
        <span>
          earliest {win.earliest_date ? fmtDay(win.earliest_date) : "—"} · central {win.start_date ? fmtDay(win.start_date) : "none"} · latest {win.latest_date ? fmtDay(win.latest_date) : "beyond horizon"}
        </span>
        <span>{fmtDay(sc.dates[n - 1])}</span>
      </div>
    </div>
  );
}

export function WarningDetail({ w }: { w: Warning }) {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const color = RISK_COLOR[w.level];
  const win = w.window;
  const zones = w.affected_zones.map((id) => sc.zones.find((z) => z.id === id)).filter(Boolean);
  const maxPts = Math.max(1, ...w.factors.map((f) => Math.abs(f.points ?? 0)));
  const g = sc.guidance[day];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto rounded-md border border-line bg-panel">
      <div className="border-b border-line px-4 py-3" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${color} 9%, transparent), transparent 55%)` }}>
        <div className="flex items-center gap-2.5">
          <RiskChip level={w.level} size="lg" solid />
          <span className="text-[12px] text-fg-2">{RISK_MEANING[w.level]}</span>
          <span className="num ml-auto text-[10.5px] text-fg-3">
            {w.id} · issued {fmtGst(w.issued_at, true)} GST
          </span>
        </div>
        <h1 className="mt-2.5 text-[18px] font-medium leading-snug text-fg">{w.title}</h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-fg-2">{w.summary}</p>
        {w.persistence && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-fg-3">
            <span className="font-mono text-[9.5px] tracking-wide">LAST EVALUATIONS</span>
            {w.persistence.history.map((h, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: RISK_COLOR[h] }} />
                <span className="num text-[10px]">{h}</span>
              </span>
            ))}
            <span className={w.held_back ? "text-watch" : ""}>· {w.persistence.reason}</span>
          </p>
        )}
      </div>

      {day > 0 && (
        <div className="flex items-center gap-2.5 border-b border-line bg-panel-2 px-4 py-2 text-[12px]">
          <span className="font-mono text-[9.5px] tracking-wide text-fg-3">TIMELINE {fmtDay(sc.dates[day]).toUpperCase()} · DAY +{day}</span>
          <RiskChip level={g.level} />
          <span className="truncate text-fg-2">
            <span className="text-fg">{g.headline}.</span> {g.action}
          </span>
        </div>
      )}

      <div className="grid grid-cols-4 divide-x divide-line border-b border-line">
        <Fact label="Affected">
          <div className="text-fg-2">{w.source.name}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {zones.map((z) => (
              <span key={z!.id} className="num rounded-[3px] border px-1.5 py-px text-[11px]" style={{ borderColor: `${RISK_COLOR[z!.risk[day]]}66`, color: RISK_COLOR[z!.risk[day]] }} title={`${z!.name} on ${fmtDay(sc.dates[day])}: ${fmt(z!.ratio.central[day] * 100, 0)}% of demand`}>
                {z!.id} {fmt(z!.ratio.central[day] * 100, 0)}%
              </span>
            ))}
          </div>
        </Fact>
        <Fact label="Predicted shortage window">
          {w.type === "supply_shortfall" ? (
            win.predicted ? (
              <>
                <span className="num" style={{ color }}>
                  {fmtDay(win.start_date)}
                </span>{" "}
                → {win.continues_beyond_horizon ? "beyond 21 days" : fmtDay(win.end_date)}
                <div className="mt-0.5 text-[11px] text-fg-3">starts {inDays(win.lead_days)}</div>
              </>
            ) : (
              <>
                None in the central forecast
                <div className="mt-0.5 text-[11px] text-fg-3">{fmt((win.ensemble_share ?? 0) * 100, 0)}% of ensemble runs fall short within 21 days</div>
              </>
            )
          ) : w.type === "source_recession" ? (
            <>
              <span className="num">{fmt(win.flow_today_lps, 0)}</span> → <span className="num" style={{ color }}>{fmt(win.flow_end_lps, 0)} L/s</span>
              <div className="mt-0.5 text-[11px] text-fg-3">main flow over 21 days</div>
            </>
          ) : (
            <>
              Present now
              <div className="mt-0.5 text-[11px] text-fg-3">continues until repaired</div>
            </>
          )}
        </Fact>
        <Fact label="Severity">
          <span style={{ color }}>{w.level}</span>
          {win.peak_deficit_pct !== undefined && (
            <div className="mt-0.5 text-[11px] text-fg-3">
              peak deficit <span className="num text-fg-2">{fmt(win.peak_deficit_pct, 0)}%</span> of demand · <span className="num text-fg-2">{fmt(win.deficit_m3_total, 0)} m³</span> over 21 days
            </div>
          )}
          {win.margin_today_pct !== undefined && <div className="text-[11px] text-fg-3">margin today <span className="num text-fg-2">{win.margin_today_pct >= 0 ? "+" : ""}{fmt(win.margin_today_pct, 0)}%</span></div>}
        </Fact>
        <Fact label="Confidence">
          <span style={{ color: GRADE_COLOR[w.confidence.grade] }}>{w.confidence.grade}</span>
          <span className="num ml-1.5 text-[11px] text-fg-3">index {w.confidence.index} / 100</span>
          <div className="mt-0.5 text-[10.5px] leading-snug text-fg-3">Data-quality index with reasons below. Not a statistical probability.</div>
        </Fact>
      </div>

      <WindowStrip w={w} />

      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] divide-x divide-line border-t border-line">
        <section className="px-4 py-3">
          <h2 className="label mb-2 text-fg-2">Recommended response</h2>
          <ol className="space-y-2.5">
            {w.actions.map((a) => (
              <li key={a.priority} className="flex gap-3">
                <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10.5px]" style={{ borderColor: `${color}77`, color }}>
                  {a.priority}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] leading-snug text-fg">{a.action}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-fg-3">{a.rationale}</div>
                  <div className="mt-1 font-mono text-[9.5px] uppercase tracking-wide text-fg-3">Owner · <span className="text-sand">{a.owner}</span></div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="divide-y divide-line">
          <section className="px-4 py-3">
            <h2 className="label mb-2 text-fg-2">Main contributing factors</h2>
            <ul className="space-y-2">
              {w.factors.map((f) => (
                <li key={f.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-fg">{f.label}</span>
                    {f.points !== null && (
                      <span className={`num text-[11px] ${f.direction === "adverse" ? "text-prepare" : "text-normal"}`}>
                        {f.direction === "adverse" ? "−" : "+"}
                        {fmt(Math.abs(f.points), 0)} pts of margin
                      </span>
                    )}
                  </div>
                  {f.points !== null && (
                    <div className="mt-1 h-1 rounded-sm bg-line">
                      <div className="h-1 rounded-sm" style={{ width: `${(Math.abs(f.points) / maxPts) * 100}%`, background: f.direction === "adverse" ? "var(--color-prepare)" : "var(--color-normal)" }} />
                    </div>
                  )}
                  <div className="mt-1 text-[11px] leading-snug text-fg-3">{f.detail}</div>
                </li>
              ))}
            </ul>
          </section>
          <section className="px-4 py-3">
            <h2 className="label mb-2 text-fg-2">Why confidence is {w.confidence.grade.toLowerCase()}</h2>
            <ul className="space-y-1.5">
              {w.confidence.factors.map((f) => (
                <li key={f.key} className="flex gap-2.5 text-[11.5px] leading-snug">
                  <span className={`num w-8 shrink-0 text-right ${f.impact < 0 ? "text-prepare" : "text-fg-3"}`}>{f.impact < 0 ? f.impact : f.status === "limit" ? "cap" : "0"}</span>
                  <span className="text-fg-2">
                    <span className="text-fg">{f.label}.</span> {f.detail}
                  </span>
                </li>
              ))}
              {w.confidence.supporting.length > 0 && (
                <li className="flex gap-2.5 text-[11px] leading-snug text-fg-3">
                  <span className="num w-8 shrink-0 text-right text-normal">ok</span>
                  <span>{w.confidence.supporting.map((f) => f.label).join(" · ")}</span>
                </li>
              )}
            </ul>
            <p className="mt-2 text-[10.5px] leading-snug text-fg-3">{data.warnings.persistence_rule}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

export function SmsPreview({ w }: { w: Warning }) {
  const [lang, setLang] = useState<"en" | "ar">("en");
  const queue = useStore((s) => s.data)!.queue;
  const msg = queue.messages.find((m) => m.warning_id === w.id);
  const en = w.sms?.en ?? msg?.body ?? null;
  const ar = w.sms?.ar ?? null;
  const text = lang === "ar" && ar ? ar : en;
  return (
    <Panel
      title="SMS preview"
      right={
        <>
          <span className="font-mono text-[9.5px] tracking-wide text-sand">PREVIEW · NOT SENT</span>
          <div className="flex rounded-[4px] border border-line-2 p-px">
            {(["en", "ar"] as const).map((l) => (
              <button key={l} disabled={l === "ar" && !ar} onClick={() => setLang(l)} className={`rounded-[3px] px-1.5 font-mono text-[9.5px] uppercase leading-[16px] disabled:opacity-30 ${lang === l ? "bg-panel-3 text-fg" : "text-fg-3"}`}>
                {l}
              </button>
            ))}
          </div>
        </>
      }
      className="shrink-0"
      bodyClassName="px-3 py-3"
    >
      {text ? (
        <>
          <div className="num mb-1.5 flex justify-between text-[10px] text-fg-3">
            <span>To: {msg ? `${msg.recipient} ${msg.number}` : "affected operators (simulated)"}</span>
            <span>FALAJLINE</span>
          </div>
          <div dir={lang === "ar" ? "rtl" : "ltr"} className="rounded-xl rounded-bl-sm border border-line-2 bg-panel-3 px-3.5 py-2.5 text-[13px] leading-relaxed text-fg" style={lang === "ar" ? { fontFamily: "system-ui, 'Segoe UI', Tahoma, sans-serif" } : undefined}>
            {text}
          </div>
          <div className="num mt-1.5 flex justify-between text-[10px] text-fg-3">
            <span>
              {text.length} characters · {lang === "ar" ? `${w.sms?.segments_ar ?? "?"} SMS segment(s), Unicode` : `${w.sms?.segments_en ?? Math.ceil(text.length / 160)} SMS segment(s)`}
            </span>
            <span>{w.sms ? "generated from the forecast" : "manager notice"}</span>
          </div>
        </>
      ) : (
        <p className="text-[11.5px] leading-snug text-fg-3">
          No message is sent to farm operators at WATCH. The water manager sees this warning on the dashboard; operators are messaged from PREPARE upward.
        </p>
      )}
    </Panel>
  );
}

const GROUP_COLOR: Record<QueueMessage["group"], string> = {
  pending: "var(--color-fg-2)",
  retrying: "var(--color-watch)",
  delivered: "var(--color-normal)",
  failed: "var(--color-act)",
};

/** Simulated store-and-forward queue. Polls the backend while this view is open. */
export function DeliveryQueue({ selected }: { selected: string | null }) {
  const queue = useStore((s) => s.data)!.queue;
  const setQueue = useStore((s) => s.setQueue);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/alerts/queue", { cache: "no-store" });
        if (r.ok && alive) setQueue((await r.json()) as Queue);
      } catch {
        /* keep the last known queue */
      }
    };
    void poll();
    const id = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setQueue]);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (r.ok) setQueue((await r.json()) as Queue);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Delivery queue"
      right={
        <>
          <ProvTag kind="simulated" short />
          <button disabled={busy} onClick={() => void post("/api/alerts/queue/redispatch")} className="font-mono text-[9.5px] tracking-wide text-fg-3 hover:text-fg-2">
            RE-DISPATCH
          </button>
        </>
      }
      className="min-h-0 flex-1"
      bodyClassName="flex min-h-0 flex-col"
    >
      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] text-fg-2">Field gateway link</span>
          <button
            disabled={busy}
            onClick={() => void post("/api/alerts/queue/link", { online: !queue.link_online })}
            className="ml-auto flex items-center gap-2 rounded-[4px] border px-2 py-0.5 font-mono text-[10px] tracking-wide"
            style={{ borderColor: queue.link_online ? "color-mix(in srgb, var(--color-normal) 45%, transparent)" : "color-mix(in srgb, var(--color-act) 55%, transparent)", color: queue.link_online ? "var(--color-normal)" : "var(--color-act)" }}
            title="Toggle the simulated link to see store-and-forward behaviour"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
            {queue.link_online ? "ONLINE" : "OFFLINE"} · toggle
          </button>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {(["pending", "retrying", "delivered", "failed"] as const).map((g) => (
            <div key={g} className="rounded-[4px] border border-line px-2 py-1">
              <div className="num text-[16px] leading-none" style={{ color: queue.counts[g] ? GROUP_COLOR[g] : "var(--color-fg-4)" }}>
                {queue.counts[g]}
              </div>
              <div className="mt-1 font-mono text-[9px] uppercase tracking-wide text-fg-3">{g}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-fg-3">{queue.note}</p>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {queue.messages.map((m) => (
          <li key={m.id} className={`border-b border-line/70 px-3 py-2 ${m.warning_id === selected ? "bg-panel-2" : ""}`}>
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.group === "pending" || m.group === "retrying" ? "pulse" : ""}`} style={{ background: GROUP_COLOR[m.group], color: GROUP_COLOR[m.group] }} />
              <span className="truncate text-[11.5px] text-fg">{m.recipient}</span>
              <span className="num ml-auto shrink-0 text-[10px] text-fg-3">{m.number}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 pl-3.5">
              <span className="num text-[10.5px]" style={{ color: GROUP_COLOR[m.group] }}>
                {m.status_label}
              </span>
              <span className="num ml-auto text-[10px] text-fg-3">
                {m.warning_id.replace("W-", "")} · {m.delivered_at ? `delivered ${fmtGst(m.delivered_at)}` : `queued ${fmtGst(m.created_at)}`}
              </span>
              {m.group === "failed" && (
                <button disabled={busy} onClick={() => void post(`/api/alerts/queue/retry/${encodeURIComponent(m.id)}`)} className="rounded-[3px] border border-line-2 px-1.5 font-mono text-[9.5px] leading-[16px] tracking-wide text-fg-2 hover:border-water hover:text-water">
                  RETRY
                </button>
              )}
            </div>
            <div className="num mt-0.5 truncate pl-3.5 text-[10px] text-fg-4" title={m.history.map((h) => `${fmtGst(h.t)} ${h.event}`).join("\n")}>
              {m.history[m.history.length - 1]?.event}
            </div>
          </li>
        ))}
        {queue.messages.length === 0 && <li className="px-3 py-4 text-[11.5px] text-fg-3">Nothing queued: no warning is at PREPARE or ACT.</li>}
      </ul>
    </Panel>
  );
}
