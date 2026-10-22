import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DNESKAI_AB_BUDGET, KNOWN_PRICING, briefCost, briefEvaluationPacket, briefPromptBytes, parseAbOptions, readBriefExport, runModelAb, type AbIo,
} from "../../scripts/dneskai-model-ab";
import { dneskaiBriefSourcePacket } from "@/lib/marketing/dneskai-brief-source";
import { DNESKAI_RETRY_INSTRUCTION_BYTES } from "@/lib/marketing/dneskai-generation";
import type { MarketingModel } from "@/lib/marketing/generation";
import { briefFixture, briefPictures, validCopy, type BriefPictures } from "./marketing-dneskai-generation-fixture";

vi.mock("server-only", () => ({}));
let pictures: BriefPictures;
beforeAll(async () => { pictures = await briefPictures(); });
const options = (argv: string[] = []) => parseAbOptions(["--briefs", "briefs.json", ...argv], new Date("2026-10-21T10:00:00Z"));
function io(briefs: unknown, env: Record<string, string | undefined> = {}, models: Record<string, MarketingModel> = {}): AbIo & { lines: string[] } {
  const lines: string[] = [];
  return { lines, env, readFile: vi.fn(async () => JSON.stringify(briefs)), writeFile: vi.fn(async () => {}),
    mediaLoader: vi.fn(async () => async (sha256: string) => Object.values(pictures).find((entry) => entry.sha256 === sha256)!.bytes),
    createModel: vi.fn(async (config: { model: string }) => models[config.model]!), log: (line) => { lines.push(line); } };
}
function fake(model: string, answers: unknown[]): MarketingModel {
  return { model, pricing: KNOWN_PRICING[model]!, invoke: vi.fn(async () => ({ copy: answers.shift() ?? null, usage: { inputTokens: 3000, outputTokens: 1500 } })) };
}

describe("scripts/dneskai-model-ab.ts options and inputs (#122)", () => {
  it("defaults to Sonnet 5.5 against Haiku 5.5 at list prices, 20 briefs and the 1.00 USD ceiling", () => {
    expect(options()).toEqual({ briefs: "briefs.json", modelA: "claude-sonnet-5-5", modelB: "claude-haiku-5-5", priceA: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 }, priceB: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.5 },
      limit: 20, ceilingUsd: 1, live: false, mediaDir: null, output: "work/dneskai-model-ab-2026-10-21.json" });
    expect(options(["--model-b", "claude-opus-5-5", "--price-b", "4:20", "--ceiling-usd", "0.5"])).toMatchObject({ modelB: "claude-opus-5-5", priceB: { inputPerMillionUsd: 4, outputPerMillionUsd: 20 }, ceilingUsd: 0.5 });
  });
  it("refuses a raised ceiling, one model twice, an unknown model without a price and missing briefs", () => {
    expect(() => options(["--ceiling-usd", "2"])).toThrow("at most 1.00");
    expect(() => options(["--model-b", "claude-sonnet-5-5"])).toThrow("two different");
    expect(() => options(["--model-b", "claude-opus-5-5"])).toThrow("--price-b is required");
    expect(() => parseAbOptions([])).toThrow("--briefs FILE is required");
    expect(() => options(["--price-a", "free"])).toThrow("INPUT:OUTPUT");
  });
  it("reads briefs, brief rows and a briefs object, skipping anything that is not a brief", () => {
    const brief = briefFixture(pictures);
    expect(readBriefExport([brief, { brief }, { brief: { title: "x" } }])).toEqual({ briefs: [brief, brief], skipped: 1 });
    expect(readBriefExport({ briefs: [brief] }).briefs).toHaveLength(1);
    expect(() => readBriefExport({ rows: [] })).toThrow("briefs-export-invalid");
  });
  it("builds exactly the worker's source packet", () => {
    const brief = briefFixture(pictures);
    expect(briefEvaluationPacket(brief)).toEqual(dneskaiBriefSourcePacket(brief));
  });
});

