/**
 * Offline A/B of two Claude models on saved DNESKAi briefs (#122). Nothing is published, stored or traced.
 *
 * Default: a dry plan. For every brief it builds the exact prompt the worker would send (`marketing-copy/5`), and
 * prints the expected and the worst-case cost of both models from token estimates, against the 1.00 USD daily
 * ceiling. No model is called.
 *
 * `--live` with MARKETING_AI_CONSENT=true and ANTHROPIC_API_KEY runs the real generation (`generateMarketingDraft`,
 * the studio's fit gate included) for model A and model B on the same briefs, with the source pictures from
 * `--media-dir` (files named by their sha256). Every call is admitted only while the run's reserved maximum stays
 * within `--ceiling-usd` (at most 1.00). The local result file keeps both drafts for reading side by side.
 *
 *   node work/dneskai-model-ab.cjs --briefs briefs.json [--model-a claude-sonnet-5-5] [--model-b claude-haiku-5-5]
 *     [--price-a 2:10] [--price-b 0.1:0.5] [--limit 20] [--ceiling-usd 1.00] [--live --media-dir DIR] [--output FILE]
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MARKETING_SOURCE_VERSION, parseSourcePacket, type SourcePacket } from "../src/lib/marketing/contracts";
import { contentHash } from "../src/lib/marketing/hashes";
import { DneskaiBriefSchema, type DneskaiBrief } from "../src/lib/marketing/dneskai-brief";
import {
  DNESKAI_BRIEF_SYSTEM_PROMPT, DNESKAI_DECK_TEMPLATE_VERSION, DNESKAI_RETRY_INSTRUCTION_BYTES, dneskaiBriefOffer, dneskaiBriefPrompt, dneskaiCopyWireSchema,
} from "../src/lib/marketing/dneskai-generation";
import { dneskaiEvidencePublishers } from "../src/lib/marketing/dneskai-publishers";
import { DEFAULT_GENERATION_BUDGET, MarketingGenerationError, createClaudeMarketingModel, generateMarketingDraft, type GenerationBudget, type MarketingModel } from "../src/lib/marketing/generation";
import type { LoadDneskaiMediaBytes } from "../src/lib/marketing/dneskai-ports";
import { derivedUuid, dneskaiDeckTraceShape, traceIdentifierHash, type MarketingTracer } from "../src/lib/marketing/tracing";

/** Claude API list prices per million tokens (input, output), as published on 6 October 2026. Check before a live run. */
export const KNOWN_PRICING: Record<string, { inputPerMillionUsd: number; outputPerMillionUsd: number }> = {
  "claude-sonnet-5-5": { inputPerMillionUsd: 2, outputPerMillionUsd: 10 },
  "claude-haiku-5-5": { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5 },
};
/** The DNESKAi daily generation ceiling (`MARKETING_DNESKAI_DAILY_GENERATION_USD` default); a run may only lower it. */
export const DNESKAI_AB_CEILING_USD = 1;
/** The worker's budget for a brief job (`worker-runtime.ts`). */
export const DNESKAI_AB_BUDGET: GenerationBudget = { ...DEFAULT_GENERATION_BUDGET, maxLatencyMs: 45000 };
/** Estimate only: UTF-8 bytes of Czech JSON per token. Generation itself reserves one token per byte. */
export const BYTES_PER_TOKEN_ESTIMATE = 3;
/** Estimate only: output tokens of an accepted answer (caption, four to seven slides, alt texts). */
export const EXPECTED_OUTPUT_TOKENS = 1500;

