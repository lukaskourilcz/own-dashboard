import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { applyProjectDetailsReceipt, currentProjectDetails, projectDetailsHistory, saveProjectDetails, type ProjectDetailsReceipt, type ProjectDetailsValues } from "@/lib/project-details";
import { databaseVersion } from "@/lib/database-version";
import { sameProjectSnapshot } from "@/lib/projects";
import type { Project } from "@/lib/types";
const source: Project = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", user_id: "11111111-1111-4111-8111-111111111111", name: "Original", slug: "original", repo_full_name: "owner/current", repo_id: 101,
  notes: "Private notes", url: null, color: null, sort_order: 7, is_active: false, engagement: "own", previous_slugs: ["earlier"], previous_repo_full_names: ["owner/earlier"],
  created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:00:00Z" };
const values: ProjectDetailsValues = { name: "Edited", slug: "edited", repo_full_name: "owner/new", repo_id: 101, url: "https://example.com/", dev_url: "http://localhost:3000/", organization_id: null, engagement: "client" };
type Saved = Extract<ProjectDetailsReceipt, { kind: "saved" }>;
const receipt: Saved = { kind: "saved", id: source.id, user_id: source.user_id, values, previous_slugs: ["earlier", "original"], previous_repo_full_names: ["owner/earlier", "owner/current"], source_updated_at: source.updated_at, updated_at: "2026-10-24T10:00:00Z" };
function backend(data: unknown = receipt, error: unknown = null) {
  const request = { retry: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnValue(Promise.resolve({ data, error })) }, rpc = vi.fn(() => request);
  return { client: { rpc } as unknown as SupabaseClient, rpc, request };
}
afterEach(() => vi.restoreAllMocks());
it("sends only the captured id/version and eight explicit values with a deadline and no SDK retry", async () => {
  const api = backend(); expect(await saveProjectDetails(api.client, source, values)).toEqual(receipt);
  expect(api.rpc).toHaveBeenCalledWith("save_project_details", { p_id: source.id, p_expected_updated_at: source.updated_at, p_values: values });
  expect(JSON.stringify(api.rpc.mock.calls)).not.toMatch(/Private notes|previous_slugs|sort_order|is_active/);
  expect(api.request.retry).toHaveBeenCalledWith(false); expect(api.request.abortSignal.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
});
it("accepts an identical retry already committed after its captured version and a fresh no-op", async () => {
  const repeated = { ...receipt, source_updated_at: receipt.updated_at };
  expect(await saveProjectDetails(backend(repeated).client, source, values)).toEqual(repeated);
  const noOp = { ...receipt, values: currentProjectDetails(source), previous_slugs: source.previous_slugs!, previous_repo_full_names: source.previous_repo_full_names!, updated_at: source.updated_at };
  expect(await saveProjectDetails(backend(noOp).client, source, currentProjectDetails(source))).toEqual(noOp);
});
it("refuses a changed document acknowledged without an advancing version or an unchanged document with a fake write", async () => {
  await expect(saveProjectDetails(backend({ ...receipt, updated_at: source.updated_at }).client, source, values)).rejects.toThrow("Project details save unconfirmed");
  const noOp = { ...receipt, values: currentProjectDetails(source), previous_slugs: source.previous_slugs, previous_repo_full_names: source.previous_repo_full_names };
  await expect(saveProjectDetails(backend(noOp).client, source, currentProjectDetails(source))).rejects.toThrow("Project details save unconfirmed");
});
it("accepts only a narrow, contradictory-version-free conflict receipt", async () => {
  const conflict = { kind: "conflict", id: source.id, user_id: source.user_id, source_updated_at: receipt.updated_at, updated_at: receipt.updated_at };
  expect(await saveProjectDetails(backend(conflict).client, source, values)).toEqual(conflict);
  for (const invalid of [{ ...conflict, source_updated_at: source.updated_at }, { ...conflict, updated_at: source.updated_at }, { ...conflict, values }, { ...conflict, id: source.user_id }]) await expect(saveProjectDetails(backend(invalid).client, source, values)).rejects.toThrow();
});
it("rejects incomplete, foreign, overbroad or changed-field acknowledgements", async () => {
  for (const data of [null, [], { ...receipt, id: source.user_id }, { ...receipt, user_id: source.id }, { ...receipt, notes: "Private text" }, { ...receipt, values: { ...values, notes: "Replace" } },
    { ...receipt, values: { ...values, name: "Unexpected" } }, { ...receipt, previous_slugs: ["original"] }, { ...receipt, previous_repo_full_names: ["owner/current", "owner/earlier"] },
    { ...receipt, source_updated_at: "2026-10-24T09:30:00Z" }, { ...receipt, updated_at: "2026-10-24T08:00:00Z" }, { ...receipt, previous_slugs: undefined }]) await expect(saveProjectDetails(backend(data).client, source, values)).rejects.toThrow();
  await expect(saveProjectDetails(backend(receipt, { message: "Private details" }).client, source, values)).rejects.toThrow("Project details save unconfirmed");
});
it("rejects malformed names, URLs, ids and histories before requesting", async () => {
  const api = backend();
  for (const input of [{ ...values, name: " " }, { ...values, name: "x".repeat(201) }, { ...values, name: "New\nName" }, { ...values, slug: "Bad Slug" }, { ...values, repo_full_name: "owner/repo/extra" },
    { ...values, repo_id: 0 }, { ...values, repo_id: Infinity }, { ...values, repo_id: 1.5 }, { ...values, repo_id: 9007199254740992 }, { ...values, repo_id: 101, repo_full_name: null },
    { ...values, url: "javascript:alert(1)" }, { ...values, url: "https://user:pass@example.com/" }, { ...values, url: "https://exam\nple.com/" }, { ...values, url: "https://example.com/" + "x".repeat(2000) },
    { ...values, dev_url: "https://example.com" }, { ...values, organization_id: "invalid" }, { ...values, engagement: "other" }, { ...values, notes: "Not a detail" }]) await expect(saveProjectDetails(api.client, source, input as ProjectDetailsValues)).rejects.toThrow();
  await expect(saveProjectDetails(api.client, { ...source, id: "invalid" }, values)).rejects.toThrow();
  await expect(saveProjectDetails(api.client, { ...source, previous_slugs: Array(501).fill("old") }, values)).rejects.toThrow(); expect(api.rpc).not.toHaveBeenCalled();
});
it("honors an abort even if its transport never settles", async () => {
  const controller = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const api = backend(); api.request.abortSignal.mockReturnValue(new Promise(() => {}));
  const pending = saveProjectDetails(api.client, source, values); controller.abort(); await expect(pending).rejects.toThrow();
});
it("combines the form's cancellation signal with the request deadline", async () => {
  const controller = new AbortController(), api = backend(); api.request.abortSignal.mockReturnValue(new Promise(() => {}));
  const pending = saveProjectDetails(api.client, source, values, controller.signal); controller.abort(); await expect(pending).rejects.toThrow();
  expect(api.request.abortSignal.mock.calls[0][0].aborted).toBe(true);
});
it("plans history without changing source arrays, retains same-id renames and clears an unrelated binding", () => {
  expect(projectDetailsHistory(source, values)).toEqual({ previous_slugs: ["earlier", "original"], previous_repo_full_names: ["owner/earlier", "owner/current"] });
  expect(source.previous_slugs).toEqual(["earlier"]); expect(source.previous_repo_full_names).toEqual(["owner/earlier"]);
  for (const desired of [{ ...values, repo_id: 202 }, { ...values, repo_id: 202, repo_full_name: source.repo_full_name }, { ...values, repo_id: null, repo_full_name: null }]) expect(projectDetailsHistory(source, desired).previous_repo_full_names).toEqual([]);
  expect(projectDetailsHistory(source, { ...values, repo_full_name: "OWNER/CURRENT" }).previous_repo_full_names).toEqual(["owner/earlier"]);
  expect(projectDetailsHistory({ ...source, repo_id: null }, { ...values, repo_full_name: source.repo_full_name }).previous_repo_full_names).toEqual(["owner/earlier"]);
  expect(projectDetailsHistory({ ...source, repo_id: null }, values).previous_repo_full_names).toEqual([]);
});
it("keeps an earlier slug/name once and preserves their stored order and spelling", () => {
  expect(projectDetailsHistory({ ...source, previous_slugs: ["original", "earlier"], previous_repo_full_names: ["OWNER/CURRENT", "owner/earlier"] }, values))
    .toEqual({ previous_slugs: ["original", "earlier"], previous_repo_full_names: ["OWNER/CURRENT", "owner/earlier"] });
});
it("applies only confirmed metadata to a matching snapshot without serializing or replacing private notes", () => {
  const spy = vi.spyOn(JSON, "stringify"), result = applyProjectDetailsReceipt([source], source, receipt);
  expect(result.reconcile).toBe(false); expect(result.projects[0]).toEqual({ ...source, ...values, previous_slugs: receipt.previous_slugs, previous_repo_full_names: receipt.previous_repo_full_names, updated_at: receipt.updated_at });
  expect(spy).not.toHaveBeenCalled(); expect(source.name).toBe("Original");
});
it("does not stamp a receipt over a newer/optimistic note, active state, history or removed project", () => {
  for (const current of [{ ...source, notes: "New optimistic note" }, { ...source, is_active: true }, { ...source, previous_slugs: ["other"] }, { ...source, updated_at: "2026-10-24T11:00:00Z" }]) {
    const result = applyProjectDetailsReceipt([current], source, receipt); expect(result.reconcile).toBe(true); expect(result.projects[0]).toBe(current);
  }
  expect(applyProjectDetailsReceipt([], source, receipt)).toEqual({ projects: [], reconcile: true });
  expect(applyProjectDetailsReceipt([source], source, { ...receipt, user_id: source.id })).toEqual({ projects: [source], reconcile: true });
});
it("keeps a later complete acknowledgement without another read or version regression", () => {
  const current = { ...source, ...values, previous_slugs: receipt.previous_slugs, previous_repo_full_names: receipt.previous_repo_full_names, notes: "Later note", updated_at: "2026-10-24T11:00:00Z" };
  const result = applyProjectDetailsReceipt([current], source, receipt); expect(result.reconcile).toBe(false); expect(result.projects[0]).toBe(current);
});
it("preserves exact microsecond versions and equivalent timezone forms", async () => {
  expect(databaseVersion("1970-01-01T00:00:00.000001Z")).toBe(BigInt(1)); expect(databaseVersion("1969-12-31T23:59:59.999999Z")).toBe(BigInt(-1));
  expect(databaseVersion("2026-10-24T11:00:00.000001+02:00")).toBe(databaseVersion("2026-10-24T09:00:00.000001Z"));
  for (const value of ["invalid", "infinity", "2026-02-31T09:00:00Z", "2026-10-24T09:00:00.0000001Z"]) expect(databaseVersion(value)).toBeNull();
  const expected = { ...source, updated_at: "2026-10-24T09:00:00.000001Z" }, saved = { ...receipt, source_updated_at: "2026-10-24T11:00:00.000001+02:00" };
  expect(await saveProjectDetails(backend(saved).client, expected, values)).toEqual(saved);
  const current = { ...expected, updated_at: "2026-10-24T09:00:00.000002Z" };
  await expect(saveProjectDetails(backend(saved).client, current, values)).rejects.toThrow("Project details save unconfirmed"); expect(applyProjectDetailsReceipt([current], expected, saved).reconcile).toBe(true);
});
it("compares independently read snapshots by primitive/array values and refuses unknown nested changes", () => {
  expect(sameProjectSnapshot(source, { ...source, previous_slugs: [...source.previous_slugs!] })).toBe(true);
  expect(sameProjectSnapshot(source, { ...source, previous_slugs: ["other"] })).toBe(false);
  expect(sameProjectSnapshot(source, { ...source, revenue: undefined })).toBe(false);
});
