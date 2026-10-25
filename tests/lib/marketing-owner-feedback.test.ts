import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARKETING_EDIT_CHAIN_LIMIT, createMarketingOwnerFeedbackScope, recordMarketingOwnerFeedback } from "@/lib/marketing/owner-feedback";
import { LANGSMITH_EU_ENDPOINT, derivedUuid, marketingTraceMetadata } from "@/lib/marketing/tracing";
import { parseContentRevision, parseSourcePacket, type ContentRevision } from "@/lib/marketing/contracts";
import { revisionHash } from "@/lib/marketing/hashes";
import { applyDneskaiDeckEdit } from "@/lib/marketing/dneskai-revision-edit";
import type { createAdminClient } from "@/lib/supabase/admin";
import heldQuestion from "../../templates/marketing/benchmarks/devshark-question.json";
import { c, deckRevision } from "./marketing-dneskai-revision-fixture";

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
type Row = { id: string; user_id: string; content_hash: string; revision: ContentRevision; replaces_id: string | null };
const row = (id: string, revision: ContentRevision, replaces: string | null = null, user = owner): Row => ({ id, user_id: user, content_hash: revisionHash(revision), revision: structuredClone(revision), replaces_id: replaces });
const rows = (): Row[] => [row(originalId, original), row(editedId, edited, originalId)];
function database(records = rows()) {
  const queries: Array<Array<[string, unknown]>> = [];
  const state = { error: false, stall: false, signal: undefined as AbortSignal | undefined, returnOwner: undefined as string | undefined, retries: [] as boolean[], releases: [] as (() => void)[] };
  const db = { from(table: string) {
    expect(table).toBe("marketing_revisions");
    const filters: Array<[string, unknown]> = []; queries.push(filters);
    const query = { select: (columns: string) => { expect(columns).toBe("id,user_id,content_hash,revision,replaces_id"); return query; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      retry: (enabled: boolean) => { state.retries.push(enabled); return query; }, abortSignal: (signal: AbortSignal) => { state.signal = signal; return query; },
      maybeSingle: async () => {
        if (state.stall) await new Promise<void>(resolve => state.releases.push(resolve));
        const found = records.find((candidate) => filters.every(([key, value]) => candidate[key as keyof Row] === value));
        return { data: found ? { ...found, ...(state.returnOwner ? { user_id: state.returnOwner } : {}) } : null, error: state.error };
      },
    }; return query;
  } } as unknown as ReturnType<typeof createAdminClient>;
  return { db, queries, state };
}
/** The trace of the generated revision, as LangSmith returns it. */
function traceOf(revisionId: string, hash: string, extra: Record<string, unknown> = {}) {
  return { ...extra, extra: { metadata: { ...marketingTraceMetadata({ revisionId, source: parseSourcePacket(heldQuestion), model: "claude-test-only", promptVersion: "marketing-copy/2", templateVersion: "devshark-editorial/2", knowledgeIds: [] }),
    status: "review", revision_hash: hash, attempts: 1, input_tokens: 100, output_tokens: 100, estimated_cost_usd: 0.001, issue_codes: [] } } };
}
const input = { traceId, revisionId: editedId, revisionHash: editedHash, decision: "edited" as const };
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(() => {
  vi.resetAllMocks(); sdk.feedback.mockResolvedValue({});
  sdk.read.mockResolvedValue(traceOf(originalId, originalHash));
});

describe("verified owner feedback lineage", () => {
  it.each([["edited", null, "owner-edit"], ["approved", 0.5, "owner-review"], ["returned", 0, "owner-review"], ["skipped", 0, "owner-review"]] as const)("maps %s on an edited owned revision to its original trace without transmitting copy", async (decision, score, key) => {
    const state = database();
    expect(await recordMarketingOwnerFeedback({ ...input, decision }, env, { db: state.db, ownerId: owner })).toBe(true);
    expect(state.queries).toEqual([[["user_id", owner], ["id", editedId]], [["user_id", owner], ["id", originalId]]]);
    expect(sdk.feedback).toHaveBeenCalledWith(traceId, key, { ...(score === null ? {} : { score }), value: decision, sourceInfo: {
      revision_id: editedId, revision_hash: editedHash, generated_revision_id: originalId, generated_revision_hash: originalHash,
      edit_kinds: { caption: 1 }, edit_count: 1, ...(decision === "skipped" ? { reason: "skip" } : {}),
    }, feedbackId: derivedUuid("owner-feedback", key, decision, editedId, editedHash) });
    expect(JSON.stringify(sdk.feedback.mock.calls)).not.toContain("PRIVATE TEST"); expect(sdk.update).not.toHaveBeenCalled();
  });
  it("scores an approval of the generated revision 1 with no edits", async () => {
    const state = database();
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: originalId, revisionHash: originalHash, decision: "approved" }, env, { db: state.db, ownerId: owner })).toBe(true);
    expect(sdk.feedback.mock.calls[0]![2]).toMatchObject({ score: 1, value: "approved", sourceInfo: { revision_id: originalId, generated_revision_id: originalId, edit_kinds: {}, edit_count: 0 } });
  });
  it("ignores a parent belonging to another owner", async () => {
    const foreign = { ...rows()[0]!, user_id: other };
    expect(await recordMarketingOwnerFeedback(input, env, { db: database([foreign, rows()[1]!]).db, ownerId: owner })).toBe(false);
    expect(await recordMarketingOwnerFeedback(input, env, { db: database().db, ownerId: other })).toBe(false);
    expect(sdk.feedback).not.toHaveBeenCalled();
  });
  it("refuses forged reviewed tuples, canonical-hash conflicts, and a forged origin SDK binding", async () => {
    const state = database();
    expect(await recordMarketingOwnerFeedback({ ...input, revisionHash: "a".repeat(64) }, env, { db: state.db, ownerId: owner })).toBe(false);
    const forged = rows(); forged[0]!.revision.caption = "PRIVATE TEST CHANGED SOURCE";
    expect(await recordMarketingOwnerFeedback(input, env, { db: database(forged).db, ownerId: owner })).toBe(false);
    sdk.read.mockResolvedValueOnce(traceOf(editedId, editedHash));
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(false);
    expect(sdk.feedback).not.toHaveBeenCalled(); expect(sdk.update).not.toHaveBeenCalled();
  });
  it("returns false for unavailable stored scope, trace outages, disabled tracing and unknown input fields", async () => {
    const state = database(); state.state.error = true;
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(false);
    state.state.error = false; sdk.read.mockRejectedValueOnce(new Error("PRIVATE TEST SDK OUTAGE"));
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(false);
    sdk.feedback.mockRejectedValueOnce(new Error("PRIVATE TEST SDK OUTAGE"));
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(false);
    expect(await recordMarketingOwnerFeedback(input, { ...env, MARKETING_LANGSMITH_ENABLED: "false" }, { db: state.db, ownerId: owner })).toBe(false);
    expect(await recordMarketingOwnerFeedback(input, { ...env, LANGSMITH_ENDPOINT: "https://api.smith.langchain.com" }, { db: state.db, ownerId: owner })).toBe(false);
    expect(await recordMarketingOwnerFeedback({ ...input, comment: "PRIVATE TEST OWNER NOTE" } as typeof input, env, { db: state.db, ownerId: owner })).toBe(false);
    expect(sdk.feedback).toHaveBeenCalledTimes(1);
  });
  it("preserves the environment-second signature for an original unedited revision", async () => {
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: originalId, revisionHash: originalHash, decision: "approved" }, env)).toBe(true);
    expect(sdk.feedback.mock.calls[0]![2]).toMatchObject({ score: 1, sourceInfo: { revision_id: originalId, revision_hash: originalHash } });
    expect(sdk.feedback.mock.calls[0]![2].sourceInfo).not.toHaveProperty("edit_kinds");
    expect(await recordMarketingOwnerFeedback(input, env)).toBe(false);
  });
  it("sends the run's project id when LangSmith returns it", async () => {
    sdk.read.mockResolvedValue(traceOf(originalId, originalHash, { session_id: "77777777-7777-4777-8777-777777777777" }));
    expect(await recordMarketingOwnerFeedback({ ...input, decision: "approved" }, env, { db: database().db, ownerId: owner })).toBe(true);
    expect(sdk.feedback).toHaveBeenCalledWith(expect.objectContaining({ runId: traceId, sessionId: "77777777-7777-4777-8777-777777777777", key: "owner-review", score: 0.5, value: "approved" }));
  });
});

