import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const receipt = (saved: Record<string, unknown>) => new Response(JSON.stringify({ ok: true, saved }));
it("serializes writes and captures each intent before the caller mutates it", async () => {
  let release!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })).mockResolvedValueOnce(receipt({ hidden_navigation: ["money"] }));
  vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences } = await import("@/lib/preference-client");
  const first = saveUserPreferences({ theme: "dark" });
  const patch = { hidden_navigation: ["money"] };
  const second = saveUserPreferences(patch); patch.hidden_navigation.push("career");
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  release(receipt({ theme: "dark" })); await Promise.all([first, second]);
  expect(fetcher).toHaveBeenCalledTimes(2); expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ hidden_navigation: ["money"] });
});
it.each([{ ok: true }, { ok: false, saved: { theme: "dark" } }, { ok: true, saved: { theme: "light" } }, { ok: true, saved: { theme: "dark", language: "en" } }, { ok: true, saved: { theme: "dark", user_id: "foreign" } }])("does not acknowledge an incomplete or changed receipt (%j)", async body => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  const { saveUserPreferences } = await import("@/lib/preference-client");
  await expect(saveUserPreferences({ theme: "dark" })).rejects.toThrow("Could not save preferences.");
});
it("a failed request does not block the next save", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response("private", { status: 503 })).mockResolvedValueOnce(receipt({ theme: "light" })); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences } = await import("@/lib/preference-client");
  const first = saveUserPreferences({ theme: "dark" }); const firstResult = expect(first).rejects.toThrow("Could not save preferences.");
  const next = saveUserPreferences({ theme: "light" }); await firstResult; await next; expect(fetcher).toHaveBeenCalledTimes(2);
});
it("invalid values never reach the network", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences } = await import("@/lib/preference-client");
  await expect(saveUserPreferences({ language: "de" })).rejects.toThrow("Could not save preferences."); expect(fetcher).not.toHaveBeenCalled();
});
it("expires a stalled request, releases the queue and cancels the signal", async () => {
  const requestBudgets: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const controller = new AbortController(); if (ms === 20_000) requestBudgets.push(controller); return controller.signal; });
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(receipt({ theme: "light" })); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences } = await import("@/lib/preference-client");
  const first = saveUserPreferences({ theme: "dark" }); const failed = expect(first).rejects.toThrow("Could not save preferences."); const next = saveUserPreferences({ theme: "light" });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); requestBudgets[0].abort("private"); await failed; await next;
  expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it("does not send queued intent after its caller budget expires", async () => {
  const queues: AbortController[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => { const controller = new AbortController(); if (ms === 30_000) queues.push(controller); return controller.signal; });
  let release!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal("fetch", fetcher);
  const { saveUserPreferences } = await import("@/lib/preference-client");
  const first = saveUserPreferences({ theme: "dark" }); const second = saveUserPreferences({ theme: "light" }); const failed = expect(second).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); queues[1].abort(); await failed; release(receipt({ theme: "dark" })); await first;
  await new Promise(resolve => setTimeout(resolve, 0)); expect(fetcher).toHaveBeenCalledOnce();
});
