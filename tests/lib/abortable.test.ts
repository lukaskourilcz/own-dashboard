import { expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { awaitWithSignal, fetchWithSignal } from "@/lib/abortable";
it("settles promptly on abort and observes a late rejection without exposing its reason", async () => {
  const controller = new AbortController(); let reject!: (error: unknown) => void;
  const original = new Promise<never>((_resolve, fail) => { reject = fail; });
  const pending = awaitWithSignal(original, controller.signal), refused = expect(pending).rejects.toMatchObject({ name: "AbortError", message: "Request aborted" });
  controller.abort(new Error("Synthetic private abort reason")); await refused; reject(new Error("Synthetic late provider failure")); await Promise.resolve();
});
it("retains normal completion and failure and removes its abort listener", async () => {
  const controller = new AbortController(), remove = vi.spyOn(controller.signal, "removeEventListener");
  expect(await awaitWithSignal(Promise.resolve(1), controller.signal)).toBe(1); await Promise.resolve(); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  await expect(awaitWithSignal(Promise.reject(new Error("Synthetic ordinary failure")), controller.signal)).rejects.toThrow("Synthetic ordinary failure");
});
it("combines caller cancellation and normalizes timeout reasons for the SDK", async () => {
  const parent = new AbortController(), caller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_input, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
  }));
  const pending = fetchWithSignal(parent.signal, fetcher)("https://synthetic.invalid", { signal: caller.signal });
  const refused = expect(pending).rejects.toMatchObject({ name: "AbortError", message: "Request aborted" });
  caller.abort(new DOMException("Synthetic timeout", "TimeoutError")); await refused;
  expect(parent.signal.aborted).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
});
it("refuses an expired budget before calling fetch", async () => {
  const fetcher = vi.fn<typeof fetch>(), signal = AbortSignal.abort(new Error("Synthetic private reason"));
  await expect(fetchWithSignal(signal, fetcher)("https://synthetic.invalid")).rejects.toMatchObject({ name: "AbortError", message: "Request aborted" }); expect(fetcher).not.toHaveBeenCalled();
});
it("interrupts the real database SDK's long Retry-After sleep without another network request", async () => {
  const controller = new AbortController(); const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("Synthetic retry", { status: 520, headers: { "Retry-After": "3600" } }));
  const client = createClient("https://synthetic.invalid", "synthetic-public-config", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchWithSignal(controller.signal, fetcher) } });
  const pending = Promise.resolve(client.from("accounts").select("id").abortSignal(controller.signal));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); controller.abort(new DOMException("Synthetic timeout", "TimeoutError"));
  const result = await pending; expect(result.error?.message).toContain("Request aborted"); expect(fetcher).toHaveBeenCalledOnce();
});
