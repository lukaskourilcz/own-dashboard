import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DNESKAI_AI_DISCLOSURE, DNESKAI_BRIEF_SYSTEM_PROMPT, DneskaiCopySchema, DneskaiEducationCopySchema, assembleDneskaiCaption, dneskaiBriefOffer, dneskaiKeywordLine, validateDneskaiReplyMessage,
} from "@/lib/marketing/dneskai-generation";
import { generateMarketingDraft, type GenerationDependencies, type MarketingModel } from "@/lib/marketing/generation";
import { DNESKAI_DEFAULT_PUBLIC_REPLY } from "@/lib/marketing/dneskai-engagement";
import { dneskaiCaptionHashtags, DNESKAI_CAPTION_HASHTAG_MAX } from "@/lib/marketing/dneskai-deck-editor";
import type { DneskaiSlideRenderProblem } from "@/lib/marketing/dneskai-render";
import { dneskaiEvidencePublishers } from "@/lib/marketing/dneskai-publishers";
import { BRIEF_NOW, briefFixture, briefInput, briefPacket, briefPictures, validCopy, type BriefPictures } from "./marketing-dneskai-generation-fixture";

vi.mock("server-only", () => ({}));

let pictures: BriefPictures;
let publishers: string[];
beforeAll(async () => {
  pictures = await briefPictures();
  publishers = await dneskaiEvidencePublishers(briefFixture(pictures).evidence);
});
beforeEach(() => { vi.clearAllMocks(); });
const LINK = "https://www.theverge.com/test-only/lightroom-open-eyes";
/** A DM a careful model could write for the Lightroom fixture: every number from the evidence, one evidence link. */
const REPLY = [
  "Open Eyes je rychlá akce v mobilním Lightroomu od Adobe. Když aplikace na fotce najde zavřené oči, nabídne jejich úpravu jedním klepnutím.",
  "Jak začít:\n1. Otevřete Lightroom na iOS nebo Androidu.\n2. Vyberte portrét, na kterém má někdo zavřené oči.\n3. V rychlých akcích klepněte na Open Eyes a výsledek porovnejte s originálem.",
  "Cena: zdarma jsou 2 použití, potom je potřeba předplatné Creative Cloud s kredity na AI nástroje.",
  "Pozor: Adobe neuvedlo, jak funkce zvládá skupinové fotky.",
  `Víc najdete tady: ${LINK}`,
].join("\n\n");
const loadMedia = vi.fn(async (sha256: string) => Object.values(pictures).find((entry) => entry.sha256 === sha256)!.bytes);
const clean = vi.fn(async (): Promise<DneskaiSlideRenderProblem[]> => []);
function fakeModel(answers: unknown[]) {
  const invoke = vi.fn(async (input: Parameters<MarketingModel["invoke"]>[0]) => { void input; return { copy: answers.shift() ?? null, usage: { inputTokens: 3000, outputTokens: 1500 } }; });
  return { model: "claude-sonnet-5-5", pricing: { inputPerMillionUsd: 2, outputPerMillionUsd: 10 }, invoke } satisfies MarketingModel;
}
const dependencies = (model: MarketingModel): GenerationDependencies => ({ model, now: () => BRIEF_NOW, loadDneskaiMedia: loadMedia, validateDneskaiDeck: clean, evidencePublishers: dneskaiEvidencePublishers, admitPaidCall: async () => {} });

describe("the education DM (#158)", () => {
  it("accepts a factual DM with numbered steps and one evidence link", () => {
    expect(REPLY.length).toBeGreaterThanOrEqual(400);
    expect(validateDneskaiReplyMessage(REPLY, dneskaiBriefOffer(briefFixture(pictures), publishers))).toEqual([]);
  });
  it("refuses a DM outside 400 to 900 characters, a foreign or second URL, invented numbers, source talk, emoji, hashtags and a keyword call", () => {
    const offer = dneskaiBriefOffer(briefFixture(pictures), publishers);
    const codes = (value: string) => validateDneskaiReplyMessage(value, offer).map((entry) => entry.code);
    expect(codes("Krátká zpráva.")).toEqual(["reply-message-length"]);
    expect(codes(`${REPLY}\n\n${"Další věta o Lightroomu. ".repeat(30)}`)).toEqual(["reply-message-length"]);
    expect(codes(REPLY.replace(LINK, "https://example.com/navod"))).toEqual(["reply-message-url-unknown"]);
    expect(codes(`${REPLY} ${LINK}`)).toEqual(["reply-message-urls"]);
    expect(codes(REPLY.replace("2 použití", "5 použití"))).toEqual(["unsupported-number"]);
    expect(codes(REPLY.replace("Pozor:", "Podle dostupných zdrojů:"))).toEqual(["source-talk"]);
    expect(codes(REPLY.replace("Pozor:", "Pozor 🚀:"))).toEqual(["unsafe-text"]);
    expect(codes(REPLY.replace("Pozor:", "#lightroom Pozor:"))).toEqual(["caption-hashtag"]);
    expect(codes(REPLY.replace("Pozor:", "Napište do komentáře ANO. Pozor:"))).toEqual(["reply-message-cta"]);
  });
  it("asks the model for nothing new on a news brief: the system prompt keeps the comment ban and the news schema has no DM", () => {
    expect(DNESKAI_BRIEF_SYSTEM_PROMPT).toContain("no call to follow or comment");
    expect(DNESKAI_BRIEF_SYSTEM_PROMPT).not.toContain("replyMessage");
    expect(DneskaiCopySchema.safeParse({ ...validCopy(pictures), replyMessage: REPLY }).success).toBe(false);
    expect(DneskaiEducationCopySchema.safeParse({ ...validCopy(pictures), replyMessage: REPLY }).success).toBe(true);
  });
});