type Pricing = { inputPerMillionUsd: number; outputPerMillionUsd: number };
export type AbOptions = {
  briefs: string; modelA: string; modelB: string; priceA: Pricing; priceB: Pricing; limit: number; ceilingUsd: number;
  live: boolean; mediaDir: string | null; output: string;
};
const MODEL = /^claude-[a-z0-9.-]+$/;
function price(value: string): Pricing {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
  const pricing = match ? { inputPerMillionUsd: Number(match[1]), outputPerMillionUsd: Number(match[2]) } : null;
  if (!pricing || !(pricing.inputPerMillionUsd > 0) || !(pricing.outputPerMillionUsd > 0)) throw new Error("usage: a price is INPUT:OUTPUT USD per million tokens, e.g. 2:10");
  return pricing;
}
export function parseAbOptions(argv: readonly string[], now = new Date()): AbOptions {
  const raw: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--live") { raw.live = true; continue; }
    if (!["--briefs", "--model-a", "--model-b", "--price-a", "--price-b", "--limit", "--ceiling-usd", "--media-dir", "--output"].includes(argument)) throw new Error(`usage: unknown argument ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`usage: ${argument} needs a value`);
    raw[argument.slice(2)] = value; index += 1;
  }
  if (typeof raw.briefs !== "string") throw new Error("usage: --briefs FILE is required");
  const modelA = typeof raw["model-a"] === "string" ? raw["model-a"] : "claude-sonnet-5-5";
  const modelB = typeof raw["model-b"] === "string" ? raw["model-b"] : "claude-haiku-5-5";
  if (!MODEL.test(modelA) || !MODEL.test(modelB) || modelA === modelB) throw new Error("usage: two different claude-… model ids");
  const pricing = (model: string, value: unknown) => {
    if (typeof value === "string") return price(value);
    const known = KNOWN_PRICING[model];
    if (!known) throw new Error(`usage: --price-${model === modelA ? "a" : "b"} is required for ${model}`);
    return known;
  };
  const limit = typeof raw.limit === "string" ? Number(raw.limit) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("usage: --limit is 1 to 200 briefs");
  const ceilingUsd = typeof raw["ceiling-usd"] === "string" ? Number(raw["ceiling-usd"]) : DNESKAI_AB_CEILING_USD;
  if (!(ceilingUsd > 0) || ceilingUsd > DNESKAI_AB_CEILING_USD) throw new Error("usage: --ceiling-usd is above 0 and at most 1.00");
  return {
    briefs: raw.briefs, modelA, modelB, priceA: pricing(modelA, raw["price-a"]), priceB: pricing(modelB, raw["price-b"]), limit, ceilingUsd,
    live: raw.live === true, mediaDir: typeof raw["media-dir"] === "string" ? raw["media-dir"] : null,
    output: typeof raw.output === "string" ? raw.output : path.join("work", `dneskai-model-ab-${now.toISOString().slice(0, 10)}.json`),
  };
}

/** Briefs from an export: an array of briefs, of `marketing_dneskai_briefs` rows with a `brief`, or `{ briefs: [...] }`. */
export function readBriefExport(value: unknown): { briefs: DneskaiBrief[]; skipped: number } {
  const items = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { briefs?: unknown }).briefs) ? (value as { briefs: unknown[] }).briefs : null;
  if (!items) throw new Error("briefs-export-invalid");
  const briefs: DneskaiBrief[] = []; let skipped = 0;
  for (const item of items.slice(0, 1000)) {
    const candidate = item && typeof item === "object" && "brief" in item ? (item as { brief: unknown }).brief : item;
    const brief = DneskaiBriefSchema.safeParse(candidate);
    if (brief.success) briefs.push(brief.data); else skipped += 1;
  }
  return { briefs, skipped };
}

/**
 * The source packet the worker builds for a brief. Mirrors `dneskaiBriefSourcePacket` in `dneskai-brief-source.ts`,
 * which is server-only; `tests/lib/dneskai-model-ab-script.test.ts` keeps the two equal.
 */
export function briefEvaluationPacket(brief: DneskaiBrief): SourcePacket {
  const primary = brief.evidence[0]!;
  const content = {
    title: brief.title.slice(0, 300), body: (primary.excerpt.trim() || primary.title).slice(0, 12000), category: brief.category,
    difficulty: null, code: null, options: [], answer: null, explanation: null,
    evidence: brief.evidence.map((item) => ({ url: item.url, title: item.title.slice(0, 300), excerpt: item.excerpt.slice(0, 2000), checkedAt: brief.observedAt })), image: null,
  };
  return parseSourcePacket({ schemaVersion: MARKETING_SOURCE_VERSION, brand: "dneskai", kind: "brief", sourceId: brief.eventId, sourceRevision: brief.memberHash, contentHash: contentHash(content),
    canonicalUrl: primary.url, locale: "cs", observedAt: brief.observedAt, expiresAt: brief.expiresAt, eligible: true, eligibilityReason: "research-selection-not-fact-checked", content, brief });
}

const usd = (inputTokens: number, outputTokens: number, pricing: Pricing) => (inputTokens * pricing.inputPerMillionUsd + outputTokens * pricing.outputPerMillionUsd) / 1_000_000;
const round = (value: number) => Number(value.toFixed(6));
/** Prompt size of one brief, as `generation.ts` measures it before the first call. */
export async function briefPromptBytes(brief: DneskaiBrief, budget: GenerationBudget = DNESKAI_AB_BUDGET): Promise<number> {
  const schema = dneskaiCopyWireSchema();
  const promptBytes = budget.maxInputTokens - Buffer.byteLength(DNESKAI_BRIEF_SYSTEM_PROMPT + JSON.stringify(schema)) - 2048 - DNESKAI_RETRY_INSTRUCTION_BYTES;
  const offer = dneskaiBriefOffer(brief, await dneskaiEvidencePublishers(brief.evidence.slice(0, 6)), { promptBytes });
  return Buffer.byteLength(DNESKAI_BRIEF_SYSTEM_PROMPT + dneskaiBriefPrompt(offer) + JSON.stringify(schema)) + 2048;
}
/**
 * One brief on one model. `expectedUsd`: one accepted attempt at the estimated tokens. `retryUsd`: a refused first
 * attempt and its retry. `worstUsd`: what generation reserves, every attempt at one token per byte and the full
 * output limit; the live run admits calls against this.
 */
export function briefCost(baseBytes: number, pricing: Pricing, budget: GenerationBudget = DNESKAI_AB_BUDGET) {
  const estimatedInputTokens = Math.ceil(baseBytes / BYTES_PER_TOKEN_ESTIMATE);
  const retryInputTokens = Math.ceil((baseBytes + DNESKAI_RETRY_INSTRUCTION_BYTES) / BYTES_PER_TOKEN_ESTIMATE);
  const attemptReservationUsd = usd(baseBytes + DNESKAI_RETRY_INSTRUCTION_BYTES, budget.maxOutputTokens, pricing);
  return {
    estimatedInputTokens, expectedUsd: round(usd(estimatedInputTokens, EXPECTED_OUTPUT_TOKENS, pricing)),
    retryUsd: round(usd(estimatedInputTokens + retryInputTokens, 2 * EXPECTED_OUTPUT_TOKENS, pricing)),
    attemptReservationUsd: round(attemptReservationUsd), worstUsd: round(Math.min(attemptReservationUsd * budget.maxAttempts, budget.maxCostUsd)),
  };
}

export async function planModelAb(briefs: readonly DneskaiBrief[], options: Pick<AbOptions, "modelA" | "modelB" | "priceA" | "priceB" | "ceilingUsd">) {
  const bytes = await Promise.all(briefs.map((brief) => briefPromptBytes(brief)));
  const models = ([[options.modelA, options.priceA], [options.modelB, options.priceB]] as const).map(([model, pricing]) => {
    const costs = bytes.map((value) => briefCost(value, pricing));
    const sum = (field: "expectedUsd" | "retryUsd" | "worstUsd") => round(costs.reduce((total, cost) => total + cost[field], 0));
    return { model, pricing, totalExpectedUsd: sum("expectedUsd"), totalWithOneRetryUsd: sum("retryUsd"), totalWorstUsd: sum("worstUsd"),
      meanEstimatedInputTokens: costs.length ? Math.round(costs.reduce((total, cost) => total + cost.estimatedInputTokens, 0) / costs.length) : 0, perBrief: costs };
  });
  const totalWorstUsd = round(models[0]!.totalWorstUsd + models[1]!.totalWorstUsd);
  const worstPairs = bytes.map((_, index) => models[0]!.perBrief[index]!.worstUsd + models[1]!.perBrief[index]!.worstUsd);
  const meanPair = worstPairs.length ? worstPairs.reduce((total, value) => total + value, 0) / worstPairs.length : 0;
  return {
    schemaVersion: "dneskai-model-ab-plan/1", briefs: briefs.length, ceilingUsd: options.ceilingUsd, providerCalls: 0,
    totalExpectedUsd: round(models[0]!.totalExpectedUsd + models[1]!.totalExpectedUsd), totalWorstUsd,
    // How many briefs both models can run per ceiling day when every call needs its full reservation.
    briefsPerCeilingDay: meanPair ? Math.floor(options.ceilingUsd / meanPair) : 0, ceilingDaysAtWorst: Math.ceil(totalWorstUsd / options.ceilingUsd),
    models: models.map(({ perBrief, ...model }) => ({ ...model, perBriefWorstUsd: perBrief.map((cost) => cost.worstUsd) })),
  };
}

export type AbIo = {
  env: Record<string, string | undefined>;
  readFile(file: string): Promise<string>;
  writeFile(file: string, contents: string): Promise<void>;
  mediaLoader(directory: string): Promise<LoadDneskaiMediaBytes>;
  createModel(config: { apiKey: string; model: string; pricing: Pricing }): Promise<MarketingModel>;
  log(line: string): void;
};
type AttemptRecord = { attempt: number; issues: string[]; inputTokens: number; outputTokens: number; costUsd: number };
/** Records what a trace would, in memory only: attempts, their issue codes, tokens and cost. */
function attemptRecorder(): { tracer: MarketingTracer; attempts: AttemptRecord[] } {
  const attempts: AttemptRecord[] = [];
  return { attempts, tracer: { start: async () => ({ id: "00000000-0000-4000-8000-000000000000",
    stage: async (event) => { attempts.push({ attempt: event.attempt, issues: [...event.issues], inputTokens: event.usage.inputTokens, outputTokens: event.usage.outputTokens, costUsd: round(event.costUsd) }); },
    finish: async () => {} }) } };
}

export async function runModelAb(options: AbOptions, io: AbIo) {
  const { briefs: all, skipped } = readBriefExport(JSON.parse(await io.readFile(options.briefs)));
  const briefs = all.slice(0, options.limit);
  const plan = await planModelAb(briefs, options);
  io.log(JSON.stringify({ mode: options.live ? "live" : "plan", skippedBriefs: skipped, ...plan }));
  if (!options.live) return { plan, result: null };
  if (io.env.MARKETING_AI_CONSENT !== "true") throw new Error("marketing-consent-required");
  if (!io.env.ANTHROPIC_API_KEY) throw new Error("provider-configuration-required");
  if (!options.mediaDir) throw new Error("usage: --live needs --media-dir");
  const loadMedia = await io.mediaLoader(options.mediaDir);
  const models = [
    await io.createModel({ apiKey: io.env.ANTHROPIC_API_KEY, model: options.modelA, pricing: options.priceA }),
    await io.createModel({ apiKey: io.env.ANTHROPIC_API_KEY, model: options.modelB, pricing: options.priceB }),
  ];
  let reservedUsd = 0, spentUsd = 0;
  let stopped: string | null = null;
  const runs: Array<Record<string, unknown>> = [];
  for (const [index, brief] of briefs.entries()) {
    const pair = plan.models[0]!.perBriefWorstUsd[index]! + plan.models[1]!.perBriefWorstUsd[index]!;
    // Both models or neither: a brief only one model saw would skew the comparison.
    if (reservedUsd + pair > options.ceilingUsd + 1e-9) { stopped = "ceiling-reached"; break; }
    reservedUsd += pair;
    const packet = briefEvaluationPacket(brief);
    const now = new Date(brief.observedAt);
    const scheduledAt = new Date(Math.max(Date.parse(brief.scheduledAt), now.getTime() + 3600000)).toISOString();
    for (const model of models) {
      const recorder = attemptRecorder();
      let usage = { attempts: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
      const started = Date.now();
      const record: Record<string, unknown> = { eventIdHash: traceIdentifierHash(brief.eventId), category: brief.category, model: model.model };
      try {
        const draft = await generateMarketingDraft({ source: packet, account: { id: "offline-evaluation", platform: "instagram", handle: "dneskai" }, scheduledAt, templateVersion: DNESKAI_DECK_TEMPLATE_VERSION,
          knowledge: [], consent: true, revisionId: derivedUuid("dneskai-model-ab", model.model, brief.eventId, brief.memberHash) },
        { model, tracer: recorder.tracer, now: () => now, budget: DNESKAI_AB_BUDGET, loadDneskaiMedia: loadMedia, evidencePublishers: dneskaiEvidencePublishers,
          admitPaidCall: async () => {}, onUsage: (value) => { usage = value; } });
        usage = draft.usage;
        Object.assign(record, { ok: true, ...dneskaiDeckTraceShape(draft.deck!), draft: { title: draft.revision.title, caption: draft.revision.caption, deck: draft.deck } });
      } catch (failure) {
        Object.assign(record, { ok: false, errorCode: failure instanceof MarketingGenerationError ? failure.code : "generation-failed" });
      }
      spentUsd += usage.estimatedCostUsd;
      runs.push(Object.assign(record, { attempts: usage.attempts, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: round(usage.estimatedCostUsd), latencyMs: Date.now() - started,
        attemptIssues: recorder.attempts.map((attempt) => attempt.issues), clipRetry: recorder.attempts.some((attempt) => attempt.issues.includes("text-clipped")) }));
    }
  }
  const summary = models.map((model) => {
    const mine = runs.filter((run) => run.model === model.model);
    const produced = mine.filter((run) => run.ok).length;
    return { model: model.model, runs: mine.length, produced, producedShare: mine.length ? round(produced / mine.length) : null,
      retried: mine.filter((run) => (run.attempts as number) > 1).length, clipRetries: mine.filter((run) => run.clipRetry).length,
      meanAttempts: mine.length ? round(mine.reduce((sum, run) => sum + (run.attempts as number), 0) / mine.length) : null,
      costUsd: round(mine.reduce((sum, run) => sum + (run.costUsd as number), 0)),
      // Needs the owner: read the drafts in the result file, or compare with the owner-edits dataset of the production model.
      approvedWithoutEditsShare: null };
  });
  const result = { schemaVersion: "dneskai-model-ab-result/1", stopped, reservedUsd: round(reservedUsd), spentUsd: round(spentUsd), summary, runs };
  await io.writeFile(options.output, `${JSON.stringify(result, null, 2)}\n`);
  io.log(JSON.stringify({ written: options.output, stopped, spentUsd: result.spentUsd, summary }));
  return { plan, result };
}

/** Pictures named by their sha256 (any extension); each is checked against its name when loaded. */
async function directoryMedia(directory: string): Promise<LoadDneskaiMediaBytes> {
  const files = new Map<string, string>();
  for (const name of await readdir(directory)) {
    const hash = /^([a-f0-9]{64})(?:\.[a-z0-9]{1,5})?$/.exec(name)?.[1];
    if (hash) files.set(hash, path.join(directory, name));
  }
  return async (sha256) => {
    const file = files.get(sha256);
    if (!file) throw new Error("media-asset-unavailable");
    const bytes = await readFile(file);
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("media-asset-unavailable");
    return bytes;
  };
}

if (typeof require !== "undefined" && require.main === module) {
  (async () => {
    await runModelAb(parseAbOptions(process.argv.slice(2)), {
      env: process.env, readFile: (file) => readFile(file, "utf8"),
      async writeFile(file, contents) {
        await mkdir(path.dirname(path.resolve(file)), { recursive: true });
        try { await writeFile(file, contents, { mode: 0o600, flag: "wx" }); }
        catch (failure) { throw new Error((failure as { code?: unknown }).code === "EEXIST" ? "output-exists" : "output-unwritable"); }
      },
      mediaLoader: directoryMedia, createModel: createClaudeMarketingModel, log: (line) => { process.stdout.write(`${line}\n`); },
    });
  })().catch((failure: unknown) => {
    const message = failure instanceof Error && /^(?:usage: [ -~]{1,160}|[a-z-]{1,60})$/.test(failure.message) ? failure.message : "model-ab-failed";
    process.stderr.write(`${message}\n`); process.exitCode = 1;
  });
}
