import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const actor = { ownerId: "owner", signal: new AbortController().signal };
const receipt = (saved: Record<string, unknown>) => new Response(JSON.stringify({ ok: true, ownerId: "owner", saved }));
it("serializes writes and captures each intent before the caller mutates it", async () => {
  let release!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })).mockResolvedValueOnce(receipt({ hidden_navigation: ["money"] }));
  vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences: save } = await import("@/lib/preference-client");
  const saveUserPreferences = (patch: Record<string, unknown>) => save(patch, actor);
  const first = saveUserPreferences({ theme: "dark" });
  const patch = { hidden_navigation: ["money"] };
  const second = saveUserPreferences(patch); patch.hidden_navigation.push("career");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  release(receipt({ theme: "dark" })); await Promise.all([first, second]);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ hidden_navigation: ["money"] });
});
it.each([{ ok: true }, { ok: false, saved: { theme: "dark" } }, { ok: true, saved: { theme: "light" } }, { ok: true, saved: { theme: "dark", language: "en" } }, { ok: true, saved: { theme: "dark", user_id: "foreign" } }])("does not acknowledge an incomplete or changed receipt (%j)", async body => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  const { saveUserPreferences: save } = await import("@/lib/preference-client");
  const saveUserPreferences = (patch: Record<string, unknown>) => save(patch, actor);
  await expect(saveUserPreferences({ theme: "dark" })).rejects.toThrow("Could not save preferences.");
});
it("a failed request does not block the next save", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("private", { status: 503 })).mockResolvedValueOnce(receipt({ theme: "light" })); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences: save } = await import("@/lib/preference-client");
  const saveUserPreferences = (patch: Record<string, unknown>) => save(patch, actor);
  const first = saveUserPreferences({ theme: "dark" }); const firstResult = expect(first).rejects.toThrow("Could not save preferences.");
  const next = saveUserPreferences({ theme: "light" }); await firstResult; await next; expect(fetcher).toHaveBeenCalledTimes(2);
});
it("invalid values never reach the network", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences: save } = await import("@/lib/preference-client");
  const saveUserPreferences = (patch: Record<string, unknown>) => save(patch, actor);
  await expect(saveUserPreferences({ language: "de" })).rejects.toThrow("Could not save preferences."); expect(fetcher).not.toHaveBeenCalled();
});
it("does not normalize an altered write receipt into a false match", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(receipt({ visible_repo_ids: ["42", "42"] })));
  const { saveUserPreferences: save } = await import("@/lib/preference-client");
  const saveUserPreferences = (patch: Record<string, unknown>) => save(patch, actor);
  await expect(saveUserPreferences({ visible_repo_ids: ["42"] })).rejects.toThrow("Could not save preferences.");
});
it("omits undefined optional fields consistently with the JSON request", async () => {
  const fetcher = vi.fn().mockResolvedValue(receipt({ theme: "dark" })); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences: save } = await import("@/lib/preference-client");
  const saveUserPreferences = (patch: Record<string, unknown>) => save(patch, actor);
  await saveUserPreferences({ theme: "dark", timezone: undefined }); expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ theme: "dark" });
});
it("expires a stalled request, releases the queue and cancels the signal", async () => {
  const requestBudgets: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const controller = new AbortController(); if (ms === 20_000) requestBudgets.push(controller); return controller.signal; });
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(receipt({ theme: "light" })); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences: save } = await import("@/lib/preference-client");
  const saveUserPreferences = (patch: Record<string, unknown>) => save(patch, actor);
  const first = saveUserPreferences({ theme: "dark" }); const failed = expect(first).rejects.toThrow("Could not save preferences."); const next = saveUserPreferences({ theme: "light" });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); requestBudgets[0].abort("private"); await failed; await next;
  expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it("does not send queued intent after its caller budget expires", async () => {
  const queues: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const controller = new AbortController(); if (ms === 30_000) queues.push(controller); return controller.signal; });
  let release!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences: save } = await import("@/lib/preference-client");
  const saveUserPreferences = (patch: Record<string, unknown>) => save(patch, actor);
  const first = saveUserPreferences({ theme: "dark" }); const second = saveUserPreferences({ theme: "light" }); const failed = expect(second).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); queues[1].abort(); await failed; release(receipt({ theme: "dark" })); await first;
  await new Promise(resolve => setTimeout(resolve, 0)); expect(fetcher).toHaveBeenCalledOnce();
});

it("captures the actor before queueing and rejects another owner's receipt", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, ownerId: "owner-b", saved: { theme: "dark" } }))); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences } = await import("@/lib/preference-client");
  const mutable = { ownerId: "owner-a", signal: new AbortController().signal };
  const pending = saveUserPreferences({ theme: "dark" }, mutable); mutable.ownerId = "owner-b";
  await expect(pending).rejects.toThrow("Could not save preferences.");
  expect(fetcher.mock.calls[0][1].headers["x-own-dashboard-owner"]).toBe("owner-a");
});
it("cancels both pending and queued work when its owner scope is retired", async () => {
  let release!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences } = await import("@/lib/preference-client"); const controller = new AbortController(), captured = { ownerId: "owner-a", signal: controller.signal };
  const first = saveUserPreferences({ theme: "dark" }, captured), next = saveUserPreferences({ theme: "light" }, captured);
  const settled = Promise.allSettled([first, next]); await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); controller.abort();
  expect((await settled).map(result => result.status)).toEqual(["rejected", "rejected"]);
  release(receipt({ theme: "dark" })); await new Promise(resolve => setTimeout(resolve, 0)); expect(fetcher).toHaveBeenCalledOnce();
});
it("does not hold another owner's save behind a stalled former-owner queue", async () => {
  const controller = new AbortController();
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, ownerId: "owner-b", saved: { theme: "light" } }))); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences } = await import("@/lib/preference-client");
  const first = saveUserPreferences({ theme: "dark" }, { ownerId: "owner-a", signal: controller.signal }); const failed = expect(first).rejects.toThrow();
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  await saveUserPreferences({ theme: "light" }, { ownerId: "owner-b", signal: new AbortController().signal }); controller.abort(); await failed;
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([undefined, "foreign"])("does not load an unbound preference read receipt (%s)", async ownerId => {
  const { DEFAULT_UI_PREFERENCES } = await import("@/lib/ui-preferences-contract");
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...DEFAULT_UI_PREFERENCES, sync_available: true, ownerId }))); vi.stubGlobal("fetch", fetcher);
  const { fetchUserPreferences } = await import("@/lib/preference-client");
  await expect(fetchUserPreferences(actor)).rejects.toThrow("Could not load preferences.");
  expect(fetcher.mock.calls[0][1].headers["x-own-dashboard-owner"]).toBe("owner");
});
it("loads only the exact current owner read receipt", async () => {
  const { DEFAULT_UI_PREFERENCES } = await import("@/lib/ui-preferences-contract");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...DEFAULT_UI_PREFERENCES, sync_available: true, ownerId: "owner" }))));
  const { fetchUserPreferences } = await import("@/lib/preference-client");
  expect(await fetchUserPreferences(actor)).toEqual(DEFAULT_UI_PREFERENCES);
});
