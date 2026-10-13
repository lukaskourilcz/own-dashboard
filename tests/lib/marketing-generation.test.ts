import { describe, expect, it, vi } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateMarketingDraft, generationPrompt, authoredMarketingText, authoredCodingChallenge, MarketingCopySchema, validateMarketingCopy, DEFAULT_GENERATION_BUDGET, type GenerationInput, type MarketingModel } from "@/lib/marketing/generation";
import { parseSourcePacket, type ContentRevision } from "@/lib/marketing/contracts";
import { contentHash } from "@/lib/marketing/hashes";
import { fitMarketingText, marketingTemplateDigest, pendingMarketingTemplate, renderMarketingAssets, renderMarketingPreview, validateMarketingTemplate } from "@/lib/marketing/render";
import dnesTemplate from "../../templates/marketing/dneskai/template.json";
import devTemplate from "../../templates/marketing/devshark/template.json";
import sharp from "sharp";
import { evaluateMarketingBenchmark } from "@/lib/marketing/generation-benchmark";
import realQuestion from "../../templates/marketing/benchmarks/devshark-question.json";
import realTask from "../../templates/marketing/benchmarks/devshark-coding-task.json";
import realArticle from "../../templates/marketing/benchmarks/dneskai-article.json";

// Synthetic QA fixtures only; never use them as a source/export/publishing example.
const content = { title: "Test-only JavaScript question", body: "Which value does this expression return?", category: "JavaScript", difficulty: "Easy", code: "const x = 1;\nconsole.log(x);", options: ["1", "2"], answer: "1", explanation: "The variable stores the number 1.", evidence: [], image: null };
const packet = parseSourcePacket({ schemaVersion: "marketing-source/1", brand: "devshark", kind: "question", sourceId: "test-only", sourceRevision: "test-v1", contentHash: contentHash(content), canonicalUrl: "https://devshark.app/test-only", locale: "en", observedAt: "2026-10-13T08:00:00Z", expiresAt: null, eligible: true, eligibilityReason: "test-only", content });
const input: GenerationInput = { source: packet, account: { id: "test-only", platform: "instagram", handle: "test-only" }, scheduledAt: "2026-10-14T10:00:00Z", templateVersion: "devshark-editorial/2", knowledge: [], consent: true, revisionId: "f76d5271-0d87-4b76-ad17-ebc16d9f3b2e" };
const copy = { title: "Test-only question", caption: "Read the question and choose an answer.", locale: "en", slides: [{ headline: "Choose an answer", body: "Read the question.", code: null, evidenceIndexes: [] }, { headline: "Review", body: "Read the authored explanation.", code: null, evidenceIndexes: [] }] };
const now = () => new Date("2026-10-13T09:00:00Z");
function model(results = [{ copy, usage: { inputTokens: 200, outputTokens: 100 } }]) {
  const invoke = vi.fn(async () => results.shift() ?? { copy, usage: { inputTokens: 200, outputTokens: 100 } });
  return { model: "claude-sonnet-4-6", pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, invoke } satisfies MarketingModel;
}
function revision(brand: "dneskai" | "devshark"): ContentRevision {
  return { schemaVersion: "marketing-content/1", brand, title: "Test-only", caption: "Test-only caption", format: "carousel", sources: [{ sourceId: packet.sourceId, sourceRevision: packet.sourceRevision, contentHash: packet.contentHash }], knowledgeIds: [], assets: [], account: input.account, scheduledAt: input.scheduledAt, timeZone: "Europe/Prague", templateVersion: `${brand}-editorial/2`, promptVersion: "marketing-copy/1", model: "claude-sonnet-4-6", traceId: null };
}

