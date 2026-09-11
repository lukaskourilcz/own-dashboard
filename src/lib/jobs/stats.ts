import type { JobApplication, JobApplicationStatus } from "@/lib/types";

// Aggregations for the "Applied" overview strip. Pure and clock-injected
// so tests can pin `now`.

export type ApplicationStats = {
  responses: number;
  responseRate: number | null;
  medianResponseDays: number | null;
  overdueFollowUps: number;
  total: number;
  last7: number;
  last30: number;
  /** applied + interviewing — the ones still worth watching. */
  active: number;
  byStatus: Record<JobApplicationStatus, number>;
};

const EMPTY_BY_STATUS: Record<JobApplicationStatus, number> = {
  applied: 0,
  interviewing: 0,
  offer: 0,
  rejected: 0,
  withdrawn: 0,
};

export function applicationStats(
  apps: JobApplication[],
  now: Date = new Date(),
): ApplicationStats {
  const byStatus = { ...EMPTY_BY_STATUS };
  let last7 = 0;
  let last30 = 0;
  const responseDays: number[] = [];
  let overdueFollowUps = 0;

  const DAY = 24 * 60 * 60 * 1000;
  const nowMs = now.getTime();

  for (const app of apps) {
    byStatus[app.status] = (byStatus[app.status] ?? 0) + 1;
    // applied_on is a plain date (YYYY-MM-DD); parse as UTC midnight so the
    // window math doesn't wobble with the server timezone.
    const applied = Date.parse(`${app.applied_on}T00:00:00Z`);
    if (Number.isNaN(applied)) continue;
    const age = nowMs - applied;
    if (age >= 0 && age <= 7 * DAY) last7++;
    if (age >= 0 && age <= 30 * DAY) last30++;
    const responded = app.responded_on ? Date.parse(`${app.responded_on}T00:00:00Z`) : NaN;
    if (app.response_kind && responded >= applied && responded <= nowMs) responseDays.push((responded-applied)/DAY);
    if ((app.status === "applied" || app.status === "interviewing") && app.next_follow_up_at && Date.parse(app.next_follow_up_at) <= nowMs) overdueFollowUps++;
  }
  responseDays.sort((a,b)=>a-b);
  const middle = Math.floor(responseDays.length/2);

  return {
    responses: responseDays.length,
    responseRate: apps.length ? Math.round(responseDays.length/apps.length*100) : null,
    medianResponseDays: !responseDays.length ? null : responseDays.length%2 ? responseDays[middle] : (responseDays[middle-1]+responseDays[middle])/2,
    overdueFollowUps,
    total: apps.length,
    last7,
    last30,
    active: byStatus.applied + byStatus.interviewing,
    byStatus,
  };
}