describe("the code-written keyword line (#158)", () => {
  it("appends the exact line before the disclosure only with a keyword, and never as a hashtag", () => {
    const offer = dneskaiBriefOffer(briefFixture(pictures), publishers);
    expect(dneskaiKeywordLine("SKILL")).toBe("Napište do komentáře „SKILL“ a pošleme vám návod do zpráv.");
    const plain = assembleDneskaiCaption(validCopy(pictures), offer);
    const keyed = assembleDneskaiCaption(validCopy(pictures), offer, "LIGHTROOM");
    if (!("caption" in plain) || !("caption" in keyed)) throw new Error("caption expected");
    expect(plain.caption).not.toContain("Napište do komentáře");
    const paragraphs = keyed.caption.split("\n\n");
    expect(paragraphs.at(-3)).toBe(dneskaiKeywordLine("LIGHTROOM"));
    expect(paragraphs.at(-2)).toBe(DNESKAI_AI_DISCLOSURE);
    expect(dneskaiCaptionHashtags(keyed.caption)).toBe(dneskaiCaptionHashtags(plain.caption));
    // Ten hashtags pass with the keyword line; the generation schema refuses eleven proposals.
    const ten = assembleDneskaiCaption({ ...validCopy(pictures), hashtags: Array.from({ length: 9 }, (_, index) => `tema${index}`) }, offer, "LIGHTROOM");
    expect("caption" in ten && dneskaiCaptionHashtags(ten.caption)).toBe(DNESKAI_CAPTION_HASHTAG_MAX);
    expect(DneskaiCopySchema.safeParse({ ...validCopy(pictures), hashtags: Array.from({ length: 11 }, (_, index) => `tema${index}`) }).success).toBe(false);
  });
});

describe("generating an education post (#158)", () => {
  it("asks for the DM with the evidence links, and drafts the keyword, the DM and the default public reply with the caption line", async () => {
    const model = fakeModel([{ ...validCopy(pictures), replyMessage: REPLY }]);
    const draft = await generateMarketingDraft({ ...briefInput(briefPacket(briefFixture(pictures))), education: { keyword: "LIGHTROOM" } }, dependencies(model));
    const call = model.invoke.mock.calls[0]![0];
    expect(JSON.stringify(call.output?.schema)).toContain("replyMessage");
    expect(JSON.parse(call.prompt).education.links).toContain(LINK);
    expect(call.prompt).not.toContain("LIGHTROOM");
    expect(draft.revision.engagement).toEqual({ keyword: "LIGHTROOM", replyMessage: REPLY, publicReply: DNESKAI_DEFAULT_PUBLIC_REPLY });
    expect(draft.revision.caption).toContain(`\n\n${dneskaiKeywordLine("LIGHTROOM")}\n\n${DNESKAI_AI_DISCLOSURE}\n\n`);
  });
  it("retries a DM that breaks the truth rules, naming only the field", async () => {
    const model = fakeModel([{ ...validCopy(pictures), replyMessage: REPLY.replace("2 použití", "7 použití") }, { ...validCopy(pictures), replyMessage: REPLY }]);
    const draft = await generateMarketingDraft({ ...briefInput(briefPacket(briefFixture(pictures))), education: { keyword: "LIGHTROOM" } }, dependencies(model));
    expect(model.invoke).toHaveBeenCalledTimes(2);
    expect(model.invoke.mock.calls[1]![0].prompt).toContain("replyMessage");
    expect(draft.revision.engagement?.replyMessage).toBe(REPLY);
  });
  it("asks a news brief for no DM and writes no keyword line", async () => {
    const model = fakeModel([validCopy(pictures)]);
    const draft = await generateMarketingDraft(briefInput(briefPacket(briefFixture(pictures))), dependencies(model));
    const call = model.invoke.mock.calls[0]![0];
    expect(JSON.stringify(call.output?.schema)).not.toContain("replyMessage");
    expect(JSON.parse(call.prompt)).not.toHaveProperty("education");
    expect(call.prompt).not.toContain("https://");
    expect(draft.revision).not.toHaveProperty("engagement");
    expect(draft.revision.caption).not.toContain("Napište do komentáře");
  });
  it("keeps the owner's engagement on a regeneration, asks for no new DM and writes the line for the owner's keyword", async () => {
    const engagement = { keyword: "OCI", replyMessage: "Vlastní text majitele.", publicReply: "Je to ve zprávách." };
    const model = fakeModel([validCopy(pictures)]);
    const draft = await generateMarketingDraft({ ...briefInput(briefPacket(briefFixture(pictures))), education: { keyword: "LIGHTROOM" }, engagement }, dependencies(model));
    expect(JSON.stringify(model.invoke.mock.calls[0]![0].output?.schema)).not.toContain("replyMessage");
    expect(draft.revision.engagement).toEqual(engagement);
    expect(draft.revision.caption).toContain(dneskaiKeywordLine("OCI"));
  });
});
