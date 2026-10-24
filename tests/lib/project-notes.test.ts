import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { saveProjectNotes, applyProjectNotesReceipt, type ProjectNotesReceipt } from "@/lib/project-notes";
import type { Project } from "@/lib/types";
const owner = "11111111-1111-4111-8111-111111111111", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const stamp = "2026-10-24T12:00:00+00:00", next = "2026-10-24T12:00:01+00:00", hash = (text: string) => createHash("sha256").update(text).digest("hex");
const expected: Project = { id, user_id: owner, notes: "Original private notes", name: "Original name", slug: "fixture", repo_full_name: null, color: null, url: null, sort_order: 0, is_active: true, created_at: stamp, updated_at: stamp };
const receipt: ProjectNotesReceipt = { kind: "saved", id, user_id: owner, notes_hash: hash("Saved notes"), source_notes_hash: hash(expected.notes), source_updated_at: stamp, updated_at: next };
function backend(data: unknown, error: unknown = null) {
  const abortSignal = vi.fn((signal: AbortSignal) => { signal.throwIfAborted(); return Promise.resolve({ data, error }); }), retry = vi.fn(() => ({ abortSignal })), rpc = vi.fn(() => ({ retry }));
  return { rpc, retry, abortSignal, client: { rpc } as unknown as SupabaseClient };
}
it("sends a source fingerprint and new text only, and requires the complete compact owner receipt", async () => {
  const b = backend(receipt); expect(await saveProjectNotes(b.client, expected, "Saved notes")).toEqual(receipt);
  expect(b.rpc).toHaveBeenCalledWith("save_project_notes", { p_id: id, p_expected_hash: hash(expected.notes), p_notes: "Saved notes" });
  expect(JSON.stringify(b.rpc.mock.calls)).not.toContain(expected.notes); expect(b.retry).toHaveBeenCalledWith(false);
  expect(b.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal); expect(JSON.stringify(receipt)).not.toContain("Original name");
});
it("accepts a no-write identical retry and an explicit conflict without treating it as saved", async () => {
  const repeated = { ...receipt, source_notes_hash: hash("Saved notes"), source_updated_at: next };
  expect(await saveProjectNotes(backend(repeated).client, expected, "Saved notes")).toEqual(repeated);
  const conflict = { ...receipt, kind: "conflict", notes_hash: hash("Changed elsewhere"), source_notes_hash: hash("Changed elsewhere"), source_updated_at: next };
  expect((await saveProjectNotes(backend(conflict).client, expected, "Saved notes")).kind).toBe("conflict");
});
it.each([
  null, {}, { ...receipt, id: other }, { ...receipt, user_id: other }, { ...receipt, notes_hash: hash("Wrong") },
  { ...receipt, source_notes_hash: hash("Unrelated") }, { ...receipt, updated_at: stamp }, { ...receipt, updated_at: "invalid" },
  { ...receipt, source_updated_at: "invalid" }, { ...receipt, source_updated_at: "2026-10-25T12:00:00Z" },
  { ...receipt, notes: "Unexpected echoed document" }, { ...receipt, kind: "unknown" },
  { ...receipt, kind: "conflict" }, { ...receipt, kind: "conflict", source_updated_at: next, source_notes_hash: receipt.notes_hash },
  { ...receipt, source_notes_hash: receipt.notes_hash },
])("refuses malformed, foreign, unconfirmed or contradictory receipts", async row => {
  await expect(saveProjectNotes(backend(row).client, expected, "Saved notes")).rejects.toThrow();
});
it("rejects invalid identities, null characters and UTF-8 bounds before any write", async () => {
  const b = backend(receipt);
  for (const source of [{ ...expected, id: "invalid" }, { ...expected, user_id: "invalid" }, { ...expected, notes: "x".repeat(10485761) }]) await expect(saveProjectNotes(b.client, source, "Small")).rejects.toThrow();
  for (const notes of ["x".repeat(1048577), "🚀".repeat(262145), "A\0B"]) await expect(saveProjectNotes(b.client, expected, notes)).rejects.toThrow();
  expect(b.rpc).not.toHaveBeenCalled();
});
it("does not treat an RPC error as a confirmed save", async () => {
  await expect(saveProjectNotes(backend(receipt, { code: "40001" }).client, expected, "Saved notes")).rejects.toThrow("unconfirmed");
});
it("applies note/version fields only to the unchanged captured cache record", () => {
  const row = Object.freeze({ ...expected }), unrelated = Object.freeze({ ...expected, id: other });
  const result = applyProjectNotesReceipt([row, unrelated], row, "Saved notes", receipt);
  expect(result.reconcile).toBe(false); expect(result.projects[0]).toEqual({ ...row, notes: "Saved notes", updated_at: next });
  expect(result.projects[1]).toBe(unrelated); expect(row.notes).toBe(expected.notes);
});
it("keeps newer notes, metadata, removed projects and conflict outcomes out of a late acknowledgement", () => {
  for (const current of [[{ ...expected, notes: "Newer draft" }], [{ ...expected, name: "Optimistic name" }], [{ ...expected, updated_at: next }], []]) {
    const result = applyProjectNotesReceipt(current, expected, "Saved notes", receipt); expect(result.projects).toEqual(current); expect(result.reconcile).toBe(true);
  }
  const alreadySaved = { ...expected, notes: "Saved notes", updated_at: next, name: "Newer metadata" };
  expect(applyProjectNotesReceipt([alreadySaved], expected, "Saved notes", receipt)).toEqual({ projects: [alreadySaved], reconcile: false });
  expect(applyProjectNotesReceipt([expected], expected, "Saved notes", { ...receipt, id: other })).toEqual({ projects: [expected], reconcile: true });
  const conflict = { ...receipt, kind: "conflict" as const }; expect(applyProjectNotesReceipt([expected], expected, "Saved notes", conflict)).toEqual({ projects: [expected], reconcile: true });
});

it("propagates its deadline signal to end an unresponsive save without retrying", async () => {
  const controller = new AbortController(), timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  try {
    const rpc = vi.fn(() => ({ retry: () => ({ abortSignal: (signal: AbortSignal) => { expect(signal).toBe(controller.signal); return new Promise<never>(() => {}); } }) }));
    const pending = saveProjectNotes({ rpc } as unknown as SupabaseClient, expected, "Saved notes");
    const failure = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(timeout).toHaveBeenCalledWith(15000);
    controller.abort(new DOMException("Fixture deadline reached", "TimeoutError")); await failure; expect(rpc).toHaveBeenCalledTimes(1);
  } finally { timeout.mockRestore(); }
});

it("uses a validated conflict fingerprint only for an explicit replacement", async () => {
  const conflict: ProjectNotesReceipt = { ...receipt, kind: "conflict", notes_hash: hash("Elsewhere"), source_notes_hash: hash("Elsewhere"), source_updated_at: next, updated_at: next };
  const saved = { ...receipt, source_notes_hash: hash("Elsewhere"), source_updated_at: next, updated_at: "2026-10-24T12:00:02+00:00" };
  const b = backend(saved); expect((await saveProjectNotes(b.client, expected, "Saved notes", conflict)).kind).toBe("saved");
  expect(b.rpc).toHaveBeenCalledWith("save_project_notes", expect.objectContaining({ p_expected_hash: hash("Elsewhere") }));
  for (const bad of [{ ...conflict, id: other }, { ...conflict, user_id: other }, { ...conflict, kind: "saved" as const }, { ...conflict, notes_hash: hash("Other") }]) await expect(saveProjectNotes(backend(saved).client, expected, "Saved notes", bad)).rejects.toThrow();
});
