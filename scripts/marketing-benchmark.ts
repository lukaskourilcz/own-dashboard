import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { evaluateMarketingBenchmark } from "../src/lib/marketing/generation-benchmark";
import { authoredMarketingText, type MarketingCopy, type MarketingSlide } from "../src/lib/marketing/generation";
import { parseSourcePacket, type SourcePacket, type ContentRevision } from "../src/lib/marketing/contracts";
import { contentHash } from "../src/lib/marketing/hashes";
import { fitMarketingText, pendingMarketingTemplate, renderMarketingPreview, validateMarketingTemplate } from "../src/lib/marketing/render";
import article from "../templates/marketing/benchmarks/dneskai-article.json";
import question from "../templates/marketing/benchmarks/devshark-question.json";
import task from "../templates/marketing/benchmarks/devshark-coding-task.json";

export const MARKETING_BENCHMARK_CLOCK = new Date("2026-10-13T12:00:00Z");
const fixtures = { article, question, task };
type Fixture = keyof typeof fixtures;
type Probe = (source: SourcePacket) => void;
export type OfflineMarketingCase = {
  id: string; fixture: Fixture; source: unknown; copy: unknown; expectedIssues: string[];
  offlineSimulation: boolean; provenanceCheck?: "answer"; probe?: Probe;
};
function clone<T>(value: T): T { return structuredClone(value); }
function baseCopy(source: SourcePacket): MarketingCopy {
  const text = source.kind === "article" ? source.content.body.split(/(?<=[.!?])\s+/)[0] : "Read the authored exercise and explanation.";
  return { title: source.content.title, caption: text, locale: source.locale, slides: [
    { headline: source.content.title, body: text, code: null, evidenceIndexes: source.kind === "article" ? [0] : [] },
    { headline: source.locale === "cs" ? "Souvislosti článku" : "Authored explanation", body: text, code: null, evidenceIndexes: source.kind === "article" ? [0] : [] },
  ] };
}
function baselineIssues(): string[] {
  return ["source-unavailable"];
}
/** Counterfactual mutations stay in memory. The retained producer fixtures remain eligible=false. */
export function createMarketingBenchmarkCases(): OfflineMarketingCase[] {
  assert.equal(Object.values(fixtures).every((source) => source.eligible === false), true, "Retained producer fixtures must remain held");
  const cases: OfflineMarketingCase[] = [];
  function add(fixture: Fixture, name: string, mutate?: (source: SourcePacket, copy: MarketingCopy) => void, extra: string[] = [], options: { invalidSource?: boolean; simulation?: boolean; provenanceCheck?: "answer"; probe?: Probe } = {}) {
    const source = parseSourcePacket(clone(fixtures[fixture]));
    const copy = baseCopy(source);
    mutate?.(source, copy);
    cases.push({ id: `${fixture}/${name}`, fixture, source, copy, expectedIssues: options.invalidSource ? ["invalid-source"] : [...baselineIssues(), ...extra], offlineSimulation: options.simulation ?? (!!mutate || !!options.probe), provenanceCheck: options.provenanceCheck, probe: options.probe });
  }
  for (const fixture of ["article", "question", "task"] as const) add(fixture, "held-baseline");
  for (const fixture of ["article", "question"] as const) {
    add(fixture, "content-hash-mismatch", (source) => { source.contentHash = "0".repeat(64); }, ["source-hash-mismatch"]);
    add(fixture, "unsupported-source-version", (source) => { Object.assign(source, { schemaVersion: "marketing-source/99" }); }, [], { invalidSource: true });
    add(fixture, "private-source-field", (source) => { Object.assign(source, { privateOwnerNote: "synthetic privacy probe only" }); }, [], { invalidSource: true });
    add(fixture, "source-locale-crossed", (source) => { source.locale = source.locale === "cs" ? "en" : "cs"; }, [], { invalidSource: true });
    add(fixture, "source-brand-kind-crossed", (source) => { source.brand = source.brand === "dneskai" ? "devshark" : "dneskai"; }, [], { invalidSource: true });
    add(fixture, "expired-eligibility-simulation", (source) => { source.eligible = true; source.expiresAt = "2026-10-13T11:59:59Z"; source.eligibilityReason = "OFFLINE SIMULATION: eligible then expired"; });
    add(fixture, "withdrawal-simulation", (source) => { source.eligible = false; source.sourceRevision += ":offline-withdrawal"; source.eligibilityReason = "OFFLINE SIMULATION: withdrawn"; });
    add(fixture, "copy-schema-extra-field", (_source, copy) => { Object.assign(copy, { privateDebug: "synthetic schema probe only" }); }, ["invalid-schema"]);
    add(fixture, "copy-locale-crossed", (_source, copy) => { copy.locale = copy.locale === "cs" ? "en" : "cs"; }, ["locale-mismatch"]);
    add(fixture, "caption-over-1800", (_source, copy) => { copy.caption = "x".repeat(1801); }, ["invalid-schema"]);
    add(fixture, "headline-over-160", (_source, copy) => { copy.slides[0].headline = "x".repeat(161); }, ["invalid-schema"]);
    add(fixture, "body-over-1200", (_source, copy) => { copy.slides[0].body = "x".repeat(1201); }, ["invalid-schema"]);
  }
  add("article", "malformed-copy-json", undefined, ["invalid-schema"], { simulation: true });
  cases[cases.length - 1].copy = '{"title":';
  add("article", "missing-citations", (_source, copy) => { copy.slides.forEach((slide) => { slide.evidenceIndexes = []; }); }, ["missing-evidence"]);
  add("article", "unknown-citation", (source, copy) => { copy.slides[0].evidenceIndexes = [source.content.evidence.length]; }, ["unknown-evidence"]);
  add("article", "invented-number", (_source, copy) => { copy.caption = "999999991%"; }, ["unsupported-number"]);
  add("question", "model-code-injection", (source, copy) => { copy.slides[0].code = source.content.code; }, ["model-code-forbidden"]);
  add("question", "invented-number", (_source, copy) => { copy.caption = "999999991%"; }, ["unsupported-number"]);
  add("question", "wrong-answer-with-valid-shape-and-hash", (source) => {
    source.content.answer = source.content.options.find((option) => option !== source.content.answer)!;
    source.contentHash = contentHash(source.content);
  }, ["authored-answer-changed"], { provenanceCheck: "answer" });
  add("task", "hidden-tests-source-field", (source) => { Object.assign(source.content, { hiddenTests: ["SYNTHETIC PRIVACY PROBE"] }); }, [], { invalidSource: true });
  add("task", "source-code-over-12000", (source) => { source.content.code = "x".repeat(12001); source.contentHash = contentHash(source.content); }, [], { invalidSource: true });
  add("task", "model-solution-code-injection", (source, copy) => { copy.slides[0].code = source.content.code; }, ["model-code-forbidden"]);
  add("article", "czech-diacritics-roundtrip", undefined, [], { probe: () => {
    const value = "Příliš žluťoučký kůň úpěl ďábelské ódy.";
    assert.equal(fitMarketingText({ value, faceId: "source-serif-4-400", fontSize: 44, width: 904, maxLines: 4 }).join(" "), value);
  } });
  add("question", "decomposed-code-identifier", undefined, ["unsupported-glyph"], { probe: () => { fitMarketingText({ value: "const a\u0301 = 1;", faceId: "jetbrains-mono-400", fontSize: 28, width: 848, maxLines: 10, code: true }); } });
  add("question", "code-line-overflow", undefined, ["code-line-overflow"], { probe: () => { fitMarketingText({ value: "W".repeat(100), faceId: "jetbrains-mono-400", fontSize: 28, width: 848, maxLines: 10, code: true }); } });
  add("question", "code-height-overflow", undefined, ["text-overflow"], { probe: () => { fitMarketingText({ value: Array(16).fill("const x = 1;").join("\n"), faceId: "jetbrains-mono-400", fontSize: 28, width: 848, maxLines: 15, code: true }); } });
  add("article", "unbreakable-word-overflow", undefined, ["word-overflow"], { probe: () => { fitMarketingText({ value: "W".repeat(100), faceId: "space-grotesk-700", fontSize: 70, width: 904, maxLines: 3 }); } });
  add("article", "prose-height-overflow", undefined, ["text-overflow"], { probe: () => { fitMarketingText({ value: Array(13).fill("Krátký řádek.").join("\n"), faceId: "source-serif-4-400", fontSize: 44, width: 904, maxLines: 12 }); } });
  add("question", "unsupported-emoji-glyph", undefined, ["unsupported-glyph"], { probe: () => { fitMarketingText({ value: "🦈", faceId: "manrope-800", fontSize: 72, width: 920, maxLines: 3 }); } });
  add("article", "changed-template-digest", undefined, ["template-hash-mismatch"], { probe: () => { validateMarketingTemplate({ ...pendingMarketingTemplate("dneskai"), templateSha256: "0".repeat(64) }, false); } });
  assert.equal(cases.length, 45);
  return cases;
}
export function evaluateOfflineMarketingCases(cases = createMarketingBenchmarkCases()) {
  return cases.map((example) => {
    const started = performance.now(); const issues: string[] = [];
    let source: SourcePacket | null = null;
    try {
      source = parseSourcePacket(example.source);
      issues.push(...evaluateMarketingBenchmark([{ id: example.id, source, copy: example.copy, expectedIssueCodes: [] }], MARKETING_BENCHMARK_CLOCK)[0].issueCodes);
    } catch { issues.push("invalid-source"); }
    if (source && example.provenanceCheck === "answer" && source.content.answer !== fixtures[example.fixture].content.answer) issues.push("authored-answer-changed");
    if (source && example.probe) {
      try { example.probe(source); }
      catch (error) { issues.push(error instanceof Error && /^[a-z-]{1,80}$/.test(error.message) ? error.message : "local-probe-failed"); }
    }
    const actual = [...new Set(issues)].sort(); const expected = [...new Set(example.expectedIssues)].sort();
    return { id: example.id, fixture: example.fixture, originalEligible: false, offlineSimulation: example.offlineSimulation, sourceContentHash: fixtures[example.fixture].contentHash, issueCodes: actual, expectedIssueCodes: expected, passed: JSON.stringify(actual) === JSON.stringify(expected), latencyMs: performance.now() - started };
  });
}
function reviewDraft(fixture: "article" | "question"): { revision: ContentRevision; slides: MarketingSlide[] } {
  const source = parseSourcePacket(fixtures[fixture]);
  const template = pendingMarketingTemplate(source.brand);
  const slides: MarketingSlide[] = fixture === "article" ? [
    { headline: source.content.title, body: source.content.body.split("\n\n")[0], code: null, evidenceIndexes: [0] },
    { headline: "Souvislosti článku", body: source.content.body.split("\n\n")[1].split(/(?<=[.!?])\s+/)[0], code: null, evidenceIndexes: [0] },
  ] : [
    { headline: source.content.title, body: authoredMarketingText(source.content.body, source.content.code), code: null, evidenceIndexes: [] },
    { headline: "Code", body: source.content.category, code: source.content.code, evidenceIndexes: [] },
    { headline: "Choose an answer", body: source.content.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join("\n"), code: null, evidenceIndexes: [] },
    { headline: "Authored explanation", body: authoredMarketingText([source.content.answer, source.content.explanation].filter(Boolean).join("\n\n"), source.content.code), code: null, evidenceIndexes: [] },
  ];
  return { revision: { schemaVersion: "marketing-content/1", brand: source.brand, title: source.content.title, caption: "OFFLINE HELD SOURCE: layout QA only", format: "carousel", sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }], knowledgeIds: [], assets: [], account: { id: "offline-qa-no-publishing-account", platform: "instagram", handle: "offline-qa" }, scheduledAt: "2026-10-14T12:00:00Z", timeZone: "Europe/Prague", templateVersion: template.version, promptVersion: "offline-layout-qa/1", model: "offline-local-render-no-provider", traceId: null }, slides };
}
export async function runOfflineMarketingBenchmark() {
  const cases = evaluateOfflineMarketingCases();
  const rendering = [];
  for (const fixture of ["article", "question"] as const) {
    const draft = reviewDraft(fixture);
    const input = { draft, template: pendingMarketingTemplate(draft.revision.brand), revisionId: "a1c477b5-8e8e-428b-97bd-93b457a746c3" };
    const start = performance.now(); const first = await renderMarketingPreview(input); const firstMs = performance.now() - start;
    const repeatStart = performance.now(); const repeat = await renderMarketingPreview(input); const repeatMs = performance.now() - repeatStart;
    rendering.push({ brand: draft.revision.brand, originalEligible: false, slides: first.length, firstRenderMs: firstMs, repeatRenderMs: repeatMs, reproducible: JSON.stringify(first.map((slide) => slide.sha256)) === JSON.stringify(repeat.map((slide) => slide.sha256)), assets: first.map((slide) => ({ sha256: slide.sha256, bytes: slide.jpeg.length, width: slide.width, height: slide.height })) });
  }
  return { schemaVersion: "marketing-offline-benchmark/1", clock: MARKETING_BENCHMARK_CLOCK.toISOString(), providerCalls: 0, providerCostUsd: null, providerCostStatus: "not-measured-no-provider-calls", caseCount: cases.length, passed: cases.filter((item) => item.passed).length, failed: cases.filter((item) => !item.passed).length, cases, rendering };
}
if (typeof require !== "undefined" && require.main === module) {
  runOfflineMarketingBenchmark().then(async (report) => {
    const outputArg = process.argv.find((argument) => argument.startsWith("--output="));
    const output = outputArg?.slice("--output=".length);
    if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
    process.stdout.write(JSON.stringify({ caseCount: report.caseCount, passed: report.passed, failed: report.failed, providerCalls: report.providerCalls, rendering: report.rendering }) + "\n");
    if (report.failed || report.rendering.some((item) => !item.reproducible)) process.exitCode = 1;
  }).catch(() => { process.stderr.write("offline-marketing-benchmark-failed\n"); process.exitCode = 1; });
}
