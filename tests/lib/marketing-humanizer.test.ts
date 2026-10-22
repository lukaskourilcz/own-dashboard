import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { authoredCodingChallenge, authoredMarketingText, DEFAULT_GENERATION_BUDGET, generateMarketingDraft, generationPrompt, MARKETING_PROMPT_VERSION, type GenerationInput, type MarketingCopy, type MarketingModel } from "@/lib/marketing/generation";
import { marketingHumanizerInstructions, MARKETING_HUMANIZER_MAX_BYTES, MARKETING_HUMANIZER_POLICY_FINGERPRINT } from "@/lib/marketing/humanizer";
import { parseSourcePacket, type SourcePacket } from "@/lib/marketing/contracts";
import provenance from "../../templates/marketing/humanizer/provenance.json";
import heldQuestion from "../../templates/marketing/benchmarks/devshark-question.json";
import heldTask from "../../templates/marketing/benchmarks/devshark-coding-task.json";
import heldArticle from "../../templates/marketing/benchmarks/dneskai-article.json";

function source(fixture: typeof heldQuestion | typeof heldTask | typeof heldArticle): SourcePacket {
  return parseSourcePacket({ ...structuredClone(fixture), eligible: true, eligibilityReason: "OFFLINE HUMANIZER INTEGRATION SIMULATION ONLY", observedAt: new Date().toISOString(), expiresAt: fixture.expiresAt === null ? null : new Date(Date.now() + 86400000).toISOString() });
}
function input(packet: SourcePacket): GenerationInput {
  return { source: packet, consent: true, knowledge: [], scheduledAt: new Date(Date.now() + 3600000).toISOString(), revisionId: "33333333-3333-4333-8333-333333333333",
    templateVersion: `${packet.brand}-editorial/2`, account: { id: "test-only", handle: "test-only", platform: "instagram" } };
}
function copy(packet: SourcePacket): MarketingCopy {
  const body = packet.kind === "article" ? packet.content.body.split(/(?<=[.!?])\s+/)[0] : "Read the authored exercise and explanation.";
  return { title: packet.content.title, caption: body, locale: packet.locale, slides: [
    { headline: packet.content.title, body, code: null, evidenceIndexes: packet.kind === "article" ? [0] : [] },
    { headline: packet.locale === "cs" ? "Souvislosti článku" : "Authored exercise", body, code: null, evidenceIndexes: packet.kind === "article" ? [0] : [] },
  ] };
}
function provider(result: MarketingCopy): MarketingModel & { invoke: ReturnType<typeof vi.fn> } {
  return { model: "claude-offline-humanizer-test", pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, invoke: vi.fn(async () => ({ copy: result, usage: { inputTokens: 200, outputTokens: 100 } })) };
}

