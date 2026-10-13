import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordMarketingOwnerFeedback } from "@/lib/marketing/owner-feedback";
import { LANGSMITH_EU_ENDPOINT, marketingTraceMetadata } from "@/lib/marketing/tracing";
import { parseContentRevision, parseSourcePacket } from "@/lib/marketing/contracts";
import { revisionHash } from "@/lib/marketing/hashes";
import type { createAdminClient } from "@/lib/supabase/admin";
import heldQuestion from "../../templates/marketing/benchmarks/devshark-question.json";

vi.mock("server-only", () => ({}));
const sdk = vi.hoisted(() => ({ read: vi.fn(), feedback: vi.fn(), update: vi.fn() }));
vi.mock("langsmith", () => ({ Client: class { readRun = sdk.read; createFeedback = sdk.feedback; updateRun = sdk.update; } }));
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const originalId = "33333333-3333-4333-8333-333333333333";
const editedId = "44444444-4444-4444-8444-444444444444";
const traceId = "55555555-5555-4555-8555-555555555555";
const env = { MARKETING_LANGSMITH_ENABLED: "true", LANGSMITH_ENDPOINT: LANGSMITH_EU_ENDPOINT, LANGSMITH_API_KEY: "TEST ONLY", LANGSMITH_PROJECT: "test-only" };
const original = parseContentRevision({ schemaVersion: "marketing-content/1", brand: "devshark", title: heldQuestion.content.title,
  caption: "PRIVATE TEST GENERATED CAPTION", format: "carousel", sources: [{ sourceId: heldQuestion.sourceId, sourceRevision: heldQuestion.sourceRevision, contentHash: heldQuestion.contentHash }],
  knowledgeIds: [], assets: [], account: { id: "test-only", platform: "instagram", handle: "test-only" }, scheduledAt: "2026-10-14T08:00:00Z", timeZone: "Europe/Prague",
  templateVersion: "devshark-editorial/2", promptVersion: "marketing-copy/2", model: "claude-test-only", traceId });
const edited = { ...original, caption: "PRIVATE TEST OWNER EDITED CAPTION" };
const originalHash = revisionHash(original); const editedHash = revisionHash(edited);
type Row = { id: string; user_id: string; content_hash: string; revision: typeof original; created_at: string };
const rows = (): Row[] => [
  { id: originalId, user_id: owner, content_hash: originalHash, revision: structuredClone(original), created_at: "2026-10-12T08:00:00Z" },
  { id: editedId, user_id: owner, content_hash: editedHash, revision: structuredClone(edited), created_at: "2026-10-13T08:00:00Z" },
];
function database(records = rows()) {
  const queries: Array<{ filters: Array<[string, unknown]>; order?: { key: string; ascending: boolean }; limit?: number }> = [];
  const state = { error: false };
  const db = { from(table: string) {
    expect(table).toBe("marketing_revisions");
    const trace: (typeof queries)[number] = { filters: [] }; queries.push(trace);
    const query = { select: (columns: string) => { expect(columns).toBe("id,content_hash,revision"); return query; },
      eq: (key: string, value: unknown) => { trace.filters.push([key, value]); return query; },
      order: (key: string, options: { ascending: boolean }) => { trace.order = { key, ...options }; return query; },
      limit: (count: number) => { trace.limit = count; return query; },
      maybeSingle: async () => {
        const matching = records.filter((row) => trace.filters.every(([key, value]) => key === "revision->>traceId" ? row.revision.traceId === value : row[key as keyof Row] === value));
        if (trace.order) matching.sort((a, b) => a.created_at.localeCompare(b.created_at));
        return { data: matching[0] ?? null, error: state.error };
      },
    }; return query;
  } } as unknown as ReturnType<typeof createAdminClient>;
  return { db, queries, state };
}
const input = { traceId, revisionId: editedId, revisionHash: editedHash, decision: "edited" as const };
beforeEach(() => {
  vi.clearAllMocks(); sdk.feedback.mockResolvedValue({});
  sdk.read.mockResolvedValue({ extra: { metadata: { ...marketingTraceMetadata({ revisionId: originalId, source: parseSourcePacket(heldQuestion), model: "claude-test-only", promptVersion: "marketing-copy/2", templateVersion: "devshark-editorial/2", knowledgeIds: [] }),
    status: "review", revision_hash: originalHash, attempts: 1, input_tokens: 100, output_tokens: 100, estimated_cost_usd: 0.001, issue_codes: [] } } });
});

