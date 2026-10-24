import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createAdminClient } from "@/lib/supabase/admin";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("never caches a request-scoped deadline or lets its cancellation affect another client", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-inert-fixture");
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([])); vi.stubGlobal("fetch", fetcher);
  const first = new AbortController(), second = new AbortController(), shared = createAdminClient();
  const a = createAdminClient(first.signal), b = createAdminClient(second.signal);
  expect(a).not.toBe(b); expect(a).not.toBe(shared); expect(createAdminClient()).toBe(shared);
  first.abort(new Error("Synthetic private abort reason"));
  expect((await a.from("accounts").select("id").abortSignal(first.signal)).error?.message).toContain("Request aborted"); expect(fetcher).not.toHaveBeenCalled();
  expect((await b.from("accounts").select("id").abortSignal(second.signal)).data).toEqual([]); expect(fetcher).toHaveBeenCalledOnce(); expect(second.signal.aborted).toBe(false);
});
