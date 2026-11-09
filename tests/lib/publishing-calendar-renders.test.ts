import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const plan = vi.hoisted(() => ({ slots: [] as unknown[] }));
vi.mock("@/lib/marketing/dneskai-plan-read", () => ({ readDneskaiPlan: async () => ({ slots: plan.slots }) }));

import { readPublishingCalendar } from "@/lib/publishing-calendar-read";
import { dneskaiLabPost, dneskaiLabSlides } from "@/lib/marketing/dneskai-lab";
import { devsharkStudioRenderRequest, dneskaiStoryPreviewRequest } from "@/lib/marketing/design-lab-renders";
import { devsharkCalendarRenders, dneskaiCalendarRenders } from "@/lib/publishing-calendar-renders";
import { createDneskaiWorkspaceFixture } from "@/lib/demo/dneskai-workspace-fixtures";
import { demoDevsharkStudio } from "@/lib/demo/devshark-studio-demo";
import type { PublishingCalendar } from "@/lib/publishing-calendar";
import { devsharkStudioSlideSvg } from "@/lib/design-studio/devshark-studio-slide";
import { layoutDevsharkSlide } from "@/lib/design-studio/devshark-layout";
import { STUDIO_BROWSER_ASSETS } from "@/components/design-studio/slide-canvas";

/**
 * Owner request, 9 November 2026: the publishing calendar shows exactly what the Design Lab shows, the same picture
 * source of the same revision, for DNESKAi covers, slides and stories and devShark posts and stories.
 */
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const jpeg = (name: string) => ({ url: `https://cdn.example.com/${name}.jpg`, sha256: "a".repeat(64), mimeType: "image/jpeg", width: 1080, height: 1350, alt: `alt ${name}` });
const dneskaiDeck = (count: number) => ({ kit: "spotlight", slides: Array.from({ length: count }, (_, index) => ({ type: index ? "statement" : "cover-photo", headline: `[[Slide]] ${index + 1}`, images: [] })) });

type Row = Record<string, unknown>;
/** The Supabase query operators used by the calendar, over in-memory rows. */
function fakeDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] === value); return builder; },
        neq: (key: string, value: unknown) => { rows = rows.filter((row) => row[key] !== value); return builder; },
        in: (key: string, values: unknown[]) => { rows = rows.filter((row) => values.includes(row[key])); return builder; },
        gte: (key: string, value: string) => { rows = rows.filter((row) => String(row[key]) >= value); return builder; },
        lte: (key: string, value: string) => { rows = rows.filter((row) => String(row[key]) <= value); return builder; },
        order: (key: string, options?: { ascending?: boolean }) => { rows.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (options?.ascending === false ? -1 : 1)); return builder; },
        limit: () => builder,
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  };
}