describe("bounded source-derived generation", () => {
  it("preserves authored exponent operators while removing actual emphasis markers", () => {
    expect(authoredMarketingText("** has higher precedence than +, so 2 ** 3 is evaluated first.", null)).toBe("** has higher precedence than +, so 2 ** 3 is evaluated first.");
    expect(authoredMarketingText("Read **this explanation** and `code`.", null)).toBe("Read this explanation and code.");
    expect(authoredMarketingText("Evaluate `2**3**4` before adding 1.", null)).toBe("Evaluate 2**3**4 before adding 1.");
  });
  it("rejects missing consent, retired sources, bad hashes and reference-as-source before calling a model", async () => {
    for (const patch of [{ consent: false }, { source: { ...packet, eligible: false } }, { source: { ...packet, contentHash: "0".repeat(64) } }, { source: { ...packet, kind: "instagram-reference" } }]) {
      const provider = model();
      await expect(generateMarketingDraft({ ...input, ...patch } as GenerationInput, { model: provider, now })).rejects.toThrow();
      expect(provider.invoke).not.toHaveBeenCalled();
    }
  });
  it("preserves authored options, answer, explanation and exact code; keeps draft unapproved", async () => {
    const provider = model();
    const draft = await generateMarketingDraft(input, { model: provider, now });
    expect(draft.slides[2].body).toBe("A. 1\nB. 2");
    expect(draft.slides[1].code).toBe(content.code);
    expect(draft.slides[3].body).toBe(`${content.answer}\n\n${content.explanation}`);
    expect(draft.revision.assets).toEqual([]);
    expect(draft.revision.sources[0].contentHash).toBe(packet.contentHash);
    expect(draft.revision.caption).toContain(packet.canonicalUrl);
    expect(draft.usage).toEqual({ attempts: 1, inputTokens: 200, outputTokens: 100, estimatedCostUsd: 0.0021 });
  });
  it("uses knowledge only as presentation and rejects another brand", async () => {
    const knowledge = [{ id: "51550112-b4b7-4556-a604-8431b24401e8", brand: "devshark" as const, presentation: "Use short headlines." }];
    const prompt = JSON.parse(generationPrompt(packet, knowledge).prompt);
    expect(prompt.presentationOnly).toEqual(["Use short headlines."]);
    expect(prompt.source.content).toEqual(expect.objectContaining({ explanation: content.explanation }));
    const provider = model();
    await expect(generateMarketingDraft({ ...input, knowledge: [{ ...knowledge[0], brand: "dneskai" }] }, { model: provider, now })).rejects.toThrow("knowledge-brand-mismatch");
    expect(provider.invoke).not.toHaveBeenCalled();
  });
  it("makes at most the configured attempts and charges invalid output", async () => {
    const provider = model([{ copy: { ...copy, locale: "cs" }, usage: { inputTokens: 100, outputTokens: 100 } }, { copy, usage: { inputTokens: 200, outputTokens: 100 } }]);
    const draft = await generateMarketingDraft(input, { model: provider, now });
    expect(draft.usage.attempts).toBe(2);
    expect(provider.invoke).toHaveBeenCalledTimes(2);
    const invalid = model([{ copy: { ...copy, locale: "cs" }, usage: { inputTokens: 100, outputTokens: 100 } }, { copy: { ...copy, locale: "cs" }, usage: { inputTokens: 100, outputTokens: 100 } }]);
    await expect(generateMarketingDraft(input, { model: invalid, now })).rejects.toThrow("copy-validation-failed");
    expect(invalid.invoke).toHaveBeenCalledTimes(2);
  });
  it("does not retry ambiguous provider failures or calls without measured usage", async () => {
    const provider = model(); provider.invoke.mockRejectedValue(new Error("secret-provider-response"));
    await expect(generateMarketingDraft(input, { model: provider, now })).rejects.toThrow("provider-failed");
    expect(provider.invoke).toHaveBeenCalledTimes(1);
    const unmeasured: MarketingModel = { ...model(), invoke: vi.fn(async () => ({ copy, usage: null })) };
    await expect(generateMarketingDraft(input, { model: unmeasured, now })).rejects.toThrow("usage-unavailable");
    expect(unmeasured.invoke).toHaveBeenCalledTimes(1);
  });
  it("reserves cost and input before calls; rejects provider budget violations", async () => {
    const provider = model();
    await expect(generateMarketingDraft(input, { model: provider, now, budget: { ...DEFAULT_GENERATION_BUDGET, maxCostUsd: 0.0001 } })).rejects.toThrow("cost-budget-exceeded");
    await expect(generateMarketingDraft(input, { model: provider, now, budget: { ...DEFAULT_GENERATION_BUDGET, maxInputTokens: 1000 } })).rejects.toThrow("input-budget-exceeded");
    expect(provider.invoke).not.toHaveBeenCalled();
    const over = model([{ copy, usage: { inputTokens: 21000, outputTokens: 100 } }]);
    await expect(generateMarketingDraft(input, { model: over, now })).rejects.toThrow("provider-budget-exceeded");
  });
  it("requires article evidence per slide and refuses invented numbers/code", () => {
    const article = { ...packet, brand: "dneskai" as const, kind: "article" as const, locale: "cs" as const, content: { ...content, evidence: [{ url: "https://example.com/source", title: "Test-only source", excerpt: "Test excerpt", checkedAt: input.scheduledAt }] } };
    const result = MarketingCopySchema.parse({ ...copy, locale: "cs", slides: [{ ...copy.slides[0], body: "999%", code: "invented" }, { ...copy.slides[1], evidenceIndexes: [8] }] });
    expect(validateMarketingCopy(result, article)).toEqual(expect.arrayContaining(["unsupported-number", "model-code-forbidden", "missing-evidence", "unknown-evidence"]));
  });
  it("builds a public challenge without explanations, discarding model solutions and keeping the actual held fixture unchanged", async () => {
    const held = parseSourcePacket(realTask); const provider = model();
    await expect(generateMarketingDraft({ ...input, source: held }, { model: provider, now })).rejects.toThrow("source-unavailable");
    expect(provider.invoke).not.toHaveBeenCalled();
    // Operational eligibility is simulated only in this mock test, never in the retained producer fixture.
    const source = parseSourcePacket({ ...held, eligible: true, eligibilityReason: "mock operational simulation only" });
    const malicious = { ...copy, title: "Invented solution", caption: "Use recursion to return 999. Guaranteed solution.", slides: copy.slides.map(slide => ({ ...slide, headline: "Hidden solution", body: "Use recursion to return 999." })) };
    const draft = await generateMarketingDraft({ ...input, source }, { model: model([{ copy: malicious, usage: { inputTokens: 200, outputTokens: 100 } }]), now });
    const expected = authoredCodingChallenge(source);
    expect(draft.slides).toEqual(expected.slides);
    expect(draft.revision.title).toBe(realTask.content.title);
    expect(draft.revision.caption).toBe(`${realTask.content.title}\n\nTry the public coding challenge on devShark.\n\n${realTask.canonicalUrl}`);
    expect(JSON.stringify(draft)).not.toMatch(/999|recursion|Guaranteed|Hidden solution/);
    expect(draft.slides.find(slide => slide.code)?.code).toBe(realTask.content.code);
    const spec = draft.slides.filter(slide => slide.headline === source.content.title || slide.headline === "Public task specification");
    expect(spec.flatMap(slide => slide.body.split("\n")).join(" ").replace(/\s+/g, " ")).toBe(authoredMarketingText(source.content.body, source.content.code).replace(/\s+/g, " "));
    expect(spec.every(slide => slide.body.split("\n").length <= 6)).toBe(true);
    expect(draft.slides.length).toBeGreaterThanOrEqual(2); expect(draft.slides.length).toBeLessThanOrEqual(5);
    expect(draft.slides.at(-1)?.headline).toBe("Try the challenge");
    expect(realTask.eligible).toBe(false); expect(realTask.content.explanation).toBeNull();
    const thread = await generateMarketingDraft({ ...input, source, account: { ...input.account, platform: "threads" } }, { model: model(), now });
    expect(thread.revision.caption).toContain(source.canonicalUrl); expect(thread.revision.caption.length).toBeLessThanOrEqual(500);
    expect(generationPrompt(source, []).system).toContain("do not solve it");
  });
  it("holds full public-spec, starter-code and caption overflow before calling a model instead of truncating", async () => {
    const base = parseSourcePacket({ ...realTask, eligible: true, eligibilityReason: "mock operational simulation only" });
    for (const content of [
      { ...base.content, body: `${base.content.body} `.repeat(60) },
      { ...base.content, code: `${base.content.code}\n${"// Keep all authored starter lines.\n".repeat(20)}` },
      { ...base.content, code: `const authoredIdentifier = '${"W".repeat(100)}';` },
    ]) {
      const provider = model(); const source = { ...base, content, contentHash: contentHash(content) };
      await expect(generateMarketingDraft({ ...input, source }, { model: provider, now })).rejects.toThrow("challenge-spec-overflow");
      expect(provider.invoke).not.toHaveBeenCalled();
    }
    const provider = model();
    await expect(generateMarketingDraft({ ...input, source: { ...base, canonicalUrl: `https://devshark.app/${"a".repeat(500)}` }, account: { ...input.account, platform: "threads" } }, { model: provider, now })).rejects.toThrow("challenge-caption-overflow");
    expect(provider.invoke).not.toHaveBeenCalled();
    expect(realTask.eligible).toBe(false);
  });
});

