import type { BacklogItem } from "@/lib/backlog";
import type { JobApplication, SavedJobPosition } from "@/lib/types";
import { canonicalJobUrl, careerPositionKey } from "@/lib/jobs/research";
import { isPositionReady } from "@/lib/jobs/pipeline";

/** The same newest-first ordering as Backlog, with finished work removed first. */
export function homeBacklog(items: readonly BacklogItem[]): BacklogItem[] {
  return items.filter((item) => item.status !== "done" && item.status !== "dropped")
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)).slice(0, 5);
}

/** Never suggest an already applied position, including aliases and pruned listing IDs. */
export function homeApplications(positions: readonly SavedJobPosition[], applications: readonly JobApplication[]): SavedJobPosition[] {
  const appliedKeys = new Set(applications.map((app) => careerPositionKey(app.url)).filter(Boolean));
  const appliedListings = new Set(applications.map((app) => app.listing_id).filter(Boolean));
  const seen = new Set<string>();
  return positions.filter((position) => /^https?:\/\//i.test(position.url) && canonicalJobUrl(position.url) && !appliedKeys.has(careerPositionKey(position.url)) && !(position.listing_id && appliedListings.has(position.listing_id)))
    .sort((a, b) => Number(isPositionReady(b)) - Number(isPositionReady(a)) || b.saved_at.localeCompare(a.saved_at) || a.id.localeCompare(b.id))
    .filter((position) => { const key = careerPositionKey(position.url); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 5);
}
