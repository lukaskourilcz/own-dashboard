import { describe, expect, it } from "vitest";
import { homeApplications, homeBacklog } from "@/lib/home-execution";
import { PREVIEW_BACKLOG } from "@/components/panels/backlog-panel";
import type { JobApplication, SavedJobPosition } from "@/lib/types";

const position = (id: string, patch: Partial<SavedJobPosition> = {}): SavedJobPosition => ({ id, user_id: "owner", listing_id: null, title: id, company: "Company", url: `https://jobs.example/${id}`, source: null, location: null, description: null, cover_letter: "", notes: null, saved_at: "2026-11-10", updated_at: "2026-11-10", ...patch });
const application = (patch: Partial<JobApplication>): JobApplication => ({ id: "application", user_id: "owner", listing_id: null, title: "Role", company: null, url: null, source: null, location: null, cover_letter: "", status: "applied", applied_on: "2026-11-10", notes: null, created_at: "2026-11-10", updated_at: "2026-11-10", ...patch });

describe("Home execution queues", () => {
  it("shows the first five unfinished tasks in the stable Backlog order", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ ...PREVIEW_BACKLOG[0], id: String(i), created_at: `2026-11-${String(i + 1).padStart(2, "0")}`, status: i === 7 ? "done" as const : i === 6 ? "dropped" as const : "open" as const }));
    expect(homeBacklog(rows).map(x => x.id)).toEqual(["5", "4", "3", "2", "1"]);
    expect(rows).toHaveLength(8);
  });
  it("excludes applied roles by canonical URL and listing ID, including closed applications", () => {
    const rows = [position("a", { url: "https://www.jobs.example/a/?utm_source=ig" }), position("b", { listing_id: "listing" }), position("c")];
    expect(homeApplications(rows, [application({ url: "https://jobs.example/a", status: "rejected" }), application({ listing_id: "listing" })]).map(x => x.id)).toEqual(["c"]);
  });
  it("puts prepared applications first, deduplicates aliases, and caps at five", () => {
    const rows = [position("draft", { saved_at: "2026-11-11" }), position("ready", { readiness: "ready" }), position("copy", { url: "https://jobs.example/ready?ref=saved" }), ...Array.from({ length: 6 }, (_, i) => position(String(i)))];
    const result = homeApplications(rows, []);
    expect(result[0].id).toBe("ready");
    expect(result.map(x => x.id)).not.toContain("copy");
    expect(result).toHaveLength(5);
  });
  it("does not expose unsafe or empty application destinations", () => {
    expect(homeApplications([position("a", { url: "javascript:alert(1)" }), position("b", { url: "" })], [])).toEqual([]);
  });
});
