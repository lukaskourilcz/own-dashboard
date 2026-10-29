import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import type { RepoNote, Todo } from "@/lib/types";

export const repositoryNoteSchema = z.object({
  id: z.uuid(), user_id: z.uuid(), repo_id: z.string().min(1), repo_full_name: z.string().min(1),
  body: z.string(), sort_order: z.number().int(), created_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
  updated_at: z.string().refine(value => Number.isFinite(Date.parse(value))),
});

export type NewRepositoryNote = Pick<RepoNote, "id" | "user_id" | "repo_id" | "repo_full_name" | "sort_order">;
export async function createRepositoryNote(client: SupabaseClient, input: NewRepositoryNote): Promise<RepoNote> {
  const signal = AbortSignal.timeout(15_000);
  const { data, error } = await awaitWithSignal(client.from("repo_notes").upsert({ ...input, body: "" }, { onConflict: "id", ignoreDuplicates: true }).select().abortSignal(signal).maybeSingle(), signal);
  if (error) throw Error("Repository note creation unconfirmed");
  const existing = data ? { data, error: null } : await awaitWithSignal(client.from("repo_notes").select().eq("id", input.id).abortSignal(signal).maybeSingle(), signal);
  if (existing.error) throw Error("Repository note creation unconfirmed");
  const saved = repositoryNoteSchema.parse(existing.data);
  if (saved.id !== input.id || saved.user_id !== input.user_id || saved.repo_id !== input.repo_id || saved.repo_full_name !== input.repo_full_name || saved.sort_order !== input.sort_order) throw Error("Repository note creation unconfirmed");
  return saved;
}

export async function saveRepositoryNote(client: SupabaseClient, expected: RepoNote, body: string): Promise<RepoNote> {
  if (new TextEncoder().encode(body).byteLength > 262144) throw Error("Repository note too large");
  const signal = AbortSignal.timeout(15_000);
  const { data, error } = await awaitWithSignal(client.rpc("save_repository_note", { p_id: expected.id, p_expected: expected, p_body: body }).abortSignal(signal), signal);
  if (error) throw Error("Repository note save unconfirmed");
  const saved = repositoryNoteSchema.parse(data);
  if (saved.id !== expected.id || saved.user_id !== expected.user_id || saved.repo_id !== expected.repo_id
    || saved.repo_full_name !== expected.repo_full_name || saved.sort_order !== expected.sort_order
    || Date.parse(saved.created_at) !== Date.parse(expected.created_at) || saved.body !== body) throw Error("Repository note save unconfirmed");
  return saved;
}

/** Clear only captured versions. An intervening edit/reopen stays owned data.
 * Partition receipts must name every submitted id exactly once. No private
 * body/title is placed in a REST URL or persisted to browser storage. */
export async function consumeRepositoryRecords(client: SupabaseClient, entity: "repo_notes" | "todos", rows: (RepoNote | Todo)[], parent?: AbortSignal) {
  parent?.throwIfAborted();
  const requested = new Set(rows.map(row => row.id));
  if (requested.size !== rows.length || rows.length > 20000) throw Error("Invalid repository batch");
  rows = structuredClone(rows);
  const chunks: (RepoNote | Todo)[][] = []; let chunk: (RepoNote | Todo)[] = [], bytes = 2;
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).byteLength + 1;
    if (size > 900000) throw Error("Repository source too large");
    if (chunk.length && (chunk.length === 250 || bytes + size > 900000)) { chunks.push(chunk); chunk = []; bytes = 2; }
    chunk.push(row); bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  const deleted = new Set<string>(), retained = new Set<string>(), signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(parent ? [parent] : [])]);
  const receipt = z.object({ deleted_ids: z.array(z.uuid()), retained_ids: z.array(z.uuid()) });
  for (const batch of chunks) {
    signal.throwIfAborted();
    const { data, error } = await awaitWithSignal(client.rpc("consume_repository_records", { p_entity: entity, p_rows: batch }).abortSignal(signal), signal);
    if (error) throw Error("Repository removal unconfirmed");
    const result = receipt.parse(data), ids = new Set(batch.map(row => row.id));
    for (const id of [...result.deleted_ids, ...result.retained_ids]) {
      if (!ids.delete(id)) throw Error("Repository removal unconfirmed");
    }
    if (ids.size) throw Error("Repository removal unconfirmed");
    result.deleted_ids.forEach(id => deleted.add(id)); result.retained_ids.forEach(id => retained.add(id));
  }
  return { deleted, retained };
}
