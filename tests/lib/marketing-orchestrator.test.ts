import { beforeEach, describe, expect, it, vi } from "vitest";
import { synchronizeMarketingSources } from "@/lib/marketing/orchestrator";
import { SourceRefreshError, type SourceRefreshResult } from "@/lib/marketing/source-refresh";
import { parseSourcePacket } from "@/lib/marketing/contracts";
import type { createAdminClient } from "@/lib/supabase/admin";
import heldQuestion from "../../templates/marketing/benchmarks/devshark-question.json";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), ingest: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/marketing/worker-runtime", () => ({ enqueueMarketingJob: vi.fn(), executeMarketingJob: vi.fn() }));
vi.mock("@/lib/marketing/store", () => ({ ingestSource: (...args: unknown[]) => mocks.ingest(...args), sourceReferences: vi.fn() }));
vi.mock("@/lib/marketing/source-refresh", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/marketing/source-refresh")>();
  return { ...original, refreshMarketingSources: (...args: unknown[]) => mocks.refresh(...args) };
});
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
type Row = Record<string, unknown>;
function database(events: Row[] = [], sources: Row[] = []) {
  const writes: Row[] = []; const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const failures = { read: false, write: false, sources: false };
  const db = { from(table: string) {
    const filters: Array<[string, unknown]> = []; let acceptedIds: unknown[] | null = null;
    reads.push({ table, filters });
    const result = () => ({ data: (table === "marketing_events" ? [...events].reverse() : sources).filter((row) => filters.every(([key, value]) => row[key] === value) && (!acceptedIds || acceptedIds.includes(row.source_id))), error: table === "marketing_events" ? failures.read : failures.sources });
    const query = {
      select: () => query, order: () => query, limit: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: (_key: string, values: unknown[]) => { acceptedIds = values; return query; },
      maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
      insert: async (row: Row) => { if (!failures.write) { writes.push(row); events.push(row); } return { error: failures.write }; },
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    }; return query;
  } } as unknown as ReturnType<typeof createAdminClient>;
  return { db, reads, writes, failures };
}
function page(offset: number, cursor: string | null = `test-only-cursor-${offset + 20}`): SourceRefreshResult {
  // Authored content, synthetic discovery identifiers only; retained eligibility is never changed.
  return { packets: Array.from({ length: 20 }, (_, index) => parseSourcePacket({ ...structuredClone(heldQuestion), sourceId: `question:offline-discovery-${offset + index}` })),
    held: [], observedAt: "2026-10-13T12:00:00Z", noEditionDates: [], nextCursor: cursor, dropped: 0 };
}
const cursorEvent = (cursor: string, user_id = owner): Row => ({ user_id, kind: "source-discovery-devshark", payload: { cursor } });
beforeEach(() => { mocks.refresh.mockReset(); mocks.ingest.mockReset(); mocks.ingest.mockResolvedValue({ usable: false }); });

