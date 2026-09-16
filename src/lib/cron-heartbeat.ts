import type { Cron } from "@/lib/types";

/**
 * Freshness of one cron, derived from its own schedule and its last recorded
 * success. Pure and deterministic: no clock of its own, no network, no service.
 *
 *   unmonitored — disabled, or nothing to judge it by yet
 *   never       — monitored but it has not reported a single success
 *   ok          — reported within one expected interval (plus slack)
 *   late        — one to three intervals behind
 *   stale       — more than three intervals behind; treat as broken
 */
export type CronHeartbeatState = "ok" | "late" | "stale" | "never" | "unmonitored";

export type CronHeartbeatResult = {
  state: CronHeartbeatState;
  lastSuccessAt: Date | null;
  /** Expected gap between two runs, in milliseconds. */
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
 * How long we expect to wait between two runs of `schedule`.
 *
 * This reads the handful of 5-field shapes the cron form actually produces —
 * it is not a cron parser and does not pretend to be one. Anything it does not
 * recognize falls back to the row's own `runs_per_month`, which the owner sets
 * for the cost estimate anyway, so an exotic expression degrades to a coarser
 * interval instead of a wrong verdict.
 */
export function expectedIntervalMs(
  cron: Pick<Cron, "schedule" | "runs_per_month">,
): number {
  const fields = cron.schedule.trim().split(/\s+/);
  const fallback = MONTH / Math.max(1, Number(cron.runs_per_month) || 1);
  if (fields.length !== 5) return fallback;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  // A step in the minute field, e.g. */15 * * * * — every 15 minutes.
  const minuteStep = stepOf(minute);
  if (minuteStep !== null && hour === "*") return minuteStep * MINUTE;
  if (minute === "*" && hour === "*") return MINUTE;

  // A step in the hour field, e.g. 0 */4 * * * — every 4 hours.
  const hourStep = stepOf(hour);
  if (isFixed(minute) && hourStep !== null) return hourStep * HOUR;
  if (isFixed(minute) && hour === "*") return HOUR;

  // From here the time of day is fixed, so the date fields set the period.
  if (!isFixed(minute) || !isFixed(hour)) return fallback;
  if (month !== "*") return fallback;

  // Daily: 0 6 * * *
  if (dayOfMonth === "*" && dayOfWeek === "*") return DAY;
  // Weekly: 0 7 * * 0 — or a list of weekdays, e.g. 0 7 * * 1-5.
  if (dayOfMonth === "*") {
    const days = countDayOfWeek(dayOfWeek);
    return days > 0 ? (7 * DAY) / days : fallback;
  }
  // Monthly: 0 7 1 * *
  if (dayOfWeek === "*" && isFixed(dayOfMonth)) return MONTH;

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

  const monitored = cron.heartbeat_url.trim() !== "";
  if (!lastSuccessAt) {
    return {
      state: monitored ? "never" : "unmonitored",
      lastSuccessAt: null,
      intervalMs,
      overdueByMs: 0,
    };
  }

  const ageMs = now.getTime() - lastSuccessAt.getTime();
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

/** The Kuma webhook body, as far as we rely on it. Every field is optional. */
export type UptimeKumaPayload = {
  heartbeat?: { status?: unknown; time?: unknown; msg?: unknown };
  monitor?: { id?: unknown; name?: unknown };
  msg?: unknown;
};

export type UptimeKumaEvent = {
  /** The monitor's name, or `Monitor <id>` when it sent no name. */
  monitor: string;
  down: boolean;
  message: string;
};

/**
 * Read the fields the receiver relies on out of a Kuma notification body.
 *
 * The shape belongs to Kuma, not to us, so this validates rather than trusts:
 * a body with no identifiable monitor returns null and is ignored. A status
 * that is not explicitly "up" counts as down, because the safe failure for an
 * alert is to be heard.
 */
export function parseUptimeKumaEvent(
  body: UptimeKumaPayload | null | undefined,
): UptimeKumaEvent | null {
  if (!body || typeof body !== "object") return null;
  const rawName = body.monitor?.name;
  const rawId = body.monitor?.id;
  const monitor =
    typeof rawName === "string" && rawName.trim()
      ? rawName.trim().slice(0, 200)
      : typeof rawId === "number" || typeof rawId === "string"
        ? `Monitor ${rawId}`
        : "";
  if (!monitor) return null;

  const status = body.heartbeat?.status;
  const up = status === 1 || status === "1" || status === true;
  const rawMessage =
    typeof body.heartbeat?.msg === "string"
      ? body.heartbeat.msg
      : typeof body.msg === "string"
        ? body.msg
        : "";
  return { monitor, down: !up, message: rawMessage.trim().slice(0, 500) };
}

/* ---- field helpers ------------------------------------------------------- */

function isFixed(field: string): boolean {
  return /^\d+$/.test(field);
}

/** The N of a star-slash-N step field, or null when the field is not one. */
function stepOf(field: string): number | null {
  const match = /^\*\/(\d+)$/.exec(field);
  if (!match) return null;
  const step = Number(match[1]);
  return Number.isFinite(step) && step > 0 ? step : null;
}

/** How many weekdays `0`, `1-5` or `1,3,5` selects; 0 when unreadable. */
function countDayOfWeek(field: string): number {
  let total = 0;
  for (const part of field.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from) return 0;
      total += to - from + 1;
      continue;
    }
    if (!isFixed(part)) return 0;
    total += 1;
  }
  return total;
}