describe("calendar previews are the Design Lab's previews", () => {
  it("DNESKAi: the calendar adapter and the Lab resolve the same cover, slides and story for each fixture revision", () => {
    const now = new Date("2026-11-09T07:00:00.000Z");
    const read = createDneskaiWorkspaceFixture(now);
    for (const post of read.posts.filter((item) => item.deck)) {
      const lab = dneskaiLabPost(post, read, now.getTime());
      const calendar = dneskaiCalendarRenders(post, post.title);
      const labUrls = lab.slides.map((slide) => slide.render?.url ?? null);
      expect(calendar.slides.map((slide) => slide.url)).toEqual(labUrls.every(Boolean) ? labUrls : []);
      expect(calendar.thumbnail?.url ?? null).toBe(labUrls.every(Boolean) ? labUrls[0] : null);
      // The Lab draws an unedited post's story with dneskaiStoryPreviewRequest(post); the calendar sends that request.
      expect(calendar.story).toEqual({ pictures: [], live: { kind: "dneskai-story", request: dneskaiStoryPreviewRequest(post) } });
    }
  });

  it("devShark: before the plan stores JPEGs the calendar draws the Studio's own slides; after, it shows the stored post and story", async () => {
    const concept = (await demoDevsharkStudio.load()).drafts[0]!;
    const drawn = devsharkCalendarRenders(concept, { post: [], threads: [], story: [] });
    expect(drawn.live).toEqual({ kind: "devshark-deck", ...devsharkStudioRenderRequest(concept) });
    // The calendar draws each slide with devsharkStudioSlideSvg; the Studio's canvas draws the same SVG.
    const deck = drawn.live!.kind === "devshark-deck" ? drawn.live!.deck : null;
    concept.deck.slides.forEach((_, index) => expect(devsharkStudioSlideSvg(deck!, index)).toBe(layoutDevsharkSlide(concept.deck, index, STUDIO_BROWSER_ASSETS).svg));
    expect(drawn.slides).toEqual([]);
    expect(drawn.story).toEqual([]);
    const stored = devsharkCalendarRenders(concept, { post: [jpeg("d1"), jpeg("d2")], threads: [], story: [{ ...jpeg("ds"), width: 1080, height: 1920 }] });
    expect(stored.live).toBeNull();
    expect(stored.slides.map((item) => item.url)).toEqual([jpeg("d1").url, jpeg("d2").url]);
    expect(stored.threads.map((item) => item.url)).toEqual([jpeg("d1").url, jpeg("d2").url]);
    expect(stored.story.map((item) => item.url)).toEqual([jpeg("ds").url]);
  });

  it("the server read follows a Lab edit to its newest version and never shows a partial, older or 4:5 story render", async () => {
    const now = new Date("2026-11-09T07:00:00.000Z");
    const [old, edited, newest, partial] = [uuid(11), uuid(12), uuid(13), uuid(14)];
    const revision = (id: string, replaces: string | null, created: string, deck: ReturnType<typeof dneskaiDeck>, assets: ReturnType<typeof jpeg>[]) =>
      ({ id, user_id: OWNER, replaces_id: replaces, created_at: created, revision: { title: "Post", caption: `Caption ${id}`, deck, assets } });
    const tables: Record<string, Row[]> = {
      marketing_publishing_switches: [],
      marketing_publications: [
        { user_id: OWNER, revision_id: uuid(31), platform: "instagram", status: "published" },
        { user_id: OWNER, revision_id: uuid(31), platform: "threads", status: "failed" },
        { user_id: OWNER, revision_id: uuid(32), platform: "instagram", status: "failed" },
      ],
      marketing_revisions: [
        revision(old, null, "2026-11-08T10:00:00Z", dneskaiDeck(3), [jpeg("old-1"), jpeg("old-2"), jpeg("old-3")]),
        revision(edited, old, "2026-11-08T11:00:00Z", dneskaiDeck(3), [jpeg("mid-1"), jpeg("mid-2"), jpeg("mid-3")]),
        revision(newest, edited, "2026-11-08T12:00:00Z", dneskaiDeck(2), [jpeg("new-1"), jpeg("new-2")]),
        revision(partial, null, "2026-11-08T12:00:00Z", dneskaiDeck(3), [jpeg("part-1")]),
        { id: uuid(31), user_id: OWNER, replaces_id: null, created_at: "2026-11-08T12:00:00Z", revision: { assets: [jpeg("ds-1"), jpeg("ds-2")] } },
        { id: uuid(32), user_id: OWNER, replaces_id: null, created_at: "2026-11-08T12:00:00Z", revision: { assets: [{ ...jpeg("ds-story"), width: 1080, height: 1920 }] } },
      ],
      marketing_devshark_plan: [{ id: uuid(41), user_id: OWNER, date: "2026-11-09", local_time: "16:00", instagram: true, threads: false, status: "approved", draft_id: uuid(51),
        instagram_revision_id: uuid(31), threads_revision_id: null, story_revision_id: uuid(32) }],
      marketing_devshark_drafts: [{ id: uuid(51), user_id: OWNER, title: "typeof null", caption: "Guess", deck: (await demoDevsharkStudio.load()).drafts[0]!.deck }],
    };
    const slot = (id: string, labPostId: string) => ({ id, date: "2026-11-09", time: "08:00", scheduledAt: "2026-11-09T07:00:00.000Z", title: "Post", status: "ready", labPostId,
      instagram: { publicationStatus: null, caption: "plan caption" }, threads: null, story: null });
    plan.slots = [slot(uuid(21), old), slot(uuid(22), partial)];
    const calendar: PublishingCalendar = await readPublishingCalendar(fakeDb(tables) as never, OWNER, now);

    const followed = calendar.posts.find((post) => post.slotId === uuid(21))!;
    const newestRevision = tables.marketing_revisions!.find((row) => row.id === newest)!.revision as { deck: ReturnType<typeof dneskaiDeck>; assets: ReturnType<typeof jpeg>[] };
    const labSlides = dneskaiLabSlides({ deck: newestRevision.deck as never, assets: newestRevision.assets, fields: [], renderReport: null }).map((slide) => slide.render?.url);
    const instagram = followed.versions.find((version) => version.channel === "instagram")!;
    expect(followed.target).toEqual({ kind: "dneskai-lab", postId: newest });
    expect(instagram.pictures.map((picture) => picture.url)).toEqual(labSlides);
    expect(followed.thumbnail?.url).toBe(labSlides[0]);
    expect(instagram.caption).toBe(`Caption ${newest}`);
    const story = followed.versions.find((version) => version.channel === "story")!;
    expect(story.pictures).toEqual([]);
    expect(story.live).toEqual({ kind: "dneskai-story", request: dneskaiStoryPreviewRequest({ id: newest, deck: newestRevision.deck }) });

    const incomplete = calendar.posts.find((post) => post.slotId === uuid(22))!;
    expect(incomplete.thumbnail).toBeNull();
    expect(incomplete.versions.find((version) => version.channel === "instagram")!.pictures).toEqual([]);

    const devshark = calendar.posts.find((post) => post.brand === "devshark")!;
    expect(devshark.versions.map(({ channel, status }) => ({ channel, status }))).toEqual([
      { channel: "story", status: "failed" }, { channel: "instagram", status: "published" },
    ]);
    expect(devshark.versions.find((version) => version.channel === "instagram")!.pictures.map((picture) => picture.url)).toEqual([jpeg("ds-1").url, jpeg("ds-2").url]);
    expect(devshark.versions.find((version) => version.channel === "story")!.pictures.map((picture) => picture.url)).toEqual([jpeg("ds-story").url]);
  });
});
