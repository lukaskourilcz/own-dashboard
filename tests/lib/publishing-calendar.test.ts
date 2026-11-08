import { describe, expect, it } from "vitest";
import { PREVIEW_PUBLISHING } from "@/components/panels/publishing-calendar-panel";
import { PREVIEW_BACKLOG } from "@/components/panels/backlog-panel";
import { PublishingCalendarSchema, networkOfChannel, publishingDays, publishingNetworkCounts, publishingTargetHref, PUBLISHING_CONNECTED } from "@/lib/publishing-calendar";
import { backlogProjectCounts, backlogRefHref, filterBacklog } from "@/lib/backlog";
import { isProjectsSectionProject } from "@/lib/portfolio";

describe("publishing calendar", () => {
  it("keeps Facebook and LinkedIn in the model but not connected", () => {
    expect(PUBLISHING_CONNECTED).toEqual({ facebook: false, instagram: true, threads: true, linkedin: false });
    expect(networkOfChannel("story")).toBe("instagram");
    expect(PublishingCalendarSchema.parse(PREVIEW_PUBLISHING)).toEqual(PREVIEW_PUBLISHING);
  });

  it("groups items by day in time order and filters by network", () => {
    const all = publishingDays(PREVIEW_PUBLISHING, new Set(["instagram", "threads"]));
    expect(all.map((day) => day.date)).toEqual(["2026-11-08", "2026-11-09", "2026-11-10"]);
    expect(all[0]!.items.map((item) => item.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(all[2]!.items).toEqual([]);
    const threadsOnly = publishingDays(PREVIEW_PUBLISHING, new Set(["threads"]));
    expect(threadsOnly.flatMap((day) => day.items.map((item) => item.id))).toEqual(["p4", "p5"]);
    expect(publishingNetworkCounts(PREVIEW_PUBLISHING.items)).toEqual({ facebook: 0, instagram: 3, threads: 2, linkedin: 0 });
  });

  it("opens a DNESKAi post in the Design Lab and a devShark concept in the Studio", () => {
    const id = "00000000-0000-4000-8000-0000000000c1";
    expect(publishingTargetHref({ kind: "dneskai-lab", postId: id })).toBe(`/projects/dneskai?projectTab=dneskai-review&labPost=${id}&labSlide=0&labView=studio`);
    expect(publishingTargetHref({ kind: "devshark-studio", draftId: id })).toBe(`/projects/devshark?projectTab=devshark-studio&studioDraft=${id}`);
  });

  it("refuses a thumbnail that is not https", () => {
    const item = { ...PREVIEW_PUBLISHING.items[0]!, thumbnail: { url: "http://example.com/a.jpg", alt: "", width: 1, height: 1 } };
    expect(PublishingCalendarSchema.safeParse({ ...PREVIEW_PUBLISHING, items: [item] }).success).toBe(false);
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
