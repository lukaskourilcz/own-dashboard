import { describe, expect, it } from "vitest";
import { operatingCost } from "@/lib/operating-costs";

describe("recorded consumption", () => {
  it("preserves unknown and in-flight costs, including a zero placeholder", () => {
    expect(operatingCost("devshark", "project", [{ cost: null }, { cost: 0, pending: true }])).toMatchObject({ usd: null, unknown: 2 });
    expect(operatingCost("generation", "project", [{ cost: 0 }, { cost: "1.25" }, { cost: "" }, { cost: -5 }])).toMatchObject({ usd: 1.25, rows: 4, unknown: 2 });
  });
  it("keeps partial reads and reserved costs separate", () => {
    expect(operatingCost("generationReserved", "project", [{ cost: "0.4" }], true)).toEqual({ projectId: "project", source: "generationReserved", usd: 0.4, rows: 1, unknown: 0, partial: true });
    expect(operatingCost("collection", "project", [])).toMatchObject({ usd: null, rows: 0 });
  });
});
