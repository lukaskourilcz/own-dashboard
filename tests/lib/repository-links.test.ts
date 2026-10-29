import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { applyRemovedRepositoryLink, applySavedRepositoryLink, normalizeRepositoryUrl, removeRepositoryLink, saveRepositoryLink } from "@/lib/repository-links";
import type { RepoLink } from "@/lib/types";
const owner = "11111111-1111-4111-8111-111111111111", id = "33333333-3333-4333-8333-333333333333", other = "44444444-4444-4444-8444-444444444444";
const link: RepoLink = { id, user_id: owner, repo_id: "123", repo_full_name: "owner/fixture", url: "https://example.test/", created_at: "2026-10-24T04:00:00Z", updated_at: "2026-10-24T04:00:00Z" };
const repo = { id: 123, full_name: "owner/fixture" };
function backend(initial: RepoLink | null = link, alter: (row: RepoLink) => unknown = row => row) {
  let row = initial;
  const filters: [string, unknown][] = [], options: unknown[] = [];
  const auth = vi.fn(async () => ({ data: { user: { id: owner } }, error: null }));
  const write = vi.fn();
  const client = { auth: { getUser: auth }, from: () => {
    let patch: Record<string, unknown>, method: string;
    const conditions: [string, unknown][] = [];
    const builder = {
      update: (value: Record<string, unknown>) => { method = "update"; patch = value; return builder; },
      upsert: (value: Record<string, unknown>, config: unknown) => { method = "insert"; patch = value; options.push(config); return builder; },
      delete: () => { method = "delete"; return builder; }, select: () => builder,
      eq: (field: string, value: unknown) => { filters.push([field, value]); conditions.push([field, value]); return builder; },
      abortSignal: (signal: AbortSignal) => { expect(signal).toBeInstanceOf(AbortSignal); return builder; },
      maybeSingle: async () => {
        write(method, patch);
        if (method === "insert" && row) return { data: null, error: null };
        if (method !== "insert" && (!row || conditions.some(([field, value]) => row![field as keyof RepoLink] !== value))) return { data: null, error: null };
        const saved = method === "insert" ? { ...link, ...patch } as RepoLink : method === "update" ? { ...row!, ...patch } as RepoLink : row!;
        row = method === "delete" ? null : saved;
        return { data: alter(saved), error: null };
      },
    }; return builder;
  } } as unknown as SupabaseClient;
  return { client, auth, filters, options, write };
}
it("creates without replacing a concurrently inserted link and confirms every source field", async () => {
  const state = backend(null); const saved = await saveRepositoryLink(state.client, repo, null, "example.test/new");
  expect(saved).toMatchObject({ user_id: owner, repo_id: "123", repo_full_name: repo.full_name, url: "https://example.test/new" });
  expect(state.options).toEqual([{ onConflict: "user_id,repo_id", ignoreDuplicates: true }]); expect(state.auth).toHaveBeenCalledOnce();
  await expect(saveRepositoryLink(backend().client, repo, null, "example.test/new")).rejects.toThrow("unconfirmed");
});
it("updates only the captured own-row version without an extra authentication lookup", async () => {
  const state = backend(); expect(await saveRepositoryLink(state.client, repo, link, "https://example.test/new")).toMatchObject({ id, url: "https://example.test/new" });
  expect(state.filters).toEqual([["id", id], ["user_id", owner], ["repo_id", "123"], ["updated_at", link.updated_at]]); expect(state.auth).not.toHaveBeenCalled();
});
it.each(["user_id", "id", "repo_id", "repo_full_name", "url", "created_at", "updated_at"] as const)("refuses a changed %s receipt", async field => {
  const replacements = { user_id: other, id: other, repo_id: "456", repo_full_name: "other/repo", url: "https://different.test/", created_at: "2099-01-01T00:00:00Z", updated_at: "2000-01-01T00:00:00Z" };
  const state = backend(link, row => ({ ...row, [field]: replacements[field] }));
  await expect(saveRepositoryLink(state.client, repo, link, "https://example.test/new")).rejects.toThrow("unconfirmed");
});
it("does not confirm stale or suppressed updates/deletions", async () => {
  const changed = { ...link, updated_at: "2099-01-01T00:00:00Z" };
  await expect(saveRepositoryLink(backend(changed).client, repo, link, "example.test/new")).rejects.toThrow("unconfirmed");
  await expect(removeRepositoryLink(backend(changed).client, link)).rejects.toThrow("unconfirmed");
  await expect(removeRepositoryLink(backend(link, () => null).client, link)).rejects.toThrow("unconfirmed");
});
it("requires a complete captured deletion receipt and keeps unrelated records", async () => {
  const state = backend(); await removeRepositoryLink(state.client, link); expect(state.auth).not.toHaveBeenCalled();
  expect(state.filters).toEqual([["id", id], ["user_id", owner], ["repo_id", "123"], ["updated_at", link.updated_at]]);
  await expect(removeRepositoryLink(backend(link, row => ({ ...row, url: "https://different.test/" })).client, link)).rejects.toThrow("unconfirmed");
});
it.each(["javascript:alert(1)", "javascript://example.test", "https://user:password@example.test", "example.test\n", "//example.test", "x".repeat(2001)])("rejects unsafe URLs before contacting auth or the database (%s)", async value => {
  const state = backend(null); expect(normalizeRepositoryUrl(value)).toBeNull(); await expect(saveRepositoryLink(state.client, repo, null, value)).rejects.toThrow("Invalid"); expect(state.auth).not.toHaveBeenCalled(); expect(state.write).not.toHaveBeenCalled();
});
it("keeps a newer edit/removal and never rolls a complete old list back", () => {
  const unrelated = { ...link, id: other, repo_id: "456" }, saved = { ...link, url: "https://saved.test/", updated_at: "2026-10-24T04:01:00Z" }, newer = { ...saved, url: "https://newer.test/", updated_at: "2026-10-24T04:02:00Z" };
  expect(applySavedRepositoryLink([link, unrelated], link, saved)).toEqual([saved, unrelated]);
  expect(applySavedRepositoryLink([newer, unrelated], link, saved)).toEqual([newer, unrelated]);
  expect(applySavedRepositoryLink([unrelated], link, saved)).toEqual([unrelated]);
  expect(applySavedRepositoryLink([newer], null, saved)).toEqual([newer]);
  expect(applyRemovedRepositoryLink([link, unrelated], link)).toEqual([unrelated]);
  expect(applyRemovedRepositoryLink([newer, unrelated], link)).toEqual([newer, unrelated]);
});