describe("DNESKAi deck edit chains", () => {
  const generatedId = "88888888-8888-4888-8888-888888888888";
  const firstEditId = "99999999-9999-4999-8999-999999999999";
  const secondEditId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const generated = { ...deckRevision(), traceId };
  // First save: caption and schedule. Second save: a headline, a picture swap and a reorder of the first two slides.
  const first = { ...generated, caption: "PRIVATE TEST owner caption.", scheduledAt: "2099-10-21T07:30:00Z" };
  const second = { ...first, deck: applyDneskaiDeckEdit(first.deck!, { slides: [{ from: 1, headline: "PRIVATE TEST nový titulek", images: [{ slot: "image-1", assetSha256: c }, first.deck!.slides[1]!.images[1]!] }, { from: 0 }, { from: 2 }] }) };
  const chain = () => [row(generatedId, generated), row(firstEditId, first, generatedId), row(secondEditId, second, firstEditId)];
  beforeEach(() => { sdk.read.mockResolvedValue(traceOf(generatedId, revisionHash(generated))); });
  it("approves after two saves at 0.5 with the kinds of the whole chain", async () => {
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: secondEditId, revisionHash: revisionHash(second), decision: "approved" }, env, { db: database(chain()).db, ownerId: owner })).toBe(true);
    const sent = sdk.feedback.mock.calls[0]![2];
    expect(sent).toMatchObject({ score: 0.5, value: "approved", sourceInfo: { generated_revision_id: generatedId, generated_revision_hash: revisionHash(generated),
      edit_kinds: { "text-headline": 1, caption: 1, "image-swap": 1, reorder: 1, schedule: 1 }, edit_count: 5 } });
    expect(JSON.stringify(sdk.feedback.mock.calls)).not.toContain("PRIVATE TEST");
  });
  it("records an edit with the kinds of its own save only", async () => {
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: secondEditId, revisionHash: revisionHash(second), decision: "edited" }, env, { db: database(chain()).db, ownerId: owner })).toBe(true);
    expect(sdk.feedback.mock.calls[0]![1]).toBe("owner-edit");
    expect(sdk.feedback.mock.calls[0]![2]).not.toHaveProperty("score");
    expect(sdk.feedback.mock.calls[0]![2].sourceInfo).toMatchObject({ edit_kinds: { "text-headline": 1, "image-swap": 1, reorder: 1 }, edit_count: 3 });
  });
  it("starts the chain at the revision whose trace it shares", async () => {
    const older = { ...generated, traceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", caption: "PRIVATE TEST earlier generation" };
    const records = [row("cccccccc-cccc-4ccc-8ccc-cccccccccccc", older), { ...row(generatedId, generated), replaces_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, ...chain().slice(1)];
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: secondEditId, revisionHash: revisionHash(second), decision: "returned" }, env, { db: database(records).db, ownerId: owner })).toBe(true);
    expect(sdk.feedback.mock.calls[0]![2]).toMatchObject({ score: 0, sourceInfo: { generated_revision_id: generatedId, edit_count: 5 } });
  });
  it("refuses a broken, cyclic or overlong chain", async () => {
    const broken = chain().filter((entry) => entry.id !== firstEditId);
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: secondEditId, revisionHash: revisionHash(second), decision: "approved" }, env, { db: database(broken).db, ownerId: owner })).toBe(false);
    const cyclic = chain(); cyclic[0]!.replaces_id = secondEditId;
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: secondEditId, revisionHash: revisionHash(second), decision: "approved" }, env, { db: database(cyclic).db, ownerId: owner })).toBe(false);
    const long = Array.from({ length: MARKETING_EDIT_CHAIN_LIMIT + 1 }, (_, index) => row(`dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, "0")}`, generated, index ? `dddddddd-dddd-4ddd-8ddd-${String(index - 1).padStart(12, "0")}` : null));
    expect(await recordMarketingOwnerFeedback({ traceId, revisionId: long.at(-1)!.id, revisionHash: revisionHash(generated), decision: "approved" }, env, { db: database(long).db, ownerId: owner })).toBe(false);
    expect(sdk.feedback).not.toHaveBeenCalled();
  });
});