describe("deterministic brand rendering", () => {
  it("binds template digest to current original brand assets and fonts", () => {
    expect(dnesTemplate.templateSha256).toBe(marketingTemplateDigest("dneskai"));
    expect(devTemplate.templateSha256).toBe(marketingTemplateDigest("devshark"));
    expect(() => validateMarketingTemplate(pendingMarketingTemplate("dneskai"), true)).toThrow("claude-design-approval-required");
  });
  it("preserves Czech diacritics and fails on text or code overflow and missing glyphs", () => {
    const text = "Příliš žluťoučký kůň úpěl ďábelské ódy.";
    expect(fitMarketingText({ value: text, faceId: "source-serif-4-400", fontSize: 42, width: 904, maxLines: 4 }).join(" ")).toBe(text);
    expect(() => fitMarketingText({ value: "W".repeat(200), faceId: "space-grotesk-700", fontSize: 62, width: 904, maxLines: 3 })).toThrow("word-overflow");
    expect(() => fitMarketingText({ value: "const ".repeat(200), faceId: "jetbrains-mono-400", fontSize: 30, width: 856, maxLines: 10, code: true })).toThrow("code-line-overflow");
    expect(() => fitMarketingText({ value: "const a\u0301 = 1;", faceId: "jetbrains-mono-400", fontSize: 28, width: 856, maxLines: 10, code: true })).toThrow("unsupported-glyph");
    expect(() => fitMarketingText({ value: "🦈", faceId: "manrope-800", fontSize: 62, width: 904, maxLines: 3 })).toThrow("unsupported-glyph");
  });
  it("renders reproducible 1080x1350 JPEG with original outlined logo and no system font fallback", async () => {
    const template = pendingMarketingTemplate("dneskai");
    const draft = { revision: revision("dneskai"), slides: [{ headline: "Test české sazby", body: "Příliš žluťoučký kůň úpěl ďábelské ódy.", code: null, evidenceIndexes: [0] }, { headline: "Čitelnost", body: "Test českých znaků a řádků.", code: null, evidenceIndexes: [0] }] };
    const a = await renderMarketingPreview({ draft, template, revisionId: input.revisionId });
    const b = await renderMarketingPreview({ draft, template, revisionId: input.revisionId });
    expect(a.map((slide) => slide.sha256)).toEqual(b.map((slide) => slide.sha256));
    expect(a[0].svg).toContain("data:image/svg+xml;base64,");
    expect(a[0].svg).toContain("žluťoučký");
    expect(await sharp(a[0].jpeg).metadata()).toEqual(expect.objectContaining({ format: "jpeg", width: 1080, height: 1350 }));
  }, 60000);
  it("fails closed before storage when production template approval is missing", async () => {
    const put = vi.fn();
    await expect(renderMarketingAssets({ draft: { revision: revision("devshark"), slides: copy.slides }, template: pendingMarketingTemplate("devshark"), revisionId: input.revisionId }, { put })).rejects.toThrow("claude-design-approval-required");
    expect(put).not.toHaveBeenCalled();
  });
});