describe("persisted owner-scoped marketing source discovery", () => {
  it("continues with the saved cursor so two discoveries ingest 40 distinct sources instead of repeating the first 20", async () => {
    const state = database([cursorEvent("foreign-cursor", other)]);
    mocks.refresh.mockImplementation(async ({ cursor }: { cursor?: string }) => cursor ? page(20) : page(0));
    const signal = new AbortController().signal;
    await synchronizeMarketingSources(state.db, owner, "devshark", undefined, undefined, signal);
    await synchronizeMarketingSources(state.db, owner, "devshark", undefined, undefined, signal);
    expect(mocks.refresh.mock.calls.map(([input]) => input.cursor)).toEqual([undefined, "test-only-cursor-20"]);
    expect(mocks.refresh.mock.calls.every(([input]) => input.signal === signal)).toBe(true);
    expect(new Set(mocks.ingest.mock.calls.map(([, , packet]) => packet.sourceId)).size).toBe(40);
    expect(mocks.ingest.mock.calls.every(([, user, packet, brand]) => user === owner && brand === "devshark" && packet.eligible === false)).toBe(true);
    expect(state.writes.map((row) => row.payload)).toEqual([{ cursor: "test-only-cursor-20" }, { cursor: "test-only-cursor-40" }]);
    const cursorReads = state.reads.filter((read) => read.filters.length > 0);
    expect(cursorReads).toHaveLength(2);
    expect(cursorReads.every((read) => read.filters.some(([key, value]) => key === "user_id" && value === owner))).toBe(true);
    expect(state.writes.every((write) => write.user_id === owner)).toBe(true);
    expect(heldQuestion.eligible).toBe(false);
  });
  it("resets only a typed stale-cursor refusal and persists the replacement cursor", async () => {
    const state = database([cursorEvent("test-stale-cursor")]);
    mocks.refresh.mockRejectedValueOnce(new SourceRefreshError("source-cursor-stale")).mockResolvedValueOnce(page(0, "test-fresh-cursor"));
    await synchronizeMarketingSources(state.db, owner, "devshark");
    expect(mocks.refresh.mock.calls.map(([input]) => input.cursor)).toEqual(["test-stale-cursor", undefined]);
    expect(state.writes[0].payload).toEqual({ cursor: "test-fresh-cursor" });
    expect(mocks.ingest).toHaveBeenCalledTimes(20);
  });
  it.each([new SourceRefreshError("source-current-unavailable"), new SourceRefreshError("source-response-invalid"), new Error("source-cursor-stale")])("keeps the saved cursor and does not fall back after a transient/untyped failure: %s", async (error) => {
    const state = database([cursorEvent("test-preserved-cursor")]); mocks.refresh.mockRejectedValueOnce(error);
    await expect(synchronizeMarketingSources(state.db, owner, "devshark")).rejects.toBe(error);
    expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(mocks.ingest).not.toHaveBeenCalled(); expect(state.writes).toEqual([]);
  });
  it("uses an explicit caller cursor without reading a different stored head", async () => {
    const state = database([cursorEvent("stored-cursor")]); mocks.refresh.mockResolvedValueOnce(page(0, null));
    await synchronizeMarketingSources(state.db, owner, "devshark", undefined, "explicit-cursor");
    expect(mocks.refresh.mock.calls[0][0].cursor).toBe("explicit-cursor");
    expect(state.reads.filter((read) => read.table === "marketing_events")).toHaveLength(1); // Persistence only.
    expect(state.writes[0].payload).toEqual({ cursor: null });
  });
  it("does not reset the discovery cursor for a targeted refresh and persists a held producer tombstone", async () => {
    const packet = parseSourcePacket(heldQuestion);
    const state = database([cursorEvent("keep-discovery-cursor")], [{ user_id: owner, brand: "devshark", source_id: packet.sourceId, packet }]);
    const response: SourceRefreshResult = { packets: [], held: [{ sourceId: packet.sourceId, reason: "source-removed" }], observedAt: "2026-10-13T12:00:00Z", noEditionDates: [], nextCursor: null, dropped: 0 };
    mocks.refresh.mockResolvedValueOnce(response);
    await synchronizeMarketingSources(state.db, owner, "devshark", [packet.sourceId]);
    expect(mocks.refresh).toHaveBeenCalledWith(expect.objectContaining({ sourceIds: [packet.sourceId], previousPackets: [packet] }));
    expect(mocks.ingest).toHaveBeenCalledWith(state.db, owner, expect.objectContaining({ eligible: false, eligibilityReason: "source-removed", observedAt: response.observedAt }), "devshark");
    expect(state.reads.some((read) => read.table === "marketing_events")).toBe(false); expect(state.writes).toEqual([]);
    mocks.refresh.mockRejectedValueOnce(new SourceRefreshError("source-cursor-stale"));
    await expect(synchronizeMarketingSources(state.db, owner, "devshark", [packet.sourceId])).rejects.toThrow("source-cursor-stale");
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });
  it("fails closed when the cursor store is unavailable, and reports persistence failures", async () => {
    const state = database(); state.failures.read = true;
    await expect(synchronizeMarketingSources(state.db, owner, "devshark")).rejects.toThrow("source-cursor-state-unavailable");
    expect(mocks.refresh).not.toHaveBeenCalled();
    state.failures.read = false; state.failures.write = true; mocks.refresh.mockResolvedValueOnce(page(0));
    await expect(synchronizeMarketingSources(state.db, owner, "devshark")).rejects.toThrow("source-cursor-save-failed");
    expect(state.writes).toEqual([]);
  });
  it("does not advance the cursor when ingesting a discovered source fails", async () => {
    const state = database([cursorEvent("test-preserved-cursor")]);
    mocks.refresh.mockResolvedValueOnce(page(20)); mocks.ingest.mockRejectedValueOnce(new Error("source-save-failed"));
    await expect(synchronizeMarketingSources(state.db, owner, "devshark")).rejects.toThrow("source-save-failed");
    expect(state.writes).toEqual([]); expect(mocks.ingest).toHaveBeenCalledTimes(1);
  });
  it("does not read or write a devShark cursor while discovering DNESKAi", async () => {
    const state = database(); mocks.refresh.mockResolvedValueOnce({ ...page(0), packets: [] });
    await synchronizeMarketingSources(state.db, owner, "dneskai");
    expect(state.reads).toEqual([]); expect(state.writes).toEqual([]);
  });
});
