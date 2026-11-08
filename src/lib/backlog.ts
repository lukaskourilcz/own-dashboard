import { createClient } from "@/lib/supabase/client";

/**
 * The shared backlog (owner request, 8 November 2026). The values below are the `backlog_items` contract the global
 * agent instructions insert against (`20261108200000_backlog_items.sql`); change them only together with it.
 */
export const BACKLOG_PROJECTS = ["heyDarlink", "DNESKAi", "devShark", "personal"] as const;
export const BACKLOG_STATUSES = ["open", "in_progress", "done", "dropped"] as const;
export type BacklogProject = (typeof BACKLOG_PROJECTS)[number];
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

export type BacklogItem = {
  id: string;
  project: BacklogProject;
  title: string;
  description: string | null;
  status: BacklogStatus;
  source: string | null;
  external_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type BacklogFilter = { project: BacklogProject | "all"; status: BacklogStatus | "active" | "all" };

/** The newest 500 rows; the owner's session and own-only RLS decide what is visible. */
export const BACKLOG_READ_LIMIT = 500;

export async function fetchBacklogItems(): Promise<BacklogItem[]> {
  const { data, error } = await createClient()
    .from("backlog_items")
    .select("id,project,title,description,status,source,external_ref,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(BACKLOG_READ_LIMIT);
  if (error) throw error;
  return (data ?? []) as BacklogItem[];
}

export async function updateBacklogStatus(id: string, status: BacklogStatus): Promise<BacklogItem> {
  const { data, error } = await createClient()
    .from("backlog_items")
    .update({ status })
    .eq("id", id)
    .select("id,project,title,description,status,source,external_ref,created_at,updated_at")
    .single();
  if (error) throw error;
  return data as BacklogItem;
}

/** "Active" is open and in progress: the default view, so finished and dropped work stays out of the way. */
export function filterBacklog(items: readonly BacklogItem[], filter: BacklogFilter): BacklogItem[] {
  return items.filter((item) =>
    (filter.project === "all" || item.project === filter.project) &&
    (filter.status === "all" || (filter.status === "active" ? item.status === "open" || item.status === "in_progress" : item.status === filter.status)));
}

/** Counts per project for the filter, over the rows the status filter keeps. */
export function backlogProjectCounts(items: readonly BacklogItem[], status: BacklogFilter["status"]): Record<BacklogProject | "all", number> {
  const kept = filterBacklog(items, { project: "all", status });
  const counts = { all: kept.length } as Record<BacklogProject | "all", number>;
  for (const project of BACKLOG_PROJECTS) counts[project] = kept.filter((item) => item.project === project).length;
  return counts;
}

/** A Jira key links to the heyDarlink Jira; a URL links to itself; anything else is shown as text. */
export function backlogRefHref(ref: string | null): string | null {
  if (!ref) return null;
  if (/^LDEV-\d+$/.test(ref)) return `https://linka.atlassian.net/browse/${ref}`;
  try { return new URL(ref).protocol === "https:" ? ref : null; } catch { return null; }
}