it("sends only counts and an edited score for an insertion-only owned chain", async () => {
  const generated = { ...deckRevision(), traceId };
  const inserted = { ...generated, deck: applyDneskaiDeckEdit(generated.deck!, { slides: [{ from: 0 }, { from: 1 }, { insert: { type: "statement", variant: "accent", headline: "PRIVATE TEST inserted headline", alt: "PRIVATE TEST inserted alt", images: [] } }, { from: 2 }] }, { media: [], primaryCandidateId: null }) };
  sdk.read.mockResolvedValue(traceOf(originalId, revisionHash(generated)));
  expect(await recordMarketingOwnerFeedback({ traceId, revisionId: editedId, revisionHash: revisionHash(inserted), decision: "approved" }, env, { db: database([row(originalId, generated), row(editedId, inserted, originalId)]).db, ownerId: owner })).toBe(true);
  expect(sdk.feedback.mock.calls[0]![2]).toMatchObject({ score: 0.5, sourceInfo: { edit_kinds: { "insert-slide": 1 }, edit_count: 1 } });
  expect(JSON.stringify(sdk.feedback.mock.calls)).not.toContain("PRIVATE TEST"); expect(sdk.update).not.toHaveBeenCalled();
});
it("sends only a count for audio/account/engagement edits, never their private values", async () => {
  const generated = { ...deckRevision(), traceId };
  const audioId = "abcdef12-3456-4789-8abc-123456789abc", remoteAccount = "17841499999999999";
  const changed = parseContentRevision({ ...generated, account: { ...generated.account, id: remoteAccount }, audio: { trackId: audioId }, engagement: { keyword: "TESTWORD", replyMessage: "PRIVATE TEST reply body" } });
  sdk.read.mockResolvedValue(traceOf(originalId, revisionHash(generated)));
  expect(await recordMarketingOwnerFeedback({ traceId, revisionId: editedId, revisionHash: revisionHash(changed), decision: "approved" }, env, { db: database([row(originalId, generated), row(editedId, changed, originalId)]).db, ownerId: owner })).toBe(true);
  expect(sdk.feedback.mock.calls[0]![2]).toMatchObject({ score: 0.5, sourceInfo: { edit_kinds: { account: 1, audio: 1, engagement: 1 }, edit_count: 3 } });
  const sent = JSON.stringify(sdk.feedback.mock.calls); for (const value of [audioId, remoteAccount, "TESTWORD", "PRIVATE TEST"]) expect(sent).not.toContain(value);
});

