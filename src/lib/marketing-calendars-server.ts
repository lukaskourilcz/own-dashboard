import "server-only";
import {
  MARKETING_CALENDAR_SOURCES,
  parseMarketingCalendar,
  type MarketingCalendarSource,
  type MarketingCalendarsResponse,
  type MarketingSourceResult,
} from "@/lib/marketing-calendars";
import { mapWithConcurrency, readRepoText, repositoryVisible, type GitHubFetch } from "@/lib/stack-detection-server";

/**
 * Reads the configured marketing calendars through the owner's server-side
 * GitHub connection, the same bounded fan-out Tools uses for
 * `about-project.md`. Nothing is stored and nothing is written: every source
 * comes back either as a trimmed calendar or with the reason it could not be
 * read.
 */

const CONCURRENCY = 4;
/** A 30-day plan is about 250 kB; a document four times that is refused, not cut. */
const MAX_CALENDAR_BYTES = 1024 * 1024;
export const MARKETING_CALENDARS_READ_TIMEOUT_MS = 20_000;
const REPOSITORY_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const PATH_RE = /^[A-Za-z0-9._\-/]+\.json$/;

async function readSource(fetcher: GitHubFetch, source: MarketingCalendarSource, signal: AbortSignal): Promise<MarketingSourceResult> {
  const base = {
    id: source.id,
    label: source.label,
    repo: source.repo,
    path: source.path,
    calendarUrl: source.calendarUrl,
    detail: null,
    calendar: null,
  };
  if (!REPOSITORY_RE.test(source.repo) || !PATH_RE.test(source.path) || source.path.includes("..")) {
    return { ...base, status: "unreadable" };
  }
  signal.throwIfAborted();
  const file = await readRepoText(fetcher, source.repo, source.path, MAX_CALENDAR_BYTES, { signal, maxBytes: MAX_CALENDAR_BYTES });
  signal.throwIfAborted();
  if (file.kind === "disconnected") return { ...base, status: "disconnected" };
  if (file.kind === "error") return file.reason === 'invalid-encoding'
    ? { ...base, status: 'invalid-json' }
    : { ...base, status: "error", detail: file.status ? String(file.status) : null };
  if (file.kind === "not-found") {
    const visible = await repositoryVisible(fetcher, source.repo, signal);
    if (visible === null) return { ...base, status: "error" };
    return { ...base, status: visible ? "not-found" : "unreadable" };
  }
  if (file.truncated) return { ...base, status: "too-large" };
  const parsed = parseMarketingCalendar(file.text, source.project);
  if (!parsed.ok) return { ...base, status: parsed.status, detail: parsed.detail };
  return { ...base, status: "ok", calendar: parsed.calendar };
}

export async function readMarketingCalendars(
  fetcher: GitHubFetch,
  sources: readonly MarketingCalendarSource[] = MARKETING_CALENDAR_SOURCES,
  checkedAt = new Date().toISOString(),
  parent?: AbortSignal,
): Promise<MarketingCalendarsResponse> {
  const retirement = new AbortController();
  const signal = AbortSignal.any([retirement.signal, AbortSignal.timeout(MARKETING_CALENDARS_READ_TIMEOUT_MS), ...(parent ? [parent] : [])]);
  try {
    signal.throwIfAborted();
    const results = await mapWithConcurrency(sources, CONCURRENCY, source => readSource(fetcher, source, signal), signal);
    signal.throwIfAborted(); return { checkedAt, sources: results };
  } catch (error) {
    if (signal.aborted) throw new DOMException('Calendar read aborted', 'AbortError');
    throw error;
  } finally { retirement.abort(); }
}
