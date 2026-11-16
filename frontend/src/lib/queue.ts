import type { Warning } from "./types";

/**
 * SIMULATED store-and-forward delivery queue, run in the browser.
 * No SMS provider is configured and nothing leaves the machine. Messages wait while the gateway link is down,
 * attempts can fail, failures are retried with backoff and give up after three attempts. Outcomes are
 * deterministic so a demo or a recording is repeatable.
 */

export type MsgStatus = "queued" | "sending" | "retry_wait" | "delivered" | "failed";

export interface Msg {
  id: string;
  warningId: string;
  level: Warning["level"];
  recipient: string;
  number: string;
  body: string;
  bodyAr: string | null;
  status: MsgStatus;
  attempts: number;
  nextAt: number;
  deliveredAt: number | null;
  error: string | null;
  waitingForLink: boolean;
  plan: "ok" | "transient" | "unreachable";
  manual: boolean;
  log: { t: number; event: string }[];
}

export interface QueueState {
  online: boolean;
  messages: Msg[];
}

const ATTEMPT_MS = 2200;
const STAGGER_MS = 900;
const BACKOFF_MS = [5000, 10000];
export const MAX_ATTEMPTS = 3;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function recipients(w: Warning): [string, string][] {
  const num = (seed: string) => `+971 5• ••• ••${String(hash(seed) % 100).padStart(2, "0")}`;
  if (w.type === "supply_shortfall") {
    const z = w.affected_zones[0];
    const out: [string, string][] = [[`${z} farm operators`, num(z)]];
    if (w.level === "ACT") out.push(["Oasis water manager", num("manager")]);
    return out;
  }
  return [["Maintenance duty phone", num("maintenance")]];
}

export function syncQueue(q: QueueState, warnings: Warning[], now: number): QueueState {
  const known = new Set(q.messages.map((m) => m.id));
  const added: Msg[] = [];
  for (const w of warnings) {
    if (w.level !== "PREPARE" && w.level !== "ACT") continue;
    for (const [name, number] of recipients(w)) {
      const id = `${w.id}:${w.level}:${name}`;
      if (known.has(id)) continue;
      const idx = q.messages.length + added.length;
      added.push({
        id,
        warningId: w.id,
        level: w.level,
        recipient: name,
        number,
        body: w.sms?.en ?? `FALAJLINE ${w.level}: ${w.title}.`,
        bodyAr: w.sms?.ar ?? null,
        status: "queued",
        attempts: 0,
        nextAt: now + 800 + added.length * STAGGER_MS,
        deliveredAt: null,
        error: null,
        waitingForLink: false,
        plan: idx % 5 === 2 ? "unreachable" : idx % 5 === 4 ? "transient" : "ok",
        manual: false,
        log: [{ t: now, event: "Queued" }],
      });
    }
  }
  return added.length ? { ...q, messages: [...q.messages, ...added] } : q;
}

export function stepQueue(q: QueueState, now: number): QueueState {
  let changed = false;
  const messages = q.messages.map((orig) => {
    const m = { ...orig, log: orig.log };
    let guard = 0;
    while ((m.status === "queued" || m.status === "retry_wait" || m.status === "sending") && m.nextAt <= now && guard++ < 10) {
      changed = true;
      if (m.status !== "sending") {
        if (!q.online) {
          if (!m.waitingForLink) m.log = [...m.log, { t: now, event: "Gateway link down: holding" }];
          m.waitingForLink = true;
          m.nextAt = now + 400;
          break;
        }
        if (m.waitingForLink) m.log = [...m.log, { t: now, event: "Gateway link restored" }];
        m.waitingForLink = false;
        m.attempts += 1;
        m.status = "sending";
        m.nextAt = Math.max(m.nextAt, now - 50) + ATTEMPT_MS;
        m.log = [...m.log, { t: now, event: `Attempt ${m.attempts} of ${MAX_ATTEMPTS}` }];
      } else {
        if (!q.online) {
          m.attempts -= 1;
          m.status = "queued";
          m.waitingForLink = true;
          m.nextAt = now + 400;
          m.log = [...m.log, { t: now, event: "Link lost during send: kept in queue" }];
          break;
        }
        const ok = m.manual || m.plan === "ok" || (m.plan === "transient" && m.attempts >= 2);
        if (ok) {
          m.status = "delivered";
          m.deliveredAt = m.nextAt;
          m.error = null;
          m.log = [...m.log, { t: m.nextAt, event: "Delivered (simulated handset receipt)" }];
        } else {
          m.error = m.plan === "unreachable" ? "Handset unreachable" : "Network timeout";
          if (m.attempts >= MAX_ATTEMPTS) {
            m.status = "failed";
            m.log = [...m.log, { t: m.nextAt, event: `Failed after ${m.attempts} attempts` }];
          } else {
            const wait = BACKOFF_MS[Math.min(m.attempts - 1, BACKOFF_MS.length - 1)];
            m.status = "retry_wait";
            m.log = [...m.log, { t: m.nextAt, event: `${m.error}: retry in ${wait / 1000} s` }];
            m.nextAt = m.nextAt + wait;
          }
        }
      }
    }
    return m;
  });
  return changed ? { ...q, messages } : q;
}

export function retryMessage(q: QueueState, id: string, now: number): QueueState {
  return {
    ...q,
    messages: q.messages.map((m) =>
      m.id === id && m.status === "failed"
        ? { ...m, status: "queued", attempts: 0, nextAt: now + 600, error: null, manual: true, log: [...m.log, { t: now, event: "Manual retry" }] }
        : m,
    ),
  };
}

export function groupOf(m: Msg): "pending" | "retrying" | "delivered" | "failed" {
  if (m.status === "delivered" || m.status === "failed") return m.status;
  return m.status === "retry_wait" ? "retrying" : "pending";
}

export function statusText(m: Msg, now: number): string {
  switch (m.status) {
    case "queued":
      return m.waitingForLink ? "Held · gateway offline" : "Queued";
    case "sending":
      return `Sending · attempt ${m.attempts}/${MAX_ATTEMPTS}`;
    case "retry_wait":
      return `Retry ${m.attempts + 1}/${MAX_ATTEMPTS} in ${Math.max(0, Math.ceil((m.nextAt - now) / 1000))} s`;
    case "delivered":
      return "Delivered";
    case "failed":
      return `Failed · ${m.error}`;
  }
}
