import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { applyProjectPreferencesReceipt, setProjectPreferences, type ProjectPreferencesPatch, type ProjectPreferencesReceipt } from "@/lib/project-preferences";
import type { Project } from "@/lib/types";
const source: Project = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", name: "Private fixture", slug: "fixture", repo_full_name: null, notes: "Private notes", url: null, color: null, sort_order: 0, is_active: true, engagement: "own", created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:00:00Z" };
const receipt: ProjectPreferencesReceipt = { kind: "saved", id: source.id, user_id: source.user_id, values: { is_active: false }, previous_values: { is_active: true }, source_updated_at: source.updated_at, updated_at: "2026-10-24T10:00:00Z" };
function backend(data: unknown = receipt, error: unknown = null) {
  const request = { retry: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnValue(Promise.resolve({ data, error })) }, rpc = vi.fn(() => request);
  return { client: { rpc } as unknown as SupabaseClient, rpc, request };
}
afterEach(() => vi.restoreAllMocks());
it("sends only the owner record id, source version and explicit patch with a deadline and no automatic retries", async () => {
  const api = backend(); expect(await setProjectPreferences(api.client, source, { is_active: false })).toEqual(receipt);
  expect(api.rpc).toHaveBeenCalledWith("set_project_preferences", { p_id: source.id, p_expected_updated_at: source.updated_at, p_patch: { is_active: false } });
  expect(api.request.retry).toHaveBeenCalledWith(false); expect(api.request.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  expect(JSON.stringify(api.rpc.mock.calls)).not.toContain("Private");
});
it("accepts a repeatable no-op and a stale conflict without pretending it was saved", async () => {
  const noOp = { ...receipt, source_updated_at: receipt.updated_at, previous_values: receipt.values };
  expect(await setProjectPreferences(backend(noOp).client, source, { is_active: false })).toEqual(noOp);
  const conflict = { ...receipt, kind: "conflict", values: { is_active: true }, source_updated_at: receipt.updated_at };
  expect(await setProjectPreferences(backend(conflict).client, source, { is_active: false })).toEqual(conflict);
});
it("rejects malformed or overbroad patch inputs before requesting", async () => {
  const api = backend();
  for (const patch of [{}, { is_active: undefined }, { is_active: "false" }, { engagement: "Client" }, { notes: "Replace" }, { is_active: false, notes: "Replace" }]) await expect(setProjectPreferences(api.client, source, patch as ProjectPreferencesPatch)).rejects.toThrow();
  await expect(setProjectPreferences(api.client, { ...source, updated_at: "infinity" }, { is_active: false })).rejects.toThrow();
  expect(api.rpc).not.toHaveBeenCalled();
});
it("rejects foreign, incomplete, contradictory, stale-success and unrequested-field receipts", async () => {
  for (const data of [null, [], { ...receipt, id: source.user_id }, { ...receipt, user_id: source.id }, { ...receipt, notes: "Private" }, { ...receipt, values: { engagement: "client" } },
    { ...receipt, previous_values: { is_active: true, engagement: "own" } }, { ...receipt, values: { is_active: true } }, { ...receipt, updated_at: source.updated_at },
    { ...receipt, source_updated_at: "2026-10-24T09:30:00Z" }, { ...receipt, kind: "conflict" }, { ...receipt, kind: "conflict", source_updated_at: receipt.updated_at }]) {
    await expect(setProjectPreferences(backend(data).client, source, { is_active: false })).rejects.toThrow();
  }
  await expect(setProjectPreferences(backend(receipt, { message: "Private provider details" }).client, source, { is_active: false })).rejects.toThrow("Project preferences save unconfirmed");
});
it("honors the abort signal even if a transport promise never settles", async () => {
  const controller = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const api = backend(); api.request.abortSignal.mockReturnValue(new Promise(() => {}));
  const pending = setProjectPreferences(api.client, source, { is_active: false }); controller.abort();
  await expect(pending).rejects.toThrow(); expect(api.request.abortSignal).toHaveBeenCalledWith(controller.signal);
});
it("applies only confirmed fields to an unchanged cached source while keeping its private text", () => {
  const result = applyProjectPreferencesReceipt([source], receipt); expect(result.reconcile).toBe(false);
  expect(result.projects[0]).toEqual({ ...source, is_active: false, updated_at: receipt.updated_at });
  expect(source.is_active).toBe(true);
});
it("does not regress concurrent notes/classification, touch a foreign record or resurrect a deleted record", () => {
  for (const current of [{ ...source, notes: "Later note", updated_at: "2026-10-24T11:00:00Z" }, { ...source, is_active: false }, { ...source, user_id: source.id }]) {
    const result = applyProjectPreferencesReceipt([current], receipt); expect(result.reconcile).toBe(true); expect(result.projects[0]).toBe(current);
  }
  expect(applyProjectPreferencesReceipt([], receipt)).toEqual({ projects: [], reconcile: true });
  const newer = { ...source, is_active: false, notes: "Later note", updated_at: "2026-10-24T11:00:00Z" };
  expect(applyProjectPreferencesReceipt([newer], receipt)).toEqual({ projects: [newer], reconcile: false });
});
it("reconciles conflicts and treats equivalent timestamp formats as the same database source version", () => {
  expect(applyProjectPreferencesReceipt([source], { ...receipt, kind: "conflict" })).toEqual({ projects: [source], reconcile: true });
  const row = { ...source, updated_at: "2026-10-24T09:00:00+00:00" }; expect(applyProjectPreferencesReceipt([row], receipt).reconcile).toBe(false);
});
it("distinguishes source versions within the same millisecond and preserves timezone equivalence", async () => {
  const expected = { ...source, updated_at: "2026-10-24T09:00:00.000001Z" };
  const saved = { ...receipt, source_updated_at: "2026-10-24T11:00:00.000001+02:00", updated_at: "2026-10-24T09:00:00.001001Z" };
  expect(await setProjectPreferences(backend(saved).client, expected, { is_active: false })).toEqual(saved);
  const newer = { ...expected, notes: "Newer note", updated_at: "2026-10-24T09:00:00.000002Z" };
  expect(applyProjectPreferencesReceipt([newer], saved)).toEqual({ projects: [newer], reconcile: true });
  await expect(setProjectPreferences(backend(saved).client, newer, { is_active: false })).rejects.toThrow("Project preferences save unconfirmed");
});
