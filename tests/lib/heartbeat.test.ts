import { afterEach, expect, it, vi } from "vitest";
import { pingHeartbeat } from "@/lib/heartbeat";
vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());
it.each([200, 204, 400, 500])("only reports delivery for a successful HTTP %s response", async status => {
  const response = new Response(status === 204 ? null : "Synthetic monitor body", { status }); const cancel = response.body ? vi.spyOn(response.body, "cancel") : null;
  vi.stubGlobal("fetch", vi.fn(async () => response)); expect(await pingHeartbeat("https://monitor.example.test/push/synthetic")).toBe(status < 300); if (cancel) expect(cancel).toHaveBeenCalledOnce();
});
it.each([null, "", "bad-url", "file:///tmp/synthetic", "https://user:synthetic@example.test/push"])("refuses an invalid monitor destination without fetching", async url => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); expect(await pingHeartbeat(url)).toBe(false); expect(fetcher).not.toHaveBeenCalled();
});
it("settles an unresponsive monitor within its caller budget", async () => {
  const controller = new AbortController(); const fetcher = vi.fn(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
  const pending = pingHeartbeat("https://monitor.example.test/push/synthetic", controller.signal); controller.abort(); expect(await pending).toBe(false);
});
