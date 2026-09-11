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
  it("rejects executable links and embedded credentials", () => {
    expect(httpsUrl("javascript:alert(1)")).toBeUndefined();
    expect(httpsUrl("https://user:password@example.com")).toBeUndefined();
    expect(httpsUrl("https://www.upwork.com/")).toBe("https://www.upwork.com/");
  });
});
