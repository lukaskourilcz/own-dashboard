/**
 * The DNESKAi owner-edits evaluation set (#122): every approved, returned or skipped DNESKAi revision, with the edit
 * kinds of its `replaces_id` chain back to the generated revision and the owner-review score.
 *
 * It reads `marketing_revisions` with the service role and only selects; it never writes to Supabase. It writes a
 * LOCAL JSONL file, by default under the git-ignored `work/langsmith/`, which keeps the generated and the decided
 * caption and slide text for evaluation on this machine (`--no-text` leaves them out). Nothing leaves the machine
 * without `--upload`, and the upload carries only hashes, edit-kind counts, character deltas and scores.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… DASHBOARD_OWNER_ID=<auth user uuid> \
 *     node node_modules/.cache/langsmith-owner-edits.cjs [--dry] [--no-text] [--output FILE] [--upload]
 *   node node_modules/.cache/langsmith-owner-edits.cjs --fixture rows.json --dry
 *
 * `--upload` also needs LANGSMITH_API_KEY and LANGSMITH_ENDPOINT=https://eu.api.smith.langchain.com. See
 * docs/marketing-generation.md. Never commit the keys or the output file.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseContentRevision, type ContentRevision } from "../src/lib/marketing/contracts";
import { contentHash, revisionContentHash } from "../src/lib/marketing/hashes";
import { addOwnerEditCounts, ownerEditChainKinds, ownerEditCount, ownerEditLengthDeltas, ownerFeedbackScore, type OwnerEditCounts } from "../src/lib/marketing/owner-edits";
import { LANGSMITH_EU_ENDPOINT, OwnerEditExampleSchema, createMarketingTracer, derivedUuid, type OwnerEditExample } from "../src/lib/marketing/tracing";

export const OWNER_EDITS_DATASET = "dneskai-owner-edits";
export const OWNER_EDIT_RECORD_VERSION = "dneskai-owner-edit/1";
const CHAIN_LIMIT = 20;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const RowSchema = z.object({
  id: z.uuid(), replaces_id: z.uuid().nullable(), brand: z.string(), status: z.string(), content_hash: hash, approved_hash: hash.nullable(), revision: z.unknown(), created_at: z.string(),
});
type Row = z.infer<typeof RowSchema>;
export const OWNER_EDIT_COLUMNS = "id,replaces_id,brand,status,content_hash,approved_hash,revision,created_at";

type TextView = { title: string; caption: string; slides: Array<Record<string, string>> };
export type OwnerEditRecord = {
  schemaVersion: typeof OWNER_EDIT_RECORD_VERSION;
  revisionId: string; generatedRevisionId: string; decidedAt: string;
  /** Exactly what `--upload` sends for this record. */
  example: OwnerEditExample;
  /** Local only: the generated and the decided wording, for reading the edits side by side. */
  text?: { generated: TextView; decided: TextView };
};
export type OwnerEditSkip = "row-invalid" | "revision-invalid" | "hash-mismatch" | "chain-broken" | "chain-too-long" | "not-generated";

function textView(revision: ContentRevision): TextView {
  return { title: revision.title, caption: revision.caption, slides: (revision.deck?.slides ?? []).map((slide) => Object.fromEntries(
    (["type", "headline", "body", "kicker", "credit", "alt"] as const).flatMap((field) => slide[field] ? [[field, slide[field]!]] : []))) };
}
function decisionOf(row: Row): "approved" | "returned" | "skipped" | null {
  if (row.approved_hash !== null && row.approved_hash === row.content_hash) return "approved";
  return row.status === "returned" || row.status === "skipped" ? row.status : null;
}

