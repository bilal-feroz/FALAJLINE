import type { Grade, RiskLevel, SensorStatus } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Parse a YYYY-MM-DD date without letting the browser's timezone shift it. */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseDay(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtWeekday(iso: string): string {
  return WEEKDAYS[parseDay(iso).getUTCDay()];
}

/** Clock time in Gulf Standard Time (UTC+4), independent of where the browser is. */
export function fmtGst(iso: string | number | null | undefined, withDate = false): string {
  if (iso === null || iso === undefined) return "—";
  const t = typeof iso === "number" ? iso * 1000 : Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const d = new Date(t + 4 * 3600 * 1000);
  const hm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return withDate ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hm}` : hm;
}

export function fmt(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtAge(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "no data";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} d`;
}

export function inDays(n: number | null | undefined): string {
  if (n === null || n === undefined) return "beyond 21 days";
  if (n === 0) return "today";
  return n === 1 ? "in 1 day" : `in ${n} days`;
}

export const RISK_COLOR: Record<RiskLevel, string> = {
  NORMAL: "#36c3b5",
  WATCH: "#d6b65c",
  PREPARE: "#f08d32",
  ACT: "#e5484d",
};

export const RISK_ORDER: Record<RiskLevel, number> = { NORMAL: 0, WATCH: 1, PREPARE: 2, ACT: 3 };

export const RISK_MEANING: Record<RiskLevel, string> = {
  NORMAL: "Supply covers demand",
  WATCH: "Deterioration is emerging",
  PREPARE: "A shortfall is becoming plausible",
  ACT: "Supply is likely to fall below the requirement",
};

export const STATUS_COLOR: Record<SensorStatus, string> = {
  ok: "#36c3b5",
  stale: "#d6b65c",
  offline: "#e5484d",
  stuck: "#f08d32",
};

export const GRADE_COLOR: Record<Grade, string> = {
  HIGH: "#36c3b5",
  MODERATE: "#d6b65c",
  LOW: "#f08d32",
};

export const WATER = "#36c3b5";
export const WATER_2 = "#4ea9d8";
export const SAND = "#cdb88c";
