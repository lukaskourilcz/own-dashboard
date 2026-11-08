import { describe, expect, it } from "vitest";
import { PREVIEW_PUBLISHING } from "@/components/panels/publishing-calendar-panel";
import { PREVIEW_BACKLOG } from "@/components/panels/backlog-panel";
import { PublishingCalendarSchema, networkOfChannel, orderedVersions, publishingDays, publishingNetworkCounts, publishingTargetHref, PUBLISHING_CONNECTED } from "@/lib/publishing-calendar";
import { backlogProjectCounts, backlogRefHref, filterBacklog } from "@/lib/backlog";
import { isProjectsSectionProject } from "@/lib/portfolio";

describe("publishing calendar", () => {
  it("keeps Facebook and LinkedIn in the model but not connected", () => {
    expect(PUBLISHING_CONNECTED).toEqual({ facebook: false, instagram: true, threads: true, linkedin: false });
    expect(networkOfChannel("story")).toBe("instagram");
    expect(PublishingCalendarSchema.parse(PREVIEW_PUBLISHING)).toEqual(PREVIEW_PUBLISHING);
  });

  it("shows one card per post by day in time order and filters by the channels a post has", () => {
    const all = publishingDays(PREVIEW_PUBLISHING, new Set(["instagram", "threads"]));
    expect(all.map((day) => day.date)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(all[0]!.posts.map((post) => post.id)).toEqual(["p1", "p2", "p3"]);
    expect(all[2]!.posts).toEqual([]);
    // Instagram off: the post with Threads too stays, the Threads-only ones stay, nothing is duplicated.
    const threadsOnly = publishingDays(PREVIEW_PUBLISHING, new Set(["threads"]));
    expect(threadsOnly.flatMap((day) => day.posts.map((post) => post.id))).toEqual(["p1", "p2", "p3", "p4"]);
    const instagramOnly = publishingDays(PREVIEW_PUBLISHING, new Set(["instagram"]));
    expect(instagramOnly.flatMap((day) => day.posts.map((post) => post.id))).toEqual(["p1", "p2"]);
    // A post with a story and an Instagram post counts once for Instagram.
    expect(publishingNetworkCounts(PREVIEW_PUBLISHING.posts)).toEqual({ facebook: 0, instagram: 2, threads: 4, linkedin: 0 });
  });

  it("orders a post's versions story, post, Threads, LinkedIn, Facebook", () => {
    const post = { versions: [...PREVIEW_PUBLISHING.posts[0]!.versions].reverse() };
    expect(orderedVersions(post).map((version) => version.channel)).toEqual(["story", "instagram", "threads"]);
  });

  it("opens a DNESKAi post in the Design Lab and a devShark concept in the Studio", () => {
    const id = "00000000-0000-4000-8000-0000000000c1";
    expect(publishingTargetHref({ kind: "dneskai-lab", postId: id })).toBe(`/projects/dneskai?projectTab=dneskai-review&labPost=${id}&labSlide=0&labView=studio`);
    expect(publishingTargetHref({ kind: "devshark-studio", draftId: id })).toBe(`/projects/devshark?projectTab=devshark-studio&studioDraft=${id}`);
  });

  it("refuses a picture that is not https and a post without versions", () => {
    const post = PREVIEW_PUBLISHING.posts[0]!;
    const http = { ...post, versions: [{ ...post.versions[1]!, pictures: [{ url: "http://example.com/a.jpg", alt: "", width: 1, height: 1 }] }] };
    expect(PublishingCalendarSchema.safeParse({ ...PREVIEW_PUBLISHING, posts: [http] }).success).toBe(false);
    expect(PublishingCalendarSchema.safeParse({ ...PREVIEW_PUBLISHING, posts: [{ ...post, versions: [] }] }).success).toBe(false);
  });
});

describe("backlog", () => {
  it("shows open and in-progress tasks by default and counts them per project", () => {
    expect(filterBacklog(PREVIEW_BACKLOG, { project: "all", status: "active" }).map((item) => item.status)).toEqual(["open", "in_progress", "open"]);
    expect(filterBacklog(PREVIEW_BACKLOG, { project: "heyDarlink", status: "done" })).toHaveLength(1);
    expect(backlogProjectCounts(PREVIEW_BACKLOG, "active")).toEqual({ all: 3, heyDarlink: 0, DNESKAi: 1, devShark: 1, personal: 1 });
  });

  it("links a Jira key and an https URL, nothing else", () => {
    expect(backlogRefHref("LDEV-393")).toBe("https://linka.atlassian.net/browse/LDEV-393");
    expect(backlogRefHref("https://github.com/x/y/pull/1")).toBe("https://github.com/x/y/pull/1");
    expect(backlogRefHref("javascript:alert(1)")).toBeNull();
    expect(backlogRefHref("ticket 4")).toBeNull();
    expect(backlogRefHref(null)).toBeNull();
  });
});

describe("Projects section", () => {
  it("lists only DNESKAi, devShark and heyDarlink", () => {
    expect(["aifirst", "react-express-app", "phone-app", "own-dashboard", null].map((key) => isProjectsSectionProject({ portfolio_key: key }))).toEqual([true, true, true, false, false]);
  });
});