/** Every decided DNESKAi revision with its chain. Rows that cannot prove their chain are counted, never guessed. */
export function buildOwnerEditRecords(rows: readonly unknown[], options: { includeText: boolean }): { records: OwnerEditRecord[]; skipped: Partial<Record<OwnerEditSkip, number>> } {
  const skipped: Partial<Record<OwnerEditSkip, number>> = {};
  const skip = (reason: OwnerEditSkip) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const byId = new Map<string, Row>();
  for (const value of rows) {
    const row = RowSchema.safeParse(value);
    if (row.success && row.data.brand === "dneskai") byId.set(row.data.id, row.data); else if (!row.success) skip("row-invalid");
  }
  const parsed = new Map<string, ContentRevision | null>();
  const revisionOf = (row: Row): ContentRevision | null => {
    if (!parsed.has(row.id)) {
      try { parsed.set(row.id, parseContentRevision(row.revision)); } catch { parsed.set(row.id, null); }
    }
    return parsed.get(row.id)!;
  };
  const records: OwnerEditRecord[] = [];
  const decided = [...byId.values()].flatMap((row) => { const decision = decisionOf(row); return decision ? [{ row, decision }] : []; })
    .sort((left, right) => left.row.created_at.localeCompare(right.row.created_at));
  for (const { row, decision } of decided) {
    const chain: Array<{ row: Row; revision: ContentRevision }> = [];
    let current: Row | undefined = row;
    let failure: OwnerEditSkip | null = null;
    while (current) {
      if (chain.length >= CHAIN_LIMIT || chain.some((entry) => entry.row.id === current!.id)) { failure = "chain-too-long"; break; }
      const revision = revisionOf(current);
      if (!revision) { failure = "revision-invalid"; break; }
      if (chain.length && revision.traceId !== chain[0]!.revision.traceId) break;
      if (revisionContentHash(revision) !== current.content_hash) { failure = "hash-mismatch"; break; }
      chain.unshift({ row: current, revision });
      if (current.replaces_id === null) break;
      current = byId.get(current.replaces_id);
      if (!current) { failure = "chain-broken"; break; }
    }
    if (failure) { skip(failure); continue; }
    const generated = chain[0]!; const last = chain.at(-1)!;
    const edits: OwnerEditCounts = ownerEditChainKinds(chain.map((entry) => entry.revision));
    const example = OwnerEditExampleSchema.safeParse({
      exampleId: derivedUuid("owner-edit-example", decision, last.row.id, last.row.content_hash), traceId: last.revision.traceId,
      revisionHash: last.row.content_hash, generatedRevisionHash: generated.row.content_hash, model: generated.revision.model, promptVersionHash: contentHash(generated.revision.promptVersion),
      decision, score: ownerFeedbackScore(decision, edits), editKinds: edits, editCount: ownerEditCount(edits), chainLength: chain.length,
      ...ownerEditLengthDeltas(generated.revision, last.revision),
    });
    // Owner-authored and offline-imported revisions name no Claude model: there is no generation to evaluate.
    if (!example.success) { skip("not-generated"); continue; }
    records.push({ schemaVersion: OWNER_EDIT_RECORD_VERSION, revisionId: last.row.id, generatedRevisionId: generated.row.id, decidedAt: last.row.created_at, example: example.data,
      ...(options.includeText ? { text: { generated: textView(generated.revision), decided: textView(last.revision) } } : {}) });
  }
  return { records, skipped };
}

/** Counts only: what the terminal prints. */
export function summarizeOwnerEdits(records: readonly OwnerEditRecord[]) {
  const decisions = { approved: 0, "approved-after-edits": 0, returned: 0, skipped: 0 };
  for (const { example } of records) {
    if (example.decision === "approved") decisions[example.editCount ? "approved-after-edits" : "approved"] += 1; else decisions[example.decision] += 1;
  }
  const approvals = decisions.approved + decisions["approved-after-edits"];
  return {
    records: records.length, decisions,
    approvedWithoutEditsShare: approvals ? Number((decisions.approved / approvals).toFixed(3)) : null,
    meanScore: records.length ? Number((records.reduce((sum, { example }) => sum + example.score, 0) / records.length).toFixed(3)) : null,
    editKinds: addOwnerEditCounts(...records.map(({ example }) => example.editKinds)),
    models: [...new Set(records.map(({ example }) => example.model))].sort(),
  };
}

export type OwnerEditOptions = { fixture: string | null; output: string; dry: boolean; includeText: boolean; upload: boolean };
export function parseOwnerEditOptions(argv: readonly string[], now = new Date()): OwnerEditOptions {
  const options: OwnerEditOptions = { fixture: null, output: path.join("work", "langsmith", `dneskai-owner-edits-${now.toISOString().slice(0, 10)}.jsonl`), dry: false, includeText: true, upload: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    const value = () => { const next = argv[index + 1]; if (!next || next.startsWith("--")) throw new Error(`usage: ${argument} needs a value`); index += 1; return next; };
    if (argument === "--fixture") options.fixture = value();
    else if (argument === "--output") options.output = value();
    else if (argument === "--dry") options.dry = true;
    else if (argument === "--no-text") options.includeText = false;
    else if (argument === "--upload") options.upload = true;
    else throw new Error(`usage: unknown argument ${argument}`);
  }
  return options;
}

