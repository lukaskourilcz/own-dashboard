import { describe, expect, it } from "vitest";
import { httpsUrl, opportunityMetrics } from "@/lib/freelance";
import type { ClientOpportunity } from "@/lib/types";

describe("freelance statistics", () => {
  it("does not count drafts or status-only changes as actual submissions", () => {
    const rows = [
      { platform_id: "a", status: "proposal_sent", submitted_on: null },
      { platform_id: "a", status: "won", submitted_on: "2026-09-01", responded_on: "2026-09-02" },
      { platform_id: "b", status: "lost", submitted_on: "2026-09-02", responded_on: null },
    ] as ClientOpportunity[];
    expect(opportunityMetrics(rows)).toEqual({ saved: 3, submitted: 2, replies: 1, won: 1, responseRate: 50 });
    expect(opportunityMetrics(rows,"a")).toEqual({ saved: 2, submitted: 1, replies: 1, won: 1, responseRate: 100 });
    expect(opportunityMetrics([]).responseRate).toBeNull();
  });
  it("keeps replies and wins inside the submitted cohort and an unknown platform empty", () => {
    const rows = [{ platform_id: "a", status: "won", submitted_on: null, responded_on: "2026-09-01" },
      { platform_id: "b", status: "won", submitted_on: "2026-09-01", responded_on: "2026-09-02" },
      { platform_id: "b", status: "lost", submitted_on: "2026-09-01", responded_on: null }] as ClientOpportunity[];
    expect(opportunityMetrics(rows)).toEqual({ saved: 3, submitted: 2, replies: 1, won: 1, responseRate: 50 });
    expect(opportunityMetrics(rows, "missing")).toEqual({ saved: 0, submitted: 0, replies: 0, won: 0, responseRate: null });
  });
  it("rejects executable links and embedded credentials", () => {
    expect(httpsUrl("javascript:alert(1)")).toBeUndefined();
    expect(httpsUrl("https://user:password@example.com")).toBeUndefined();
    expect(httpsUrl("https://www.upwork.com/")).toBe("https://www.upwork.com/");
  });
  it("uses the shared bounds and rejects control-character normalization while retaining HTTPS-only links", () => {
    for (const value of ["http://example.com/", "https://exam\nple.com/", "https://example.com/\tpath", "https://example.com/\0", "https://example.com/" + "x".repeat(2000), "https://user@example.com/", "//example.com/", ""]) expect(httpsUrl(value)).toBeUndefined();
    expect(httpsUrl(" https://example.com/profile?q=one%20two ")).toBe("https://example.com/profile?q=one%20two");
  });
});
