import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_EDITS_DATASET, buildOwnerEditRecords, parseOwnerEditOptions, runOwnerEdits, type OwnerEditIo } from "../../scripts/langsmith-owner-edits";
import { createMarketingTracer } from "@/lib/marketing/tracing";
import { revisionContentHash } from "@/lib/marketing/hashes";
import type { ContentRevision } from "@/lib/marketing/contracts";
import { applyDneskaiDeckEdit } from "@/lib/marketing/dneskai-deck-edit";
import { deckRevision } from "./marketing-dneskai-revision-fixture";

const sdk = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[], hasDataset: vi.fn(), readDataset: vi.fn(), createDataset: vi.fn(), listExamples: vi.fn(), createExamples: vi.fn(), updateExamples: vi.fn() }));
vi.mock("langsmith", () => ({ Client: class {
  constructor(config: Record<string, unknown>) { sdk.configs.push(config); }
  hasDataset = sdk.hasDataset; readDataset = sdk.readDataset; createDataset = sdk.createDataset; listExamples = sdk.listExamples; createExamples = sdk.createExamples; updateExamples = sdk.updateExamples;
} }));

const id = (n: number) => `${String(n).repeat(8).slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const trace = (n: number) => `${String(n).repeat(8).slice(0, 8)}-1111-4111-8111-${String(n).padStart(12, "0")}`;
function row(n: number, revision: ContentRevision, options: { replaces?: number; status?: string; approved?: boolean; brand?: string } = {}) {
  const hash = revisionContentHash(revision);
  return { id: id(n), replaces_id: options.replaces ? id(options.replaces) : null, brand: options.brand ?? "dneskai", status: options.status ?? "review", content_hash: hash,
    approved_hash: options.approved ? hash : null, revision, created_at: `2026-10-2${n % 10}T08:00:00Z` };
}
/** Test-only rows: an approval after one edit, an approval as generated, a return, a skip, a superseded draft, an owner-authored post and a broken row. */
function fixtureRows() {
  const generated = { ...deckRevision(), traceId: trace(1), caption: "PRIVATE TEST generated caption." };
  const edited = { ...generated, caption: "PRIVATE TEST owner caption, a little longer." };
  const second = { ...deckRevision(), traceId: trace(2) };
  const third = { ...deckRevision(), traceId: trace(3) };
  const fourth = { ...deckRevision(), traceId: trace(4) };
  const authored = { ...deckRevision(), model: "owner-authored", traceId: null };
  return [
    row(1, generated, { status: "superseded" }), row(2, edited, { replaces: 1, status: "approved", approved: true }),
    row(3, second, { status: "published", approved: true }), row(4, third, { status: "returned" }), row(5, fourth, { status: "skipped" }),
    row(6, { ...deckRevision(), traceId: trace(6) }, { status: "superseded" }), row(7, authored, { status: "approved", approved: true }),
    row(8, deckRevision(), { brand: "devshark", status: "approved", approved: true }), { id: "not-a-uuid", caption: "PRIVATE TEST broken row" },
  ];
}

let directory: string;
let fixture: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "owner-edits-test-"));
  fixture = path.join(directory, "rows.json");
  await writeFile(fixture, JSON.stringify(fixtureRows()));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
beforeEach(() => { vi.resetAllMocks(); });
function io(): OwnerEditIo & { lines: string[] } {
  const lines: string[] = [];
  return { lines, env: {}, readFile: (file) => import("node:fs/promises").then((fs) => fs.readFile(file, "utf8")), writeFile: vi.fn(async () => {}), readRows: vi.fn(async () => []),
    upload: vi.fn(async () => ({ created: 4, updated: 0 })), log: (line) => { lines.push(line); } };
}

describe("scripts/langsmith-owner-edits.ts (#122)", () => {
  it("prints counts in dry mode on a fixture and writes, reads and uploads nothing else", async () => {
    const run = io();
    const result = await runOwnerEdits(parseOwnerEditOptions(["--fixture", fixture, "--dry", "--upload"]), run);
    expect(run.writeFile).not.toHaveBeenCalled(); expect(run.upload).not.toHaveBeenCalled(); expect(run.readRows).not.toHaveBeenCalled();
    expect(result.written).toBeNull();
    const printed = JSON.parse(run.lines[0]!);
    expect(printed).toEqual({ mode: "dry", source: "fixture", records: 4, decisions: { approved: 1, "approved-after-edits": 1, returned: 1, skipped: 1 }, approvedWithoutEditsShare: 0.5, meanScore: 0.375,
      editKinds: { caption: 1 }, models: ["claude-sonnet-5-5"], skipped: { "row-invalid": 1, "not-generated": 1 }, uploadPlanned: 4 });
    expect(run.lines.join("\n")).not.toContain("PRIVATE TEST");
  });
  it("writes the local JSONL with both wordings and binds every example to hashes, kinds and a score", async () => {
    const run = io();
    await runOwnerEdits(parseOwnerEditOptions(["--fixture", fixture, "--output", path.join(directory, "out.jsonl")]), run);
    expect(run.upload).not.toHaveBeenCalled();
    const [file, contents] = (run.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string];
    expect(file).toBe(path.join(directory, "out.jsonl"));
    const records = contents.trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toHaveLength(4);
    const approved = records.find((record) => record.revisionId === id(2))!;
    expect(approved).toMatchObject({ schemaVersion: "dneskai-owner-edit/1", generatedRevisionId: id(1), example: { decision: "approved", score: 0.5, editKinds: { caption: 1 }, editCount: 1, chainLength: 2, traceId: trace(1),
      captionLengthDelta: "PRIVATE TEST owner caption, a little longer.".length - "PRIVATE TEST generated caption.".length, slideTextLengthDelta: 0 } });
    expect(approved.text.generated.caption).toBe("PRIVATE TEST generated caption.");
    expect(approved.text.decided.caption).toBe("PRIVATE TEST owner caption, a little longer.");
    expect(records.map((record) => [record.example.decision, record.example.score])).toEqual([["approved", 0.5], ["approved", 1], ["returned", 0], ["skipped", 0]]);
  });
  it("leaves the wording out with --no-text and uploads only hashes, kinds and scores with --upload", async () => {
    const run = io();
    await runOwnerEdits(parseOwnerEditOptions(["--fixture", fixture, "--no-text", "--upload"]), run);
    const contents = (run.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string;
    expect(contents).not.toContain("PRIVATE TEST");
    const examples = (run.upload as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(examples).toHaveLength(4);
    expect(JSON.stringify(examples)).not.toContain("PRIVATE TEST");
    expect(Object.keys(examples[0]).sort()).toEqual(["captionLengthDelta", "chainLength", "decision", "editCount", "editKinds", "exampleId", "generatedRevisionHash", "model", "promptVersionHash", "revisionHash", "score", "slideTextLengthDelta", "traceId"]);
    (run.upload as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(runOwnerEdits(parseOwnerEditOptions(["--fixture", fixture, "--upload"]), run)).rejects.toThrow("langsmith-upload-failed");
  });
  it("refuses a chain it cannot prove instead of guessing its start", () => {
    const rows = fixtureRows().filter((entry) => entry.id !== id(1));
    expect(buildOwnerEditRecords(rows, { includeText: false }).skipped).toMatchObject({ "chain-broken": 1 });
    const forged = fixtureRows(); Object.assign(forged[1]!, { content_hash: "f".repeat(64), approved_hash: "f".repeat(64) });
    const built = buildOwnerEditRecords(forged, { includeText: false });
    expect(built.skipped).toMatchObject({ "hash-mismatch": 1 });
    expect(built.records.map((record) => record.revisionId)).not.toContain(id(2));
  });
  it("parses its options and defaults to a dated file under work/langsmith", () => {
    expect(parseOwnerEditOptions([], new Date("2026-10-21T10:00:00Z"))).toEqual({ fixture: null, output: path.join("work", "langsmith", "dneskai-owner-edits-2026-10-21.jsonl"), dry: false, includeText: true, upload: false });
    expect(() => parseOwnerEditOptions(["--force"])).toThrow("usage: unknown argument --force");
    expect(() => parseOwnerEditOptions(["--output"])).toThrow("usage: --output needs a value");
  });
  it("creates the dataset once and writes examples with no text through the EU tracer", async () => {
    sdk.hasDataset.mockResolvedValue(false);
    sdk.createDataset.mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999" });
    sdk.listExamples.mockImplementation(async function* () { yield { id: "not-ours" }; });
    sdk.createExamples.mockResolvedValue([]);
    sdk.configs.length = 0;
    const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
    expect(sdk.configs.map((config) => config.timeout_ms)).toEqual([1000]);
    const { records } = buildOwnerEditRecords(fixtureRows(), { includeText: true });
    expect(await tracer.upsertOwnerEditExamples(OWNER_EDITS_DATASET, records.map((record) => record.example))).toEqual({ created: 4, updated: 0 });
    // The upload gets its own EU client with a longer request timeout and still no retries.
    expect(sdk.configs).toHaveLength(2);
    expect(sdk.configs[1]).toMatchObject({ apiUrl: "https://eu.api.smith.langchain.com", hideInputs: true, hideOutputs: true, timeout_ms: 15000, callerOptions: { maxRetries: 0 } });
    expect(sdk.createDataset).toHaveBeenCalledWith(OWNER_EDITS_DATASET, expect.objectContaining({ metadata: { dataset_kind: "dneskai-owner-edits/1" } }));
    const sent = sdk.createExamples.mock.calls[0]![0];
    expect(sent[0]).toMatchObject({ dataset_id: "99999999-9999-4999-8999-999999999999", inputs: { model: "claude-sonnet-5-5" }, outputs: { decision: "approved", score: 0.5, edit_kinds: { caption: 1 } } });
    expect(JSON.stringify(sent)).not.toContain("PRIVATE TEST");
    // A second upload updates the same ids.
    sdk.hasDataset.mockResolvedValue(true); sdk.readDataset.mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999" });
    sdk.listExamples.mockImplementation(async function* () { for (const example of sent) yield { id: example.id }; });
    sdk.updateExamples.mockResolvedValue({});
    expect(await tracer.upsertOwnerEditExamples(OWNER_EDITS_DATASET, records.map((record) => record.example))).toEqual({ created: 0, updated: 4 });
    await expect(tracer.upsertOwnerEditExamples(OWNER_EDITS_DATASET, [{ ...records[0]!.example, caption: "PRIVATE TEST" } as never])).rejects.toThrow();
    sdk.hasDataset.mockRejectedValue(new Error("TEST outage"));
    expect(await tracer.upsertOwnerEditExamples(OWNER_EDITS_DATASET, records.map((record) => record.example))).toBeNull();
    expect(sdk.configs).toHaveLength(2);
  });
});

it("exports and uploads insertion counts without raw copy or an as-generated score", async () => {
  const generated = { ...deckRevision(), traceId: trace(9) };
  const inserted = { ...generated, deck: applyDneskaiDeckEdit(generated.deck!, { slides: [{ from: 0 }, { from: 1 }, { insert: { type: "statement", variant: "accent", headline: "PRIVATE TEST new slide", alt: "PRIVATE TEST new alt", images: [] } }, { from: 2 }] }, { media: [], primaryCandidateId: null }) };
  const built = buildOwnerEditRecords([row(9, generated, { status: "superseded" }), row(0, inserted, { replaces: 9, status: "approved", approved: true })], { includeText: false });
  expect(built.records).toHaveLength(1); const example = built.records[0]!.example;
  expect(example).toMatchObject({ score: 0.5, editKinds: { "insert-slide": 1 }, editCount: 1 }); expect(JSON.stringify(example)).not.toContain("PRIVATE TEST");
  sdk.hasDataset.mockResolvedValue(true); sdk.readDataset.mockResolvedValue({ id: "99999999-9999-4999-8999-999999999999" }); sdk.listExamples.mockImplementation(async function* () {}); sdk.createExamples.mockResolvedValue([]);
  const tracer = await createMarketingTracer({ apiKey: "test-only", projectName: "test-only" });
  expect(await tracer.upsertOwnerEditExamples(OWNER_EDITS_DATASET, [example])).toEqual({ created: 1, updated: 0 });
  const sent = sdk.createExamples.mock.calls[0]![0]; expect(sent[0].outputs).toMatchObject({ score: 0.5, edit_kinds: { "insert-slide": 1 } }); expect(JSON.stringify(sent)).not.toContain("PRIVATE TEST");
});