export type OwnerEditIo = {
  env: Record<string, string | undefined>;
  readFile(file: string): Promise<string>;
  writeFile(file: string, contents: string): Promise<void>;
  /** Supabase `marketing_revisions` rows of one owner, read with the service role. */
  readRows(env: Record<string, string | undefined>): Promise<unknown[]>;
  upload(env: Record<string, string | undefined>, examples: OwnerEditExample[]): Promise<{ created: number; updated: number } | null>;
  log(line: string): void;
};

export async function runOwnerEdits(options: OwnerEditOptions, io: OwnerEditIo): Promise<{ written: string | null; uploaded: { created: number; updated: number } | null; summary: ReturnType<typeof summarizeOwnerEdits> }> {
  const rows = options.fixture ? z.array(z.unknown()).max(20000).parse(JSON.parse(await io.readFile(options.fixture))) : await io.readRows(io.env);
  const { records, skipped } = buildOwnerEditRecords(rows, { includeText: options.includeText && !options.dry });
  const summary = summarizeOwnerEdits(records);
  io.log(JSON.stringify({ mode: options.dry ? "dry" : "write", source: options.fixture ? "fixture" : "supabase", ...summary, skipped, uploadPlanned: options.upload ? records.length : 0 }));
  if (options.dry) return { written: null, uploaded: null, summary };
  await io.writeFile(options.output, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""));
  let uploaded: { created: number; updated: number } | null = null;
  if (options.upload) {
    uploaded = await io.upload(io.env, records.map((record) => record.example));
    if (!uploaded) throw new Error("langsmith-upload-failed");
  }
  return { written: options.output, uploaded, summary };
}

const nodeIo = (): OwnerEditIo => ({
  env: process.env,
  readFile: (file) => readFile(file, "utf8"),
  async writeFile(file, contents) {
    await mkdir(path.dirname(path.resolve(file)), { recursive: true });
    // Never overwrites: an earlier export stays as it was read.
    try { await writeFile(file, contents, { mode: 0o600, flag: "wx" }); }
    catch (failure) { throw new Error((failure as { code?: unknown }).code === "EEXIST" ? "output-exists" : "output-unwritable"); }
  },
  async readRows(env) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY, owner = env.DASHBOARD_OWNER_ID;
    if (!url || !key || !z.uuid().safeParse(owner).success) throw new Error("supabase-configuration-required");
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const rows: unknown[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await db.from("marketing_revisions").select(OWNER_EDIT_COLUMNS).eq("user_id", owner!).eq("brand", "dneskai").order("created_at", { ascending: true }).range(from, from + 999);
      if (error) throw new Error("revisions-unavailable");
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  },
  async upload(env, examples) {
    if (!env.LANGSMITH_API_KEY || env.LANGSMITH_ENDPOINT !== LANGSMITH_EU_ENDPOINT) throw new Error("langsmith-eu-configuration-required");
    const tracer = await createMarketingTracer({ apiKey: env.LANGSMITH_API_KEY, projectName: env.LANGSMITH_PROJECT || OWNER_EDITS_DATASET, endpoint: env.LANGSMITH_ENDPOINT });
    return tracer.upsertOwnerEditExamples(OWNER_EDITS_DATASET, examples);
  },
  log: (line) => { process.stdout.write(`${line}\n`); },
});

if (typeof require !== "undefined" && require.main === module) {
  (async () => {
    const result = await runOwnerEdits(parseOwnerEditOptions(process.argv.slice(2)), nodeIo());
    if (result.written) process.stdout.write(`${JSON.stringify({ written: result.written, uploaded: result.uploaded })}\n`);
  })().catch((failure: unknown) => {
    // Codes and usage only: never a row, a caption or a key.
    const message = failure instanceof Error && /^(?:usage: [ -~]{1,120}|[a-z-]{1,60})$/.test(failure.message) ? failure.message : "owner-edits-failed";
    process.stderr.write(`${message}\n`); process.exitCode = 1;
  });
}
