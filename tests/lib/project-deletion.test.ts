import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { deleteOwnedProject, ProjectDeleteConflict } from "@/lib/project-deletion";
const source = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", updated_at: "2026-10-24T09:00:00.000001Z" };
function backend(data: unknown = [source], error: unknown = null) {
  const request = { delete: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), retry: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockResolvedValue({ data, error }) };
  const from = vi.fn(() => request); return { client: { from } as unknown as SupabaseClient, from, request };
}
afterEach(() => vi.restoreAllMocks());
it("requires an owned captured version and a narrow confirmed delete without SDK retries", async () => {
  const api = backend(); await deleteOwnedProject(api.client, { ...source, notes: "Private text" } as typeof source);
  expect(api.from).toHaveBeenCalledWith("projects"); expect(api.request.eq.mock.calls).toEqual([["id", source.id], ["user_id", source.user_id], ["updated_at", source.updated_at]]);
  expect(api.request.select).toHaveBeenCalledWith("id,user_id,updated_at"); expect(api.request.retry).toHaveBeenCalledWith(false); expect(api.request.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
});
it("accepts equivalent offset formatting without losing database microseconds", async () => {
  await deleteOwnedProject(backend([{ ...source, updated_at: "2026-10-24T11:00:00.000001+02:00" }]).client, source);
  await expect(deleteOwnedProject(backend([{ ...source, updated_at: "2026-10-24T09:00:00.000002Z" }]).client, source)).rejects.toBeInstanceOf(ProjectDeleteConflict);
});
it("refuses empty, duplicate, foreign, changed, invalid or overbroad acknowledgements", async () => {
  for (const data of [null, [], source, [source, source], [{ ...source, id: source.user_id }], [{ ...source, user_id: source.id }], [{ ...source, updated_at: "bad" }], [{ ...source, notes: "Private text" }]])
    await expect(deleteOwnedProject(backend(data).client, source)).rejects.toBeInstanceOf(ProjectDeleteConflict);
  await expect(deleteOwnedProject(backend([source], { message: "Private backend detail" }).client, source)).rejects.toThrow("Project deletion not confirmed");
});
it("rejects invalid source identities or versions before requesting", async () => {
  const api = backend(); for (const next of [{ ...source, id: "bad" }, { ...source, user_id: "bad" }, { ...source, updated_at: "infinity" }]) await expect(deleteOwnedProject(api.client, next)).rejects.toThrow();
  expect(api.from).not.toHaveBeenCalled();
});
it("settles a hung request on parent cancellation or its own deadline", async () => {
  for (const deadline of [false, true]) {
    const controller = new AbortController(), api = backend(); if (deadline) vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    api.request.abortSignal.mockReturnValue(new Promise(() => {})); const pending = deleteOwnedProject(api.client, source, deadline ? undefined : controller.signal);
    controller.abort(); await expect(pending).rejects.toThrow(); expect(api.request.abortSignal.mock.calls[0][0].aborted).toBe(true); vi.restoreAllMocks();
  }
});
