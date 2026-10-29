import type { SupabaseClient } from "@supabase/supabase-js";
import { awaitWithSignal } from "@/lib/abortable";
import type { NeededTodoRow } from "@/lib/needed-sync";
import type { Todo } from "@/lib/types";

/** Both import controls share one owner transaction and checked receipts.
 * Only source versions captured by Refresh may be removed; changed/reopened
 * tasks stay. Database matching also preserves existing legacy imports. */
export async function syncNeededTasks(client: SupabaseClient, rows: NeededTodoRow[], remove: Todo[] = [], scanned: Set<string> = new Set(), parent?: AbortSignal) {
  parent?.throwIfAborted();
  if (!rows.length && !remove.length) return { added: 0, removed: 0, retained: 0, repos: 0 };
  if (rows.length > 5000 || remove.length > 20000) throw Error("Repository synchronization too large");
  rows = structuredClone(rows); remove = structuredClone(remove); scanned = new Set(scanned);
  const expected = new Map<string, NeededTodoRow>(), requested = new Set(remove.map(row => row.id));
  if (requested.size !== remove.length) throw Error("Duplicate repository source");
  const key = (repo: string, raw: string) => JSON.stringify([repo, raw]);
  for (const row of rows) {
    const identity = key(row.repo_id, row.needed_raw), previous = expected.get(identity);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) throw Error("Conflicting repository source");
    expected.set(identity, row);
  }
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(parent ? [parent] : [])]);
  signal.throwIfAborted();
  const { data, error } = await awaitWithSignal(client.rpc("sync_repository_tasks", { p_rows: rows, p_remove: remove, p_scanned: [...scanned] }).abortSignal(signal), signal);
  if (error) throw Error("Repository synchronization unconfirmed");
  const { z } = await import("zod");
  const result = z.object({ inserted: z.array(z.object({ id: z.uuid(), user_id: z.uuid(), repo_id: z.string(), needed_raw: z.string() }).passthrough()).max(5000), deleted_ids: z.array(z.uuid()), retained_ids: z.array(z.uuid()) }).parse(data);
  const insertedIds = new Set<string>(), insertedSources = new Set<string>(), affectedRepos = new Set<string>();
  for (const saved of result.inserted) {
    const identity = key(saved.repo_id, saved.needed_raw), candidate = expected.get(identity);
    if (!candidate || insertedIds.has(saved.id) || insertedSources.has(identity) || requested.has(saved.id)) throw Error("Repository synchronization unconfirmed");
    for (const field of Object.keys(candidate) as (keyof NeededTodoRow)[]) {
      const matches = field === "generated_at" ? typeof saved[field] === "string" && Date.parse(saved[field]) === Date.parse(candidate[field]) : saved[field] === candidate[field];
      if (!matches) throw Error("Repository synchronization unconfirmed");
    }
    insertedIds.add(saved.id); insertedSources.add(identity); affectedRepos.add(saved.repo_id);
  }
  for (const id of [...result.deleted_ids, ...result.retained_ids]) if (!requested.delete(id)) throw Error("Repository synchronization unconfirmed");
  if (requested.size) throw Error("Repository synchronization unconfirmed");
  return { added: result.inserted.length, removed: result.deleted_ids.length, retained: result.retained_ids.length, repos: affectedRepos.size };
}
