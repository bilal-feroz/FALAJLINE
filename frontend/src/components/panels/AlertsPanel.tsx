"use client";

import { useEffect, useState } from "react";
import { GRADE_COLOR, RISK_COLOR, RISK_MEANING, fmt, fmtDay, fmtGst, fmtLong, inDays } from "@/lib/format";
import { groupOf, statusText } from "@/lib/queue";
import { useScenario, useStore } from "@/lib/store";
import type { Warning } from "@/lib/types";
import { Eyebrow, Prov, Risk } from "../ui";

const TYPE: Record<Warning["type"], string> = { supply_shortfall: "Zone supply", source_recession: "Source", branch_anomaly: "Channel" };

function when(w: Warning): string {
  if (w.type === "supply_shortfall") return w.window.predicted ? inDays(w.window.lead_days) : "margin eroding";
  return w.type === "branch_anomaly" ? "now" : "under way";
}

function WindowStrip({ w }: { w: Warning }) {
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const n = sc.dates.length;
  const x = (d: number) => `${((d + 0.5) / n) * 100}%`;
  const win = w.window;
  if (w.type !== "supply_shortfall") return null;
  const end = win.continues_beyond_horizon ? n - 1 : win.end_date ? sc.dates.indexOf(win.end_date) : null;
  return (
    <div className="mt-4">
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-3 h-1 rounded-full bg-ink/10" />
        {win.earliest_day !== null && win.earliest_day !== undefined && (
          <div className="absolute top-3 h-1 rounded-full bg-prepare/45" style={{ left: x(win.earliest_day), right: win.latest_day === null || win.latest_day === undefined ? 0 : `calc(100% - ${x(win.latest_day)})` }} />
        )}
        {win.start_day !== null && end !== null && <div className="absolute top-2 h-3 rounded-full bg-act" style={{ left: `${(win.start_day / n) * 100}%`, right: `${100 - ((end + 1) / n) * 100}%` }} />}
        <div className="absolute top-0.5 h-6 w-px bg-ink" style={{ left: x(day) }} />
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-ink-3">
        <span>{fmtDay(sc.dates[0])}</span>
        <span>
          earliest {win.earliest_date ? fmtDay(win.earliest_date) : "—"} · central {win.start_date ? fmtDay(win.start_date) : "none"} · latest {win.latest_date ? fmtDay(win.latest_date) : "beyond"}
        </span>
        <span>{fmtDay(sc.dates[n - 1])}</span>
      </div>
    </div>
  );
}

function useNow(ms: number) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [ms]);
  return now;
}