describe("real authored offline benchmark boundaries", () => {
  it("preserves unavailable eligibility and missing explanation instead of inventing content", () => {
    const results = evaluateMarketingBenchmark([
      { id: "real-devshark-question-unavailable", source: realQuestion, copy, expectedIssueCodes: ["source-unavailable"] },
      { id: "real-devshark-task-without-explanation-held", source: realTask, copy, expectedIssueCodes: ["source-unavailable"] },
    ], now());
    const articleCopy = { ...copy, locale: "cs", slides: copy.slides.map((slide) => ({ ...slide, evidenceIndexes: [0] })) };
    const articleResults = evaluateMarketingBenchmark([{ id: "real-dneskai-held-article", source: realArticle, copy: articleCopy, expectedIssueCodes: ["source-unavailable"] }], now());
    expect(articleResults[0].passed).toBe(true);
    expect(realArticle.eligible).toBe(false);
    expect(results.map((result) => result.passed)).toEqual([true, true]);
    expect(JSON.stringify(results)).not.toContain(realQuestion.content.body);
    expect(realQuestion.eligible).toBe(false);
    expect(realTask.eligible).toBe(false);
  });
});


describe("real authored review preview", () => {
  it("renders the held public coding challenge read-only with exact starter code and no invented answer", async () => {
    const source = parseSourcePacket(realTask); const challenge = authoredCodingChallenge(source);
    const draft = { revision: { ...revision("devshark"), title: challenge.title, caption: challenge.caption, sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }] }, slides: challenge.slides };
    const previews = await renderMarketingPreview({ draft, template: pendingMarketingTemplate("devshark"), revisionId: input.revisionId });
    expect(previews).toHaveLength(challenge.slides.length);
    expect(challenge.slides.find(slide => slide.code)?.code).toBe(realTask.content.code);
    expect(previews.map(slide => slide.svg).join("\n")).toContain("digitSum");
    expect(challenge.slides.some(slide => slide.headline === "Authored explanation")).toBe(false);
    expect(source.eligible).toBe(false); expect(realTask.eligible).toBe(false);
    if (process.env.MARKETING_QA_PREVIEW_DIR) {
      await mkdir(process.env.MARKETING_QA_PREVIEW_DIR, { recursive: true });
      await Promise.all(previews.map((preview, i) => writeFile(path.join(process.env.MARKETING_QA_PREVIEW_DIR!, `devshark-coding-held-${i + 1}.jpg`), preview.jpeg)));
    }
  }, 60000);
  it("renders a held source for local QA without changing source eligibility", async () => {
    const source = parseSourcePacket(realQuestion);
    const slides = [
      { headline: source.content.title, body: authoredMarketingText(source.content.body, source.content.code), code: null, evidenceIndexes: [] },
      { headline: "Code", body: source.content.category, code: source.content.code, evidenceIndexes: [] },
      { headline: "Choose an answer", body: source.content.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join("\n"), code: null, evidenceIndexes: [] },
      { headline: "Authored explanation", body: authoredMarketingText([source.content.answer, source.content.explanation].filter(Boolean).join("\n\n"), source.content.code), code: null, evidenceIndexes: [] },
    ];
    const draft = { revision: { ...revision("devshark"), sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }] }, slides };
    const previews = await renderMarketingPreview({ draft, template: pendingMarketingTemplate("devshark"), revisionId: input.revisionId });
    expect(previews).toHaveLength(4);
    expect(previews[0].svg).not.toContain("```js");
    expect(previews[0].svg).toContain('fill="#F3F6F1"');
    expect(previews[1].svg).toContain('fill="#0B141B"');
    expect(previews[2].svg).toContain('fill="#2D7A2D"');
    expect(previews[0].svg).toContain('id="waterline"');
    expect(previews[0].svg).not.toContain('width="400" height="64"');
    expect(previews[3].svg).toContain('width="400" height="64"');
    expect(source.eligible).toBe(false);
    if (process.env.MARKETING_QA_PREVIEW_DIR) {
      await mkdir(process.env.MARKETING_QA_PREVIEW_DIR, { recursive: true });
      await Promise.all(previews.map((preview, i) => writeFile(path.join(process.env.MARKETING_QA_PREVIEW_DIR!, `devshark-${i + 1}.jpg`), preview.jpeg)));
    }
  }, 60000);
});


describe("DNESKAi Design R2 social adaptation preview", () => {
  it("renders real held authored article excerpts with lead/secondary font roles", async () => {
    const source = parseSourcePacket(realArticle);
    const paragraphs = source.content.body.split("\n\n");
    const draft = { revision: { ...revision("dneskai"), sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }] }, slides: [
      { headline: source.content.title, body: authoredMarketingText(paragraphs[0], null), code: null, evidenceIndexes: [0] },
      { headline: "Souvislosti článku", body: authoredMarketingText(paragraphs[1].split(/(?<=[.!?])\s+/)[0], null), code: null, evidenceIndexes: [0] },
    ] };
    const previews = await renderMarketingPreview({ draft, template: pendingMarketingTemplate("dneskai"), revisionId: input.revisionId });
    expect(previews[0].svg).toContain('font-family="Space Grotesk"');
    expect(previews[1].svg).toContain('font-family="Source Serif 4"');
    expect(source.eligible).toBe(false);
    if (process.env.MARKETING_QA_PREVIEW_DIR) await Promise.all(previews.map((preview, i) => writeFile(path.join(process.env.MARKETING_QA_PREVIEW_DIR!, `dneskai-held-${i + 1}.jpg`), preview.jpeg)));
  }, 60000);
});
