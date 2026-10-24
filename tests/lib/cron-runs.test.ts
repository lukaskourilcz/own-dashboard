import { afterEach, expect, it, vi } from "vitest";
import { loadCronRuns } from "@/lib/cron-runs";
const run = { id: "11111111-1111-4111-8111-111111111111", name: "Synthetic run", endpoint: "", status: "success", source: "app", detail: "", fired_at: "2026-10-24T06:00:00Z", cron_id: null };
afterEach(() => vi.unstubAllGlobals());
it("accepts a typed bounded history with explicit completeness", async () => {
  const data = { days: 14, partial: true, runs: [run] }; const fetcher = vi.fn(async () => Response.json(data)); vi.stubGlobal("fetch", fetcher); expect(await loadCronRuns()).toEqual(data);
});
it.each([{ runs: [] }, { days: 14, partial: false, runs: [{ ...run, status: "unknown" }] }, { days: 14, partial: false, runs: [{ ...run, fired_at: "not a date" }] }, { days: 14, partial: false, runs: [run, run] }, { days: 1, partial: false, runs: [] }])("refuses malformed or incomplete success envelopes", async body => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body))); await expect(loadCronRuns()).rejects.toThrow();
});
it("propagates cancellation even if a response never arrives", async () => {
  const controller = new AbortController(); vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const pending = loadCronRuns(controller.signal); controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