describe("the dry plan (#122)", () => {
  it("prices one brief from its exact prompt bytes and the generation reservation", async () => {
    const base = await briefPromptBytes(briefFixture(pictures));
    const sonnet = briefCost(base, KNOWN_PRICING["claude-sonnet-5-5"]!);
    const reservation = ((base + DNESKAI_RETRY_INSTRUCTION_BYTES) * 2 + DNESKAI_AB_BUDGET.maxOutputTokens * 10) / 1_000_000;
    expect(sonnet.attemptReservationUsd).toBeCloseTo(reservation, 6);
    expect(sonnet.worstUsd).toBeCloseTo(Math.min(2 * reservation, 0.13), 6);
    expect(sonnet.expectedUsd).toBeLessThan(sonnet.retryUsd);
    expect(sonnet.retryUsd).toBeLessThan(sonnet.worstUsd);
    const haiku = briefCost(base, KNOWN_PRICING["claude-haiku-5-5"]!);
    expect(haiku.worstUsd).toBeLessThan(sonnet.worstUsd / 10);
  });
  it("prints the plan against the ceiling, calls no model and writes nothing", async () => {
    const briefs = Array.from({ length: 25 }, () => briefFixture(pictures));
    const run = io(briefs);
    const { plan, result } = await runModelAb(options(), run);
    expect(result).toBeNull();
    expect(run.createModel).not.toHaveBeenCalled(); expect(run.writeFile).not.toHaveBeenCalled(); expect(run.mediaLoader).not.toHaveBeenCalled();
    expect(plan).toMatchObject({ briefs: 20, ceilingUsd: 1, providerCalls: 0 });
    expect(plan.models.map((model) => model.model)).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
    expect(plan.totalWorstUsd).toBeCloseTo(plan.models[0]!.totalWorstUsd + plan.models[1]!.totalWorstUsd, 6);
    expect(plan.ceilingDaysAtWorst).toBe(Math.ceil(plan.totalWorstUsd / 1));
    expect(plan.briefsPerCeilingDay).toBe(Math.floor(1 / (plan.models[0]!.perBriefWorstUsd[0]! + plan.models[1]!.perBriefWorstUsd[0]!)));
    expect(JSON.parse(run.lines[0]!)).toMatchObject({ mode: "plan", skippedBriefs: 0, briefs: 20 });
  });
});

describe("the live run (#122), with fake models only", () => {
  it("refuses without consent, a key or a media directory before creating a model", async () => {
    const briefs = [briefFixture(pictures)];
    await expect(runModelAb(options(["--live", "--media-dir", "media"]), io(briefs, { ANTHROPIC_API_KEY: "test-only" }))).rejects.toThrow("marketing-consent-required");
    await expect(runModelAb(options(["--live", "--media-dir", "media"]), io(briefs, { MARKETING_AI_CONSENT: "true" }))).rejects.toThrow("provider-configuration-required");
    const run = io(briefs, { MARKETING_AI_CONSENT: "true", ANTHROPIC_API_KEY: "test-only" });
    await expect(runModelAb(options(["--live"]), run)).rejects.toThrow("--media-dir");
    expect(run.createModel).not.toHaveBeenCalled();
  });
  it("runs both models on the same briefs through the real gate and reports attempts, retries and cost", async () => {
    const refused = validCopy(pictures); refused.slides[1]!.images[0]!.assetSha256 = "f".repeat(64);
    const sonnet = fake("claude-sonnet-5-5", [validCopy(pictures)]);
    const haiku = fake("claude-haiku-5-5", [refused, refused]);
    const run = io([briefFixture(pictures)], { MARKETING_AI_CONSENT: "true", ANTHROPIC_API_KEY: "test-only" }, { "claude-sonnet-5-5": sonnet, "claude-haiku-5-5": haiku });
    const { result } = await runModelAb(options(["--live", "--media-dir", "media"]), run);
    expect(run.createModel).toHaveBeenCalledWith({ apiKey: "test-only", model: "claude-sonnet-5-5", pricing: KNOWN_PRICING["claude-sonnet-5-5"] });
    expect(result!.stopped).toBeNull();
    expect(result!.summary).toEqual([
      { model: "claude-sonnet-5-5", runs: 1, produced: 1, producedShare: 1, retried: 0, clipRetries: 0, meanAttempts: 1, costUsd: 0.021, approvedWithoutEditsShare: null },
      { model: "claude-haiku-5-5", runs: 1, produced: 0, producedShare: 0, retried: 1, clipRetries: 0, meanAttempts: 2, costUsd: 0.0021, approvedWithoutEditsShare: null },
    ]);
    expect(result!.runs[0]).toMatchObject({ ok: true, format: "carousel", slide_types: { "cover-photo": 1, sources: 1 }, draft: { caption: expect.any(String) } });
    expect(result!.runs[1]).toMatchObject({ ok: false, errorCode: "copy-validation-failed", attemptIssues: [["unknown-asset"], ["unknown-asset"]] });
    const [file, contents] = (run.writeFile as ReturnType<typeof vi.fn>).mock.calls[0]! as [string, string];
    expect(file).toBe("work/dneskai-model-ab-2026-10-21.json");
    expect(JSON.parse(contents).schemaVersion).toBe("dneskai-model-ab-result/1");
  }, 30000);
  it("stops before a brief whose worst case would pass the ceiling", async () => {
    const sonnet = fake("claude-sonnet-5-5", []); const haiku = fake("claude-haiku-5-5", []);
    const run = io([briefFixture(pictures)], { MARKETING_AI_CONSENT: "true", ANTHROPIC_API_KEY: "test-only" }, { "claude-sonnet-5-5": sonnet, "claude-haiku-5-5": haiku });
    const { result } = await runModelAb(options(["--live", "--media-dir", "media", "--ceiling-usd", "0.01"]), run);
    expect(result).toMatchObject({ stopped: "ceiling-reached", reservedUsd: 0, spentUsd: 0, runs: [] });
    expect(sonnet.invoke).not.toHaveBeenCalled(); expect(haiku.invoke).not.toHaveBeenCalled();
  });
});
