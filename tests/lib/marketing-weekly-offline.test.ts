import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSourcePacket, type SourcePacket } from "@/lib/marketing/contracts";
import { contentHash } from "@/lib/marketing/hashes";
import { authoredMarketingText } from "@/lib/marketing/generation";
import { buildWeeklyOffline, parseWeeklyOptions, prepareWeeklyPackets, weeklyDates, weeklySlides, weeklyThreads } from "../../scripts/marketing-weekly-offline.mjs";

vi.mock("server-only", () => ({}));
const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const consumer = { parseSourcePacket, contentHash };
function fixture(index = 0, overrides: Partial<SourcePacket> = {}): SourcePacket {
  const content: SourcePacket["content"] = { title: "OFFLINE QA: what is the result?", body: "OFFLINE QA fixture only.\n\nWhat is the result?\n\n```js\n1 + 1;\n```", category: "javascript", difficulty: "1", code: "1 + 1;\n", options: ["1", "2", "3", "4"], answer: "2", explanation: "Adding one and one gives two.", evidence: [], image: null };
  return { schemaVersion: "marketing-source/1", brand: "devshark", kind: "question", sourceId: `question:offline-qa-${index}`, sourceRevision: "a".repeat(64), contentHash: contentHash(content), canonicalUrl: "https://devshark.app/quiz?categories=javascript", locale: "en", observedAt: "2026-10-13T12:00:00.000Z", expiresAt: null, eligible: true, eligibilityReason: "OFFLINE QA ONLY: no live eligibility proof", content, ...overrides };
}
const week = () => Array.from({ length: 7 }, (_, i) => fixture(i));
function changedContent(patch: Partial<SourcePacket["content"]>) {
  const source = fixture(); source.content = { ...source.content, ...patch }; source.contentHash = contentHash(source.content); return source;
}

describe("private offline weekly preparation boundaries", () => {
  it("requires one real Sunday and advances seven dates across the year boundary", () => {
    expect(weeklyDates("2026-12-27")).toEqual(["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(() => weeklyDates("2026-10-19")).toThrow("Sunday");
    expect(() => weeklyDates("2026-02-30")).toThrow("Sunday");
    expect(() => parseWeeklyOptions(["--input", "a", "--input", "b"])).toThrow("duplicate");
  });
  it("rejects missing, duplicated, held, expired and altered packets without making authority claims", () => {
    expect(() => prepareWeeklyPackets(week().slice(0, 6), consumer)).toThrow("seven");
    expect(() => prepareWeeklyPackets([...week().slice(0, 6), fixture(0)], consumer)).toThrow("distinct");
    expect(() => prepareWeeklyPackets([fixture(0, { eligible: false }), ...week().slice(1)], consumer)).toThrow("eligible");
    expect(() => prepareWeeklyPackets([fixture(0, { expiresAt: "2026-10-12T12:00:00.000Z" }), ...week().slice(1)], consumer, new Date("2026-10-13T12:00:00Z"))).toThrow("expired");
    expect(() => prepareWeeklyPackets([fixture(0, { contentHash: "f".repeat(64) }), ...week().slice(1)], consumer)).toThrow("hash-mismatch");
    expect(() => prepareWeeklyPackets([fixture(0, { canonicalUrl: "https://devshark.app/daily/2026-10-18" }), ...week().slice(1)], consumer)).toThrow("evergreen");
  });
  it("preserves exact authored question/code/options/explanation while deriving the correct letter", () => {
    const source = fixture(); const thread = weeklyThreads(source);
    expect(thread.question).toContain(source.content.body);
    expect(thread.question).toContain("A. 1\nB. 2\nC. 3\nD. 4");
    expect(thread.answer).toBe(`Answer: B.\n\n${source.content.explanation}`);
    const slides = weeklySlides(source, authoredMarketingText);
    expect(slides[0].code).toBe(source.content.code);
    expect(slides[2].body).toBe(source.content.explanation);
    expect(source).toEqual(fixture());
    expect(() => weeklyThreads(changedContent({ options: ["2", "2"] }))).toThrow("ambiguous");
  });
  it("holds full explanations that exceed either Unicode codepoints or UTF-8 bytes", () => {
    expect(() => weeklyThreads(changedContent({ explanation: "x".repeat(501) }))).toThrow("answer-overflow");
    const unicode = changedContent({ explanation: "😀".repeat(200) });
    expect([...`Answer: B.\n\n${unicode.content.explanation}`].length).toBeLessThan(500);
    expect(() => weeklyThreads(unicode)).toThrow("answer-overflow");
  });
  it("renders all 42 QA drafts with the actual renderer, hashes exact bytes, and cannot overwrite output", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "marketing-weekly-offline-test-")); scratch.push(dir);
    const input = path.join(dir, "packets.json"); const output = path.join(dir, "drafts"); writeFileSync(input, JSON.stringify(week()));
    const fetchBefore = globalThis.fetch;
    const result = await buildWeeklyOffline({ input, "week-start": "2026-10-18", output });
    expect(globalThis.fetch).toBe(fetchBefore);
    expect(result).toMatchObject({ sourceItems: 7, instagramPosts: 7, instagramJpegs: 28, threadsPosts: 14, storyJpegs: 21, logicalDeliverables: 42, modelCalls: 0, status: "draft", published: false });
    const manifest = JSON.parse(readFileSync(path.join(output, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ sourceApproval: false, readyRevisionPersisted: false, published: false, providerCalls: 0, storageCalls: 0, requiresFreshSourceRecheck: true, stories: { templateApproved: false } });
    expect(manifest.sourceAuthority).toContain("no live DB");
    for (const day of manifest.days) {
      for (const asset of [...day.instagram.slides, ...day.stories]) {
        const bytes = readFileSync(path.join(output, asset.file));
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
        const metadata = await sharp(bytes).metadata(); expect(metadata).toMatchObject({ format: "jpeg", width: asset.width, height: asset.height });
      }
      for (const text of day.threads) {
        const value = readFileSync(path.join(output, text.file), "utf8");
        expect([...value].length).toBe(text.codepoints); expect(Buffer.byteLength(value)).toBe(text.utf8Bytes);
        expect(text.codepoints).toBeLessThanOrEqual(500); expect(text.utf8Bytes).toBeLessThanOrEqual(500);
        expect(text.format).toBe("thread");
      }
    }
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(output, "manifest.json")).mode & 0o777).toBe(0o600);
    expect(existsSync(path.join(output, "index.html"))).toBe(true);
    await expect(buildWeeklyOffline({ input, "week-start": "2026-10-18", output })).rejects.toThrow("new-directory");
  }, 30000);
});
