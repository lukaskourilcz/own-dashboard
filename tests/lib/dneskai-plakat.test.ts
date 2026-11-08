import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { dneskaiMarkedWords, dneskaiPlainText } from "@/lib/carousel-studio/dneskai-slide";
import { dneskaiClosingBytes } from "@/lib/marketing/dneskai-render";
import { DNESKAI_CLOSING_SHA256, dneskaiClosingSlide, isDneskaiClosingSlide } from "@/lib/marketing/dneskai-closing";
import { createHash } from "node:crypto";

describe("key-word marks (Plakát, 8 November 2026)", () => {
  it("strips the marks and flags the marked words in order", () => {
    expect(dneskaiMarkedWords("Alexa umí [[100+]] nových [[nákupních funkcí]]")).toEqual({ plain: "Alexa umí 100+ nových nákupních funkcí", flags: [false, false, true, false, true, true] });
    expect(dneskaiMarkedWords("Bez značek")).toEqual({ plain: "Bez značek", flags: null });
    expect(dneskaiMarkedWords("[[OpenAI]], Anthropic")).toEqual({ plain: "OpenAI, Anthropic", flags: [true, false] });
    expect(dneskaiPlainText("Sleduj [[DNESKAi]]")).toBe("Sleduj DNESKAi");
  });

  it("colours only the marked words in Plakát and draws plain words in kits without an emphasis colour", async () => {
    const studio = await import("@/lib/carousel-studio");
    const input = (await studio.dneskaiGoldenCases()).find((entry) => entry.name === "cover-photo")!.input;
    const marked = { ...input, headline: "Alexa umí [[100+]] nových nákupních funkcí" };
    const plakat = await studio.renderDneskaiSlide({ ...marked, kit: "plakat" });
    expect(plakat.status).toBe("rendered");
    expect(plakat.payload?.strings.headline).toBe("Alexa umí 100+ nových nákupních funkcí");
    expect(plakat.payload?.emphasis).toEqual({ headline: [false, false, true, false, false, false] });
    const spotlight = await studio.renderDneskaiSlide({ ...marked, kit: "spotlight" });
    const plain = await studio.renderDneskaiSlide({ ...input, headline: "Alexa umí 100+ nových nákupních funkcí", kit: "spotlight" });
    expect(spotlight.payload?.emphasis).toBeUndefined();
    expect(spotlight.pngHash).toBe(plain.pngHash);
  }, 60000);

  it("draws the key words in the post's own colour (owner request, 8 November 2026)", async () => {
    const studio = await import("@/lib/carousel-studio");
    const input = (await studio.dneskaiGoldenCases()).find((entry) => entry.name === "cover-photo")!.input;
    const marked = { ...input, headline: "Alexa umí [[100+]] nových nákupních funkcí", kit: "plakat" as const };
    const own = await studio.renderDneskaiSlide(marked);
    const pink = await studio.renderDneskaiSlide({ ...marked, emphasisColor: "#f472b6" });
    const lime = await studio.renderDneskaiSlide({ ...marked, emphasisColor: "#a3e635" });
    expect([own.status, pink.status, lime.status]).toEqual(["rendered", "rendered", "rendered"]);
    expect(new Set([own.pngHash, pink.pngHash, lime.pngHash]).size).toBe(3);
    // The look's own light blue as an explicit colour draws the same picture.
    expect((await studio.renderDneskaiSlide({ ...marked, emphasisColor: "#7c95ff" })).pngHash).toBe(own.pngHash);
    // Words without a mark do not change colour.
    const plain = { ...marked, headline: "Alexa umí 100+ nových nákupních funkcí" };
    expect((await studio.renderDneskaiSlide({ ...plain, emphasisColor: "#f472b6" })).pngHash).toBe((await studio.renderDneskaiSlide(plain)).pngHash);
  }, 120000);
});

describe("the closing slide (8 November 2026)", () => {
  it("is a figure with the pinned Higgsfield picture and the follow line", async () => {
    const slide = dneskaiClosingSlide();
    expect(slide).toMatchObject({ type: "figure", headline: "Sleduj [[DNESKAi]]", body: "pro všechny novinky ze světa AI a technologií. @dneskai" });
    expect(isDneskaiClosingSlide(slide)).toBe(true);
    const bytes = await dneskaiClosingBytes();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(DNESKAI_CLOSING_SHA256);
  });
});
