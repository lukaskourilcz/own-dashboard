import type {
  JobApplication,
  JobApplicationStatus,
  SavedJobPosition,
} from "@/lib/types";

// Stage board for Career → Applied. Pure and clock-injected so the board, the
// "Follow-ups due" metric and the Home/Work surfaces can never disagree about
// what is due.
//
// The five columns are a *presentation* of two existing tables, not a new
// model: "saved" is `saved_job_positions` (a position with no application yet)
// and the other four collapse `job_applications.status`. Nothing here writes,
// and the board never invents an application date — leaving "saved" always
// goes through the existing ApplyDialog and `record_job_application`.

export const BOARD_COLUMNS = [
  "saved",
  "applied",
  "interviewing",
  "offer",
  "closed",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/** Stages that still deserve a follow-up. Closed work is done being chased. */
const ACTIVE_STATUSES: JobApplicationStatus[] = ["applied", "interviewing"];

const COLUMN_BY_STATUS: Record<JobApplicationStatus, BoardColumn> = {
  applied: "applied",
  interviewing: "interviewing",
  offer: "offer",
  // Rejected and withdrawn are both "no longer moving"; the row keeps its own
  // status, and the badge on the card still says which one it is.
  rejected: "closed",
  withdrawn: "closed",
};

export function isBoardColumn(value: string): value is BoardColumn {
  return (BOARD_COLUMNS as readonly string[]).includes(value);
}

export function columnForApplication(app: JobApplication): BoardColumn {
  return COLUMN_BY_STATUS[app.status] ?? "applied";
}

/**
 * The status a drop on `column` writes. `null` for "saved", which has no
 * application row at all: moving out of it creates one through ApplyDialog,
 * and moving *into* it would have to delete an application, so neither is a
 * drag. A drop on "closed" writes `rejected`; withdrawing stays an explicit
 * choice in the stage select, because only the owner knows which it was.
 */
export function statusForColumn(
  column: BoardColumn,
): JobApplicationStatus | null {
  if (column === "saved") return null;
  if (column === "closed") return "rejected";
  return column;
}

export type BoardGroups = {
  saved: SavedJobPosition[];
  applied: JobApplication[];
  interviewing: JobApplication[];
  offer: JobApplication[];
  closed: JobApplication[];
};

function byAppliedDesc(a: JobApplication, b: JobApplication): number {
  const dates = b.applied_on.localeCompare(a.applied_on);
  return dates !== 0 ? dates : a.title.localeCompare(b.title);
}

function bySavedDesc(a: SavedJobPosition, b: SavedJobPosition): number {
  const dates = b.saved_at.localeCompare(a.saved_at);
  return dates !== 0 ? dates : a.title.localeCompare(b.title);
}

export function groupApplicationsByColumn(
  applications: JobApplication[],
  savedPositions: SavedJobPosition[] = [],
): BoardGroups {
  const groups: BoardGroups = {
    saved: [...savedPositions].sort(bySavedDesc),
    applied: [],
    interviewing: [],
    offer: [],
    closed: [],
  };
  for (const app of applications) {
    const column = columnForApplication(app);
    // A saved position is never an application, so this branch is unreachable
    // for real data; the guard keeps the type honest instead of casting.
    if (column === "saved") continue;
    groups[column].push(app);
  }
  for (const column of ["applied", "interviewing", "offer", "closed"] as const) {
    groups[column].sort(byAppliedDesc);
  }
  return groups;
}

/** Timestamp of a due follow-up, or null when there is none to act on. */
function dueAt(app: JobApplication, nowMs: number): number | null {
  if (!ACTIVE_STATUSES.includes(app.status)) return null;
  if (!app.next_follow_up_at) return null;
  const at = Date.parse(app.next_follow_up_at);
  if (Number.isNaN(at) || at > nowMs) return null;
  return at;
}

/**
 * Applications whose follow-up date has arrived, oldest first. Only "applied"
 * and "interviewing" qualify: an offer, a rejection or a withdrawal is not
 * waiting on a nudge. A malformed timestamp is skipped rather than guessed at.
 */
export function dueFollowUps(
  applications: JobApplication[],
  now: Date = new Date(),
): JobApplication[] {
  const nowMs = now.getTime();
  return applications
    .map((app) => ({ app, at: dueAt(app, nowMs) }))
    .filter((row): row is { app: JobApplication; at: number } => row.at !== null)
    .sort((a, b) => a.at - b.at)
    .map((row) => row.app);
}

/** `true` when this application's follow-up date has arrived. */
export function isFollowUpDue(
  app: JobApplication,
  now: Date = new Date(),
): boolean {
  return dueAt(app, now.getTime()) !== null;
}
