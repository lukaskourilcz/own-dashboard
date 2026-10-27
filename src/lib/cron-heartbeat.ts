import type { Cron } from "@/lib/types";

/**
 * Freshness of one cron, derived from its own schedule and its last recorded
 * success. Pure and deterministic: no clock of its own, no network, no service.
 *
 *   unmonitored — disabled, or nothing to judge it by yet
 *   unknown     — clock or recorded timestamp cannot be assessed
 *   never       — monitored but it has not reported a single success
 *   ok          — reported within one expected interval (plus slack)
 *   late        — one to three intervals behind
 *   stale       — no recorded success for more than three estimated gaps
 */
export type CronHeartbeatState = "ok" | "late" | "stale" | "never" | "unmonitored" | "unknown";

export type CronHeartbeatResult = {
  state: CronHeartbeatState;
  lastSuccessAt: Date | null;
  /** Conservative usual gap between runs; an estimate, not scheduler proof. */
  intervalMs: number;
  /** How far past the expected interval the last success is; 0 when on time. */
  overdueByMs: number;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;

/** Above one interval is "late"; above this many is "stale". */
const STALE_INTERVALS = 3;
/** A run never lands exactly on its tick, so one interval gets this much slack. */
const OK_INTERVALS = 1.5;

/**
 * The longest usual gap for the supported schedule shapes.
 *
 * This reads the handful of 5-field shapes the cron form actually produces —
 * it is not a scheduler or timezone oracle. Anything it does not
 * recognize falls back to the row's own `runs_per_month`, which the owner sets
 * for the cost estimate anyway, so an exotic expression degrades to a coarser
 * interval instead of a wrong verdict.
 */
export function expectedIntervalMs(
  cron: Pick<Cron, "schedule" | "runs_per_month">,
): number {
  const frequency = Number.isFinite(cron.runs_per_month) && cron.runs_per_month > 0 ? cron.runs_per_month : 1;
  const fallback = Math.max(MINUTE, MONTH / Math.max(1, frequency));
  if (typeof cron.schedule !== "string" || cron.schedule.length > 256) return fallback;
  const fields = cron.schedule.trim().split(/\s+/);
  if (fields.length !== 5) return fallback;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const everyDate = dayOfMonth === "*" && month === "*" && dayOfWeek === "*";

  // A step in the minute field, e.g. */15 * * * * — every 15 minutes.
  const minuteStep = stepOf(minute);
  if (everyDate && minuteStep !== null && minuteStep <= 59 && hour === "*") return minuteStep * MINUTE;
  if (everyDate && minute === "*" && hour === "*") return MINUTE;

  // A step in the hour field, e.g. 0 */4 * * * — every 4 hours.
  const hourStep = stepOf(hour);
  if (everyDate && isFixed(minute) && hourStep !== null && hourStep <= 23) return hourStep * HOUR;
  if (everyDate && isFixed(minute) && hour === "*") return HOUR;

  // From here the time of day is fixed, so the date fields set the period.
  if (!isFixed(minute) || !isFixed(hour, 0, 23)) return fallback;
  if (month !== "*") return fallback;

  // Daily: 0 6 * * *
  if (dayOfMonth === "*" && dayOfWeek === "*") return DAY;
  // Weekly: 0 7 * * 0 — or a list of weekdays, e.g. 0 7 * * 1-5.
  if (dayOfMonth === "*") {
    const days = longestWeekdayGap(dayOfWeek);
    return days > 0 ? days * DAY : fallback;
  }
  // Monthly: 0 7 1 * *
  if (dayOfWeek === "*" && isFixed(dayOfMonth, 1, 31)) {
    const date = Number(dayOfMonth);
    // Dates 29–31 can skip February/short months. Never use an average here.
    return (date <= 28 ? 31 : date === 29 ? 59 : date === 30 ? 60 : 61) * DAY;
  }

  return fallback;
}

/**
 * The heartbeat verdict for one cron. `now` is injected so callers (and tests)
 * stay deterministic.
 */
export function cronHeartbeatState(
  cron: Pick<
    Cron,
    "schedule" | "runs_per_month" | "enabled" | "heartbeat_url" | "last_success_at"
  >,
  now: Date = new Date(),
): CronHeartbeatResult {
  const intervalMs = expectedIntervalMs(cron);
  const parsed = cron.last_success_at ? new Date(cron.last_success_at) : null;
  const lastSuccessAt =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;

  // A disabled cron is not expected to run, so it is not late — reporting it as
  // broken would train the owner to ignore the badge.
  if (!cron.enabled) {
    return { state: "unmonitored", lastSuccessAt, intervalMs, overdueByMs: 0 };
  }

  const clock = now.getTime();
  if (!Number.isFinite(clock) || (cron.last_success_at && (!lastSuccessAt || lastSuccessAt.getTime() > clock + 5 * MINUTE))) {
    return { state: "unknown", lastSuccessAt, intervalMs, overdueByMs: 0 };
  }

  const monitored = cron.heartbeat_url.trim() !== "";
  if (!lastSuccessAt) {
    return {
      state: monitored ? "never" : "unmonitored",
      lastSuccessAt: null,
      intervalMs,
      overdueByMs: 0,
    };
  }

  const ageMs = Math.max(0, clock - lastSuccessAt.getTime());
  const overdueByMs = Math.max(0, ageMs - intervalMs);
  if (ageMs <= intervalMs * OK_INTERVALS) {
    return { state: "ok", lastSuccessAt, intervalMs, overdueByMs };
  }
  if (ageMs <= intervalMs * STALE_INTERVALS) {
    return { state: "late", lastSuccessAt, intervalMs, overdueByMs };
  }
  return { state: "stale", lastSuccessAt, intervalMs, overdueByMs };
}

/** Crons of one project whose heartbeat has stopped entirely. */
export function staleCronCount(
  crons: Array<
    Pick<
      Cron,
      | "schedule"
      | "runs_per_month"
      | "enabled"
      | "heartbeat_url"
      | "last_success_at"
    >
  >,
  now: Date = new Date(),
): number {
  return crons.filter((cron) => cronHeartbeatState(cron, now).state === "stale")
    .length;
}

/* ---- inbound Uptime Kuma notifications ----------------------------------- */

/** Confirmed transition facts from a default Kuma webhook. */
export type UptimeKumaEvent = {
  monitorId: number;
  monitor: string;
  observedAt: string;
  down: boolean;
};

/** Default Kuma webhook facts only. Its raw heartbeat time is UTC, while
 * pending/maintenance/test notifications do not prove either transition.
 * Never retain the vendor monitor options or free-form diagnostic message. */
export function parseUptimeKumaEvent(body: unknown, now = Date.now()): UptimeKumaEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Number.isFinite(now)) return null;
  const payload = body as Record<string, unknown>;
  if (!payload.monitor || typeof payload.monitor !== "object" || Array.isArray(payload.monitor) ||
      !payload.heartbeat || typeof payload.heartbeat !== "object" || Array.isArray(payload.heartbeat)) return null;
  const monitor = payload.monitor as Record<string, unknown>, heartbeat = payload.heartbeat as Record<string, unknown>;
  const id = monitor.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 ||
      (heartbeat.monitorID !== undefined && heartbeat.monitorID !== id) ||
      (heartbeat.status !== 0 && heartbeat.status !== 1) || typeof heartbeat.time !== "string") return null;
  // Kuma serializes YYYY-MM-DD HH:mm:ss.SSS in UTC. Also accept explicit UTC ISO.
  const time = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z)?$/.exec(heartbeat.time);
  if (!time || time[0] !== heartbeat.time || time[1].startsWith("0000") || (heartbeat.time.includes("T") && !time[4]) || (!heartbeat.time.includes("T") && time[4])) return null;
  const observedAt = `${time[1]}T${time[2]}.${(time[3] ?? "").padEnd(3, "0")}Z`;
  const stamp = Date.parse(observedAt);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString() !== observedAt || stamp > now + 300_000) return null;
  const name = typeof monitor.name === "string" ? monitor.name.trim().slice(0, 200).replace(/[\uD800-\uDBFF]$/u, '') : "";
  if (!name.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(name)) return null;
  return {monitorId: id, monitor: name || `Monitor ${id}`, observedAt, down: heartbeat.status === 0};
}

/* ---- field helpers ------------------------------------------------------- */

function isFixed(field: string, min = 0, max = 59): boolean {
  return /^\d+$/.test(field) && Number(field) >= min && Number(field) <= max;
}

/** The N of a star-slash-N step field, or null when the field is not one. */
function stepOf(field: string): number | null {
  const match = /^\*\/(\d+)$/.exec(field);
  if (!match) return null;
  const step = Number(match[1]);
  return Number.isFinite(step) && step > 0 ? step : null;
}

/** Largest gap across a selected weekday set, including the week boundary. */
function longestWeekdayGap(field: string): number {
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || from < 0 || to > 7) return 0;
      for (let day = from; day <= to; day++) days.add(day % 7);
      continue;
    }
    if (!isFixed(part, 0, 7)) return 0;
    days.add(Number(part) % 7);
  }
  const ordered = [...days].sort((a, b) => a - b);
  let largest = 0;
  for (let index = 0; index < ordered.length; index++) {
    const next = index + 1 < ordered.length ? ordered[index + 1] : ordered[0] + 7;
    largest = Math.max(largest, next - ordered[index]);
  }
  return largest;
}
