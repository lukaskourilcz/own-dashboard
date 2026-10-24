import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import type { Project } from "@/lib/types";
import { sameProjectSnapshot } from "@/lib/projects";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const receiptSchema = z.object({ kind: z.enum(["saved", "conflict"]), id: z.uuid(), user_id: z.uuid(), notes_hash: hash, source_notes_hash: hash,
  source_updated_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }) }).strict();
export type ProjectNotesReceipt = z.infer<typeof receiptSchema>;
export class ProjectNotesSizeError extends Error { constructor() { super("Project notes too large"); this.name = "ProjectNotesSizeError"; } }

type Source = Pick<Project, "id" | "user_id" | "notes">;
const sourceSchema = z.object({ id: z.uuid(), user_id: z.uuid(), notes: z.string() });
async function textHash(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
  const digest = await awaitWithSignal(crypto.subtle.digest("SHA-256", bytes), signal);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** A 64-character source fingerprint avoids sending the earlier private text
 * or unrelated project fields. Identical retries return the same version.
 * Conflicts are explicit; no draft or receipt enters browser storage. */
export async function saveProjectNotes(client: SupabaseClient, expected: Source, notes: string, replaceConflict?: ProjectNotesReceipt): Promise<ProjectNotesReceipt> {
  sourceSchema.parse(expected);
  if (typeof notes !== "string") throw Error("Invalid project notes");
  if (expected.notes.length > 10485760) throw Error("Project notes too large");
  if (notes.length > 1048576) throw new ProjectNotesSizeError();
  if (notes.includes("\0")) throw Error("Invalid project notes");
  const encoder = new TextEncoder(), before = encoder.encode(expected.notes), after = encoder.encode(notes);
  if (before.byteLength > 10485760) throw Error("Project notes too large");
  if (after.byteLength > 1048576) throw new ProjectNotesSizeError();
  const signal = AbortSignal.timeout(15_000);
  let replacementHash: string | undefined;
  if (replaceConflict) {
    const conflict = receiptSchema.parse(replaceConflict);
    if (conflict.kind !== "conflict" || conflict.id !== expected.id || conflict.user_id !== expected.user_id
      || conflict.notes_hash !== conflict.source_notes_hash || conflict.source_updated_at !== conflict.updated_at) throw Error("Invalid project notes replacement");
    replacementHash = conflict.notes_hash;
  }
  const [expectedHash, desiredHash] = await Promise.all([replacementHash ?? textHash(before, signal), textHash(after, signal)]);
  const { data, error } = await awaitWithSignal(client.rpc("save_project_notes", { p_id: expected.id, p_expected_hash: expectedHash, p_notes: notes }).retry(false).abortSignal(signal), signal);
  if (error) throw Error("Project notes save unconfirmed");
  const saved = receiptSchema.parse(data), sourceTime = Date.parse(saved.source_updated_at), savedTime = Date.parse(saved.updated_at);
  if (saved.id !== expected.id || saved.user_id !== expected.user_id || savedTime < sourceTime) throw Error("Project notes save unconfirmed");
  if (saved.kind === "saved") {
    if (saved.notes_hash !== desiredHash || ![expectedHash, desiredHash].includes(saved.source_notes_hash)
      || (saved.source_notes_hash === desiredHash ? savedTime !== sourceTime : savedTime <= sourceTime)) throw Error("Project notes save unconfirmed");
  } else if (saved.notes_hash !== saved.source_notes_hash || [expectedHash, desiredHash].includes(saved.notes_hash) || savedTime !== sourceTime) throw Error("Project notes conflict unconfirmed");
  return saved;
}

/** Keep a late receipt out of a newer/optimistic cached record. A caller only
 * refetches when the receipt's source version is not already represented. */
export function applyProjectNotesReceipt(current: Project[], expected: Project, notes: string, receipt: ProjectNotesReceipt): { projects: Project[]; reconcile: boolean } {
  if (receipt.id !== expected.id || receipt.user_id !== expected.user_id || receipt.kind !== "saved") return { projects: current, reconcile: true };
  let found = false, reconcile = false;
  const projects = current.map(row => {
    if (row.id !== expected.id || row.user_id !== expected.user_id) return row;
    found = true;
    if (row.notes === notes && Date.parse(row.updated_at) >= Date.parse(receipt.updated_at)) return row;
    const same = sameProjectSnapshot(row, expected);
    if (!same || row.updated_at !== receipt.source_updated_at) { reconcile = true; return row; }
    return { ...row, notes, updated_at: receipt.updated_at };
  });
  return { projects, reconcile: reconcile || !found };
}