describe("bounded Humanizer embedded in the existing Claude generation", () => {
  it("pins the verbatim upstream skill/license and fingerprints a small adaptation", () => {
    expect(provenance.commit).toBe("225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8"); expect(provenance.skillVersion).toBe("3.1.0"); expect(provenance.license).toBe("MIT");
    for (const [filename, expected] of Object.entries(provenance.files)) {
      const bytes = readFileSync(`templates/marketing/humanizer/${filename}`);
      expect(bytes.length).toBe(expected.bytes); expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);
    }
    expect(provenance.files["SKILL.md"].sha256).toBe("0612f1dfb1672b0ea9b97e139bf1f06cabe98d8b27424fe8ff01e1fb4cc99cad");
    expect(provenance.files.LICENSE.sha256).toBe("4ac4810254ab36d45419141aeb8e69bf50652cfafe5b2dab947d06d44e5cbf96");
    expect(MARKETING_HUMANIZER_POLICY_FINGERPRINT).toMatch(/^[a-f0-9]{64}$/);
    for (const locale of ["cs", "en"] as const) {
      const policy = marketingHumanizerInstructions({ locale });
      expect(Buffer.byteLength(policy)).toBeLessThanOrEqual(MARKETING_HUMANIZER_MAX_BYTES);
      expect(policy).toContain(provenance.commit); expect(policy).toContain(MARKETING_HUMANIZER_POLICY_FINGERPRINT);
      expect(policy).not.toContain("# Humanizer: remove AI writing patterns");
    }
  });
  it.each([heldQuestion, heldArticle])("passes Humanizer review into the actual one-call invocation for $brand/$locale", async (fixture) => {
    const packet = source(fixture); const model = provider(copy(packet));
    const draft = await generateMarketingDraft(input(packet), { model });
    expect(model.invoke).toHaveBeenCalledTimes(1);
    const call = model.invoke.mock.calls[0][0];
    expect(call.system).toContain("Inside this same structured response");
    expect(call.system).toContain("upstream 3.1.0@225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8");
    expect(call.system).toContain(packet.locale === "cs" ? "natural Czech editorial prose" : "plain English for developers");
    expect(call.system).toContain("Never invent first-person experience");
    expect(call.system).toContain("uncertainty, attribution and evidence indexes");
    expect(JSON.parse(call.prompt).source.content).toEqual(expect.objectContaining({ body: packet.content.body, code: packet.content.code }));
    expect(draft.revision.promptVersion).toBe("marketing-copy/4"); expect(MARKETING_PROMPT_VERSION).toBe("marketing-copy/4");
    expect(draft.usage).toEqual({ attempts: 1, inputTokens: 200, outputTokens: 100, estimatedCostUsd: 0.0021 });
    expect(DEFAULT_GENERATION_BUDGET).toEqual({ maxAttempts: 2, maxInputTokens: 20000, maxOutputTokens: 2500, maxCostUsd: 0.13, maxLatencyMs: 60000 });
    expect(fixture.eligible).toBe(false);
  });
  it("keeps authored question/code/options/answer/explanation unchanged after style instructions", async () => {
    const packet = source(heldQuestion); const original = structuredClone(packet); const model = provider(copy(packet));
    const draft = await generateMarketingDraft(input(packet), { model });
    expect(draft.slides[0]).toMatchObject({ headline: packet.content.title, body: authoredMarketingText(packet.content.body, packet.content.code) });
    expect(draft.slides[1].code).toBe(packet.content.code);
    expect(draft.slides[2].body).toBe(packet.content.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join("\n"));
    expect(draft.slides[3].body).toBe(`${packet.content.answer}\n\n${packet.content.explanation}`);
    expect(packet).toEqual(original); expect(draft.revision.assets).toEqual([]);
    expect(model.invoke).toHaveBeenCalledTimes(1);
  });
  it("keeps the full challenge spec/code and server caption deterministic despite model-written hype/solutions", async () => {
    const packet = source(heldTask); const challenge = authoredCodingChallenge(packet); const result = copy(packet);
    result.title = "A magical solution"; result.caption = "I built this solution and it changes everything."; result.slides[0].body = "Use my invented algorithm.";
    const model = provider(result); const draft = await generateMarketingDraft(input(packet), { model });
    expect(draft.revision.title).toBe(challenge.title); expect(draft.revision.caption).toBe(challenge.caption); expect(draft.slides).toEqual(challenge.slides);
    expect(draft.slides.some((slide) => slide.code === heldTask.content.code)).toBe(true);
    expect(JSON.stringify(draft.revision)).not.toContain("magical solution");
    expect(model.invoke).toHaveBeenCalledTimes(1); expect(heldTask.eligible).toBe(false);
  });
  it("still holds fabricated numerical claims and schema drift without adding any style-review calls", async () => {
    const packet = source(heldArticle);
    for (const mutation of [{ caption: "999999991% lidí to potvrdilo." }, { critique: "Humanizer draft commentary must not enter the stored copy" }]) {
      const result = { ...copy(packet), ...mutation }; const model = provider(result);
      await expect(generateMarketingDraft(input(packet), { model, budget: { ...DEFAULT_GENERATION_BUDGET, maxAttempts: 1 } })).rejects.toThrow("copy-validation-failed");
      expect(model.invoke).toHaveBeenCalledTimes(1);
    }
  });
  it("includes adapter bytes in unchanged admission arithmetic and keeps consent/source holds before invocation", async () => {
    const packet = source(heldQuestion); const model = provider(copy(packet));
    const prompts = generationPrompt(packet, []);
    expect(prompts.system).toContain(MARKETING_HUMANIZER_POLICY_FINGERPRINT);
    await expect(generateMarketingDraft(input(packet), { model, budget: { ...DEFAULT_GENERATION_BUDGET, maxInputTokens: 1000 } })).rejects.toThrow("input-budget-exceeded");
    await expect(generateMarketingDraft({ ...input(packet), consent: false }, { model })).rejects.toThrow("consent-required");
    await expect(generateMarketingDraft({ ...input(packet), source: parseSourcePacket(heldQuestion) }, { model })).rejects.toThrow("source-unavailable");
    expect(model.invoke).not.toHaveBeenCalled();
  });
});