function Sms({ w }: { w: Warning }) {
  const [lang, setLang] = useState<"en" | "ar">("en");
  const queue = useStore((s) => s.queue);
  const setLink = useStore((s) => s.setLink);
  const retry = useStore((s) => s.retry);
  const resetQueue = useStore((s) => s.resetQueue);
  const now = useNow(500);
  const msgs = queue.messages.filter((m) => m.warningId === w.id);
  const text = lang === "ar" && w.sms?.ar ? w.sms.ar : w.sms?.en;
  const all = queue.messages;
  const counts = { pending: 0, retrying: 0, delivered: 0, failed: 0 };
  all.forEach((m) => counts[groupOf(m)]++);
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <Eyebrow>Message to farm operators</Eyebrow>
        <div className="flex items-center gap-1 rounded-full bg-ink/[0.06] p-0.5">
          {(["en", "ar"] as const).map((l) => (
            <button key={l} disabled={l === "ar" && !w.sms?.ar} onClick={() => setLang(l)} className={`rounded-full px-2 font-mono text-[11px] uppercase leading-[18px] disabled:opacity-30 ${lang === l ? "bg-ink text-cream" : "text-ink-3"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {text ? (
        <div dir={lang === "ar" ? "rtl" : "ltr"} className="rounded-[18px] rounded-bl-md bg-ink px-4 py-3 text-[14.5px] leading-relaxed text-cream" style={lang === "ar" ? { fontFamily: "system-ui, 'Segoe UI', Tahoma, sans-serif" } : undefined}>
          {text}
        </div>
      ) : (
        <p className="text-[13.5px] leading-snug text-ink-3">Operators are messaged from Prepare upward. At Watch this stays on the water manager&apos;s screen.</p>
      )}
      <div className="mt-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
          <Prov kind="simulated" /> Delivery queue · nothing is sent
        </span>
        <button onClick={() => setLink(!queue.online)} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.12em]" style={{ color: queue.online ? "#7d9a5c" : "#c2432b", boxShadow: `inset 0 0 0 1px ${queue.online ? "#7d9a5c55" : "#c2432b66"}` }}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Gateway {queue.online ? "online" : "offline"}
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {msgs.map((m) => {
          const g = groupOf(m);
          const color = g === "delivered" ? "#7d9a5c" : g === "failed" ? "#c2432b" : g === "retrying" ? "#c4972f" : "#3b342a";
          return (
            <li key={m.id} className="flex items-center gap-2.5 rounded-xl bg-ink/[0.04] px-3 py-2">
              <span className={`relative h-1.5 w-1.5 rounded-full ${g === "pending" || g === "retrying" ? "ping" : ""}`} style={{ background: color, color }} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{m.recipient}</span>
              <span className="num text-[12px]" style={{ color }}>
                {statusText(m, now)}
              </span>
              {m.status === "failed" && (
                <button onClick={() => retry(m.id)} className="rounded-full px-2 font-mono text-[10.5px] uppercase leading-[18px] tracking-[0.12em] text-ink ring-1 ring-ink/30 hover:bg-ink/10">
                  Retry
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="num mt-2 flex items-center gap-3 text-[11.5px] text-ink-3">
        <span>all: {counts.delivered} delivered</span>
        <span>{counts.pending} pending</span>
        <span>{counts.retrying} retrying</span>
        <span className={counts.failed ? "text-act" : ""}>{counts.failed} failed</span>
        <button onClick={resetQueue} className="ml-auto uppercase tracking-[0.12em] hover:text-ink">
          Re-send
        </button>
      </div>
    </div>
  );
}

function Detail({ w }: { w: Warning }) {
  const data = useStore((s) => s.data)!;
  const sc = useScenario()!;
  const day = useStore((s) => s.day);
  const color = RISK_COLOR[w.level];
  const maxPts = Math.max(1, ...w.factors.map((f) => Math.abs(f.points ?? 0)));
  const win = w.window;
  return (
    <div className="px-5 pb-6 pt-4 fade" key={w.id}>
      <div className="flex items-center gap-2">
        <Risk level={w.level} size="md" />
        <span className="text-[13px] text-ink-3">{RISK_MEANING[w.level]}</span>
      </div>
      <h3 className="display mt-3 text-[25px] leading-[1.1] text-ink">{w.title.replace(/^Z\d /, "")}</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-2">{w.summary}</p>

      <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-ink/[0.07]">
        <div className="bg-cream-2/80 px-3 py-2.5">
          <Eyebrow>Window</Eyebrow>
          <div className="mt-1.5 text-[14px] text-ink">
            {w.type === "supply_shortfall" ? (win.predicted ? <>{fmtDay(win.start_date)} → {win.continues_beyond_horizon ? "beyond" : fmtDay(win.end_date)}</> : "none central") : w.type === "source_recession" ? <>{fmt(win.flow_today_lps, 0)} → {fmt(win.flow_end_lps, 0)} L/s</> : "now"}
          </div>
        </div>
        <div className="bg-cream-2/80 px-3 py-2.5">
          <Eyebrow>Severity</Eyebrow>
          <div className="mt-1.5 text-[14px]" style={{ color }}>
            {win.peak_deficit_pct !== undefined ? `−${fmt(win.peak_deficit_pct, 0)}% at worst` : w.level}
          </div>
        </div>
        <div className="bg-cream-2/80 px-3 py-2.5">
          <Eyebrow>Confidence</Eyebrow>
          <div className="mt-1.5 text-[14px]" style={{ color: GRADE_COLOR[w.confidence.grade] }}>
            {w.confidence.index} · {w.confidence.grade.toLowerCase()}
          </div>
        </div>
      </div>
      <WindowStrip w={w} />

      <div className="mt-5">
        <Eyebrow>Recommended response</Eyebrow>
        <ol className="mt-2.5 space-y-3">
          {w.actions.map((a) => (
            <li key={a.priority} className="flex gap-3">
              <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11.5px] text-cream" style={{ background: a.priority === 1 ? color : "#3b342a" }}>
                {a.priority}
              </span>
              <div className="min-w-0">
                <div className="text-[14px] leading-snug text-ink">{a.action}</div>
                <div className="mt-1 text-[12.5px] leading-snug text-ink-3">{a.rationale}</div>
                <div className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-beige">{a.owner}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="mt-5">
        <Eyebrow>Why · contributing factors</Eyebrow>
        <ul className="mt-2.5 space-y-2.5">
          {w.factors.map((f) => (
            <li key={f.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13.5px] text-ink">{f.label}</span>
                {f.points !== null && (
                  <span className={`num text-[12px] ${f.direction === "adverse" ? "text-prepare" : "text-ok"}`}>
                    {f.direction === "adverse" ? "−" : "+"}
                    {fmt(Math.abs(f.points), 0)} pts
                  </span>
                )}
              </div>
              {f.points !== null && (
                <div className="mt-1 h-[3px] rounded-full bg-ink/[0.08]">
                  <div className="h-[3px] rounded-full" style={{ width: `${(Math.abs(f.points) / maxPts) * 100}%`, background: f.direction === "adverse" ? "#d0772c" : "#7d9a5c" }} />
                </div>
              )}
              <div className="mt-1 text-[12.5px] leading-snug text-ink-3">{f.detail}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5">
        <Eyebrow>Confidence {w.confidence.index} · reasons</Eyebrow>
        <ul className="mt-2 space-y-1.5">
          {w.confidence.factors.map((f) => (
            <li key={f.key} className="flex gap-2.5 text-[13px] leading-snug">
              <span className={`num w-7 shrink-0 text-right ${f.impact < 0 ? "text-prepare" : "text-ink-3"}`}>{f.impact < 0 ? f.impact : f.status === "limit" ? "cap" : "0"}</span>
              <span className="text-ink-3">
                <span className="text-ink-2">{f.label}.</span> {f.detail}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-snug text-ink-4">{data.warnings.persistence_rule}</p>
      </div>

      <Sms w={w} />
      {day > 0 && <p className="mt-4 text-[12.5px] text-ink-3">Timeline at {fmtLong(sc.dates[day])}: {sc.guidance[day].headline}.</p>}
    </div>
  );
}

export function AlertsPanel() {
  const data = useStore((s) => s.data)!;
  const alertId = useStore((s) => s.alertId);
  const setAlertId = useStore((s) => s.setAlertId);
  const select = useStore((s) => s.select);
  const flyTo = useStore((s) => s.flyTo);
  const ws = data.warnings.warnings;
  const current = ws.find((w) => w.id === alertId) ?? ws[0] ?? null;

  // point the twin at what the warning is about
  useEffect(() => {
    if (!current) return;
    if (current.type === "supply_shortfall") {
      select({ type: "zone", id: current.affected_zones[0] }, false);
      flyTo("zone", current.affected_zones[0]);
    } else if (current.type === "source_recession") {
      select(null, false);
      flyTo("source");
    } else {
      select(null, false);
      flyTo("oasis");
    }
    // follow the selected warning only, not every data refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  return (
    <aside className="glass pointer-events-auto absolute bottom-[104px] right-4 top-[76px] z-20 flex w-[476px] flex-col overflow-hidden rise">
      <div className="px-5 pb-3 pt-5">
        <div className="flex items-center justify-between">
          <Eyebrow>Warnings · issued {fmtGst(data.warnings.issued_at)} GST</Eyebrow>
          <span className="num text-[11.5px] text-ink-3">
            {data.warnings.counts.ACT} act · {data.warnings.counts.PREPARE} prepare · {data.warnings.counts.WATCH} watch
          </span>
        </div>
        <ul className="mt-3 max-h-[188px] space-y-0.5 overflow-y-auto pr-1">
          {ws.map((w) => {
            const on = w.id === current?.id;
            return (
              <li key={w.id}>
                <button onClick={() => setAlertId(w.id)} className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors ${on ? "bg-ink/[0.1]" : "hover:bg-ink/[0.05]"}`}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: RISK_COLOR[w.level] }} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{w.title.split(":")[0]}</span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{TYPE[w.type]}</span>
                  <span className="num w-[72px] text-right text-[12px] text-ink-2">{when(w)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t hairline">{current ? <Detail w={current} /> : <p className="p-5 text-[14px] text-ink-3">No active warnings.</p>}</div>
      {data.warnings.notices.length > 0 && (
        <div className="border-t hairline px-5 py-2.5 text-[12.5px] text-ink-3">
          <span className="text-ink-2">{data.warnings.notices.length} data notices:</span> {data.warnings.notices.map((n) => n.sensor).join(", ")} · readings shown as missing, never as zero
        </div>
      )}
    </aside>
  );
}