describe("feedback work does not hold owner receipts open", () => {
  it("expires a stalled database chain under the total diagnostic budget", async () => {
    const controller = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const state = database(); state.state.stall = true;
    const pending = recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner });
    await vi.waitFor(() => expect(state.queries).toHaveLength(1)); controller.abort();
    expect(await pending).toBe(false); expect(state.state.signal?.aborted).toBe(true); expect(state.state.retries).toEqual([false]); expect(sdk.read).not.toHaveBeenCalled();
    state.state.releases[0]!();
  }, 500);
  it("skips a pre-cancelled owner scope before any read or provider work", async () => {
    const controller = new AbortController(); controller.abort(); const state = database();
    expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner, signal: controller.signal })).toBe(false);
    expect(state.queries).toEqual([]); expect(sdk.read).not.toHaveBeenCalled();
  });
  it("observes a late database result without continuing the chain or sending feedback", async () => {
    const controller = new AbortController(), state = database(); state.state.stall = true;
    const pending = recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner, signal: controller.signal });
    await vi.waitFor(() => expect(state.queries).toHaveLength(1)); controller.abort(); expect(await pending).toBe(false);
    state.state.releases[0]!(); await new Promise(resolve => setTimeout(resolve, 0)); expect(state.queries).toHaveLength(1); expect(sdk.feedback).not.toHaveBeenCalled();
  }, 500);
});

it("starts the shared request allowance lazily and skips later feedback after it expires", async () => {
  const controllers: AbortController[] = [];
  const timeouts = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => { const controller = new AbortController(); controllers.push(controller); return controller.signal; });
  const state = database(), scope = createMarketingOwnerFeedbackScope(state.db, owner);
  expect(timeouts).not.toHaveBeenCalled();
  expect(await recordMarketingOwnerFeedback(input, { ...env, MARKETING_LANGSMITH_ENABLED: "false" }, scope)).toBe(false); expect(timeouts).not.toHaveBeenCalled();
  expect(await recordMarketingOwnerFeedback(input, env, scope)).toBe(true); const reads = state.queries.length;
  controllers[0]!.abort(); expect(await recordMarketingOwnerFeedback(input, env, scope)).toBe(false);
  expect(state.queries).toHaveLength(reads); expect(sdk.feedback).toHaveBeenCalledTimes(1);
});
it("returns on parent cancellation while an already-started SDK write is pending", async () => {
  const controller = new AbortController(), state = database(); let release!: () => void;
  sdk.feedback.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner, signal: controller.signal });
  await vi.waitFor(() => expect(sdk.feedback).toHaveBeenCalledOnce()); controller.abort(); expect(await pending).toBe(false); release();
  await new Promise(resolve => setTimeout(resolve, 0)); expect(sdk.feedback).toHaveBeenCalledOnce();
}, 500);

it("refuses a returned lineage row stamped with a different owner", async () => {
  const state = database(); state.state.returnOwner = other;
  expect(await recordMarketingOwnerFeedback(input, env, { db: state.db, ownerId: owner })).toBe(false); expect(state.queries).toHaveLength(1); expect(sdk.read).not.toHaveBeenCalled();
});
