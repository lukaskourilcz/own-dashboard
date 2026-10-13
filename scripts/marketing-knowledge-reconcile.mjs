/** Read-only local evidence benchmark. No provider/DB calls; no raw text in output. */
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const [inputPath, outputPath, cutoff = "2026-10-13T00:00:00Z"] = process.argv.slice(2);
if (!inputPath || !outputPath) throw new Error("Usage: node scripts/marketing-knowledge-reconcile.mjs INPUT_JSON OUTPUT_JSON [EXCLUSIVE_UTC_CUTOFF]");
const temporary = await mkdtemp(path.join(tmpdir(), "marketing-knowledge-"));
try {
  const raw = await readFile(inputPath, "utf8");
  if (Buffer.byteLength(raw) > 1_000_000) throw new Error("unbounded evidence");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.items) || data.items.length > 500) throw new Error("invalid evidence");
  const modulePath = path.join(temporary, "knowledge.mjs");
  await build({ stdin: { contents: 'export * from "./src/lib/marketing/knowledge"; export * from "./src/lib/marketing/knowledge-extraction";', resolveDir: process.cwd(), sourcefile: "reconcile-entry.ts" },
    bundle: true, platform: "node", format: "esm", outfile: modulePath, logLevel: "silent", tsconfig: path.resolve("tsconfig.json") });
  const domain = await import(pathToFileURL(modulePath).href);
  const provider = data.provenance?.provider ?? "owner-supplied-existing-dataset";
  const rows = data.items.map((row) => ({ url: row.url, published_at: row.timestamp ?? null, caption: row.caption ?? null,
    transcript: row.transcript?.trim() ? { status: "available", provider, costUsd: null, segments: [{ text: row.transcript.trim(), startSeconds: null, endSeconds: null }], reason: null }
      : { ...domain.unavailableMedia(), status: "unavailable", provider, reason: row.error ? "restricted-source" : "transcript-not-returned" },
    ocr: { ...domain.unavailableMedia(), reason: "actor-does-not-provide-ocr" } }));
  const strict = domain.planKnowledgeCapture({ cutoff, input: rows });
  const partial = domain.planKnowledgeCapture({ cutoff, input: rows, includeUnknownDates: true });
  // Small manually selected benchmark; it measures validation, not live Claude quality.
  const quotes = ["profile name contains your full name with a keyword", "your story, client wins, testimonials, and your offer"];
  const multiSource = partial.sources.find((source) => quotes.every((quote) => source.content.transcript.segments.some((segment) => segment.text.includes(quote))));
  let manualBenchmark = { available: false, supportedProcedures: 0, liveModelCalled: false };
  if (multiSource) {
    const descriptions = [
      { title: "Profile name keyword", summary: "Include a relevant audience search keyword in the profile name.", steps: ["Add your full name and a keyword your intended client would search."] },
      { title: "Profile highlight topics", summary: "Organize profile highlights around your story and offer.", steps: ["Include your story, client wins, testimonials and your offer in highlights."] },
    ];
    const procedures = descriptions.map((p, index) => ({ ...p, category: "marketing", tipGroup: "growth", tags: domain.emptyTags(),
      evidence: [{ shortcode: multiSource.shortcode, channel: "transcript", quote: quotes[index], startSeconds: null, endSeconds: null }],
      missingParts: ["Source's percentage rankings are unverified", "Transcript segment timecodes unavailable"], contraryClaims: [] }));
    const extracted = await domain.extractKnowledge(multiSource, { consent: true, model: { model: "claude-local-benchmark", pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 1 },
      invoke: async () => ({ extraction: { procedures, missingParts: [] }, usage: { inputTokens: 0, outputTokens: 0 } }) } });
    if (extracted.items.length !== 2 || extracted.items.some((item) => domain.validateProcedureEvidence(item, [multiSource]).length)) throw new Error("benchmark failed");
    manualBenchmark = { available: true, supportedProcedures: extracted.items.length, liveModelCalled: false };
  }
  const report = { version: domain.KNOWLEDGE_VERSION, cutoff: partial.cutoff, startsAt: partial.startsAt,
    existingDatasetOnly: true, liveSavedCompletenessProved: false, recentSavedBackfillProved: false,
    provider, existingRunActualCostUsd: data.provenance?.actualCostUsd ?? null, costAllocation: "Shared existing run; no per-source cost inferred",
    strictSavedWindow: strict.counts, optedInUnknownDates: partial.counts,
    transcriptAvailable: partial.sources.filter((s) => s.content.transcript.status === "available").length,
    ocrAvailable: partial.sources.filter((s) => s.content.ocr.status === "available").length,
    restrictedRows: data.items.filter((row) => row.error).length,
    transcriptAvailableDoesNotProveActionableProcedure: true, manualBenchmark,
    sourceContentHashes: partial.sources.map((source) => domain.knowledgeAnalysisKey(source, "claude-local-benchmark")) };
  await writeFile(outputPath, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ selected: partial.counts.unique, unknownSavedDates: partial.counts.unknownDates, transcriptAvailable: report.transcriptAvailable, manualBenchmark, outputPath }));
} catch { process.exitCode = 1; console.error("knowledge-reconciliation-failed (raw source text withheld)"); }
finally { await rm(temporary, { recursive: true, force: true }); }
