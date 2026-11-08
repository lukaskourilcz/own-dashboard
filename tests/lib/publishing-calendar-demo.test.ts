import { beforeEach, describe, expect, it } from "vitest";
import { previewPublishingCalendar, previewPublishingSwitch } from "@/lib/demo/publishing-calendar-demo";
import { demoDevsharkStudio, resetDemoDevsharkStudio } from "@/lib/demo/devshark-studio-demo";
import { PublishingCalendarSchema, coverHeadline } from "@/lib/publishing-calendar";

/** The /dev-preview calendar reads the same in-memory samples the Design Lab edits (8 November 2026). */
describe("preview publishing calendar", () => {
  beforeEach(() => resetDemoDevsharkStudio());

  it("shows both brands, one card per post, with their cover headlines", async () => {
    const calendar = await previewPublishingCalendar(new Date("2026-11-08T07:00:00.000Z"));
    expect(new Set(calendar.posts.map((post) => post.brand))).toEqual(new Set(["dneskai", "devshark"]));
    const devshark = calendar.posts.find((post) => post.brand === "devshark")!;
    expect(devshark.headline).toBe("typeof null");
    expect(devshark.versions.map((version) => version.channel)).toEqual(["story", "instagram", "threads"]);
    expect(calendar.posts.filter((post) => post.brand === "dneskai").every((post) => post.target?.kind === "dneskai-lab" && post.headline)).toBe(true);
    expect(calendar.days).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);
  });

  it("shows a headline saved in the devShark Design Lab and keeps a switch across reads", async () => {
    const draft = (await demoDevsharkStudio.load()).drafts[0]!;
    await demoDevsharkStudio.save({ id: draft.id, title: draft.title, caption: draft.caption, deck: { ...draft.deck, slides: draft.deck.slides.map((slide, index) => index === 0 ? { ...slide, headline: "typeof [[null]], edited" } : slide) } });
    const before = await previewPublishingCalendar();
    const post = before.posts.find((item) => item.brand === "devshark")!;
    expect(post.headline).toBe("typeof null, edited");
    await previewPublishingSwitch({ brand: "devshark", slotId: post.slotId, channel: "threads", off: true });
    const after = (await previewPublishingCalendar()).posts.find((item) => item.slotId === post.slotId)!;
    expect(after.versions.find((version) => version.channel === "threads")!.off).toBe(true);
    await previewPublishingSwitch({ brand: "devshark", slotId: post.slotId, channel: "threads", off: false });
  });

  it("strips key-word marks from a cover headline", () => {
    expect(coverHeadline({ slides: [{ headline: "AI [[nečte]] tabulky" }] })).toBe("AI nečte tabulky");
    expect(coverHeadline({ slides: [] })).toBeNull();
    expect(coverHeadline(null)).toBeNull();
    expect(PublishingCalendarSchema.shape.posts.element.shape.headline.safeParse(null).success).toBe(true);
  });
});