describe("verified owner feedback lineage", () => {
  it.each(["edited", "approved", "returned"] as const)("maps %s on an edited owned revision to its original trace without transmitting copy", async (decision) => {
    const state = database();
    expect(await recordMarketingOwnerFeedback({ ...input, decision }, env, { db: state.db, ownerId: owner })).toBe(true);
    expect(state.queries[1]).toEqual({ filters: [["user_id", owner], ["revision->>traceId", traceId]], order: { key: "created_at", ascending: true }, limit: 1 });
    expect(sdk.feedback).toHaveBeenCalledWith(traceId, "owner-review", { score: decision === "approved" ? 1 : 0, value: decision, sourceInfo: {
      revision_id: editedId, revision_hash: editedHash, generated_revision_id: originalId, generated_revision_hash: originalHash,
    } });
    expect(JSON.stringify(sdk.feedback.mock.calls)).not.toContain("PRIVATE TEST"); expect(sdk.update).not.toHaveBeenCalled();
  });
  it("ignores an earlier duplicate trace belonging to another owner", async () => {
    const foreign = { ...rows()[0], id: "66666666-6666-4666-8666-666666666666", user_id: other, created_at: "2026-10-01T00:00:00Z" };
    const state = database([foreign, ...rows()]);
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(true);
    expect(sdk.feedback.mock.calls[0][2].sourceInfo.generated_revision_id).toBe(originalId);
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: other })).toBe(false);
    expect(sdk.feedback).toHaveBeenCalledTimes(1);
  });
  it("refuses forged reviewed tuples, canonical-hash conflicts, and a forged origin SDK binding", async () => {
    const state = database();
    expect(await recordMarketingOwnerFeedback({ ...input, revisionHash: "a".repeat(64) }, env, { db: state.db, ownerId: owner })).toBe(false);
    const forged = rows(); forged[0].revision.caption = "PRIVATE TEST CHANGED SOURCE";
    expect(await recordMarketingOwnerFeedback(input, env, { db: database(forged).db, ownerId: owner })).toBe(false);
    sdk.read.mockResolvedValueOnce({ extra: { metadata: { ...(await sdk.read()).extra.metadata, revision_id: editedId, revision_hash: editedHash } } });
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(false);
    expect(sdk.feedback).not.toHaveBeenCalled(); expect(sdk.update).not.toHaveBeenCalled();
  });
  it("returns false for unavailable stored scope, trace outages, disabled tracing and unknown input fields", async () => {
    const state = database(); state.state.error = true;
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(false);
    state.state.error = false; sdk.read.mockRejectedValueOnce(new Error("PRIVATE TEST SDK OUTAGE"));
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(false);
    expect(await recordMarketingOwnerFeedback(input, { ...env, MARKETING_LANGSMITH_ENABLED: "false" }, { db: state.db, ownerId: owner })).toBe(false);
    expect(await recordMarketingOwnerFeedback({ ...input, comment: "PRIVATE TEST OWNER NOTE" } as typeof input, env, { db: state.db, ownerId: owner })).toBe(false);
    expect(sdk.feedback).not.toHaveBeenCalled();
  });
  it("preserves the environment-second signature for an original unedited revision", async () => {
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: originalId, revisionHash: originalHash, decision: "approved" }, env)).toBe(true);
    expect(sdk.feedback.mock.calls[0][2].sourceInfo).toEqual({ revision_id: originalId, revision_hash: originalHash });
    expect(await recordMarketingOwnerFeedback(input, env)).toBe(false);
  });
});
