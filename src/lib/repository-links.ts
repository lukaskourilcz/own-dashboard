import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { safeWebUrl } from "@/lib/web-url";
import type { RepoLink } from "@/lib/types";

const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)));
const repository = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), full_name: z.string().max(201).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/) });
const rowSchema = z.object({
  id: z.uuid(), user_id: z.uuid(), repo_id: z.string().regex(/^[1-9]\d{0,15}$/),
  repo_full_name: z.string().min(1).max(201), url: z.string().max(65_536), created_at: timestamp, updated_at: timestamp,
});

export function normalizeRepositoryUrl(raw: string): string | null {
  if (!raw.trim() || raw.trim().startsWith("//") || /\p{Cc}/u.test(raw)) return null;
  return safeWebUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw : `https://${raw.trim()}`);
}

function sameVersion(a: RepoLink, b: RepoLink) {
  return a.id === b.id && a.user_id === b.user_id && a.repo_id === b.repo_id && a.updated_at === b.updated_at;
}
function sameReceipt(a: RepoLink, b: RepoLink) {
  return a.id === b.id && a.user_id === b.user_id && a.repo_id === b.repo_id && a.repo_full_name === b.repo_full_name && a.url === b.url
    && Date.parse(a.created_at) === Date.parse(b.created_at) && Date.parse(a.updated_at) === Date.parse(b.updated_at);
}

/** Existing rows rely on own-only RLS plus an explicit captured owner filter;
 * only a new link needs an extra authentication-service lookup. */
export async function saveRepositoryLink(client: SupabaseClient, repo: { id: number; full_name: string }, expected: RepoLink | null, raw: string): Promise<RepoLink> {
  const target = repository.parse(repo), url = normalizeRepositoryUrl(raw);
  if (!url) throw Error("Invalid repository URL");
  const signal = AbortSignal.timeout(15_000), repo_id = String(target.id);
  const previous = expected ? rowSchema.parse(expected) : null;
  if (previous && previous.repo_id !== repo_id) throw Error("Repository link changed");
  let owner = previous?.user_id;
  if (!owner) {
    const auth = await awaitWithSignal(client.auth.getUser(), signal);
    if (auth.error || !auth.data.user) throw Error("Repository link unavailable");
    owner = z.uuid().parse(auth.data.user.id);
  }
  const updated_at = new Date(Math.max(Date.now(), previous ? Date.parse(previous.updated_at) + 1 : 0)).toISOString();
  const values = { repo_full_name: target.full_name, url, updated_at };
  const write = previous ? client.from("repo_links").update(values).eq("id", previous.id).eq("user_id", owner).eq("repo_id", repo_id).eq("updated_at", previous.updated_at)
    : client.from("repo_links").upsert({ ...values, user_id: owner, repo_id }, { onConflict: "user_id,repo_id", ignoreDuplicates: true });
  const { data, error } = await awaitWithSignal(write.select().abortSignal(signal).maybeSingle(), signal);
  if (error || !data) throw Error("Repository link save unconfirmed");
  const saved = rowSchema.parse(data);
  if (saved.user_id !== owner || saved.repo_id !== repo_id || saved.repo_full_name !== target.full_name || saved.url !== url || Date.parse(saved.updated_at) !== Date.parse(updated_at)
    || (previous && (saved.id !== previous.id || Date.parse(saved.created_at) !== Date.parse(previous.created_at)))) throw Error("Repository link save unconfirmed");
  return saved;
}

export async function removeRepositoryLink(client: SupabaseClient, expected: RepoLink): Promise<void> {
  const captured = rowSchema.parse(expected), signal = AbortSignal.timeout(15_000);
  const { data, error } = await awaitWithSignal(client.from("repo_links").delete().eq("id", captured.id).eq("user_id", captured.user_id)
    .eq("repo_id", captured.repo_id).eq("updated_at", captured.updated_at).select().abortSignal(signal).maybeSingle(), signal);
  if (error || !data || !sameReceipt(rowSchema.parse(data), captured)) throw Error("Repository link removal unconfirmed");
}

/** Never restore a complete old list, resurrect a newer removal or overwrite
 * another edit that reached the cache while the request was running. */
export function applySavedRepositoryLink(rows: RepoLink[], expected: RepoLink | null, saved: RepoLink): RepoLink[] {
  const current = rows.find(row => row.repo_id === saved.repo_id);
  if (expected) {
    if (!current || (!sameVersion(current, expected) && !sameReceipt(current, saved))) return rows;
  } else if (current) return rows;
  return current ? rows.map(row => row.id === current.id ? saved : row) : [saved, ...rows];
}
export function applyRemovedRepositoryLink(rows: RepoLink[], expected: RepoLink): RepoLink[] {
  return rows.filter(row => !sameVersion(row, expected));
}
