import { describe, expect, it } from "vitest";
import { parseProjectBriefOutput } from "@/lib/ai-output";

describe("project brief model output", () => {
  it("accepts the bounded structured shape", () => {
    expect(parseProjectBriefOutput({ facts: ["One fact"], risks: [], suggestions: ["Do this"] })).toEqual({
      facts: ["One fact"],
      risks: [],
      suggestions: ["Do this"],
    });
  });

  it("rejects missing, non-string, and oversized fields", () => {
    expect(parseProjectBriefOutput({ facts: [1], risks: [], suggestions: [] })).toBeNull();
    expect(parseProjectBriefOutput({ facts: [], risks: [] })).toBeNull();
    expect(parseProjectBriefOutput({ facts: ["x".repeat(321)], risks: [], suggestions: [] })).toBeNull();
  });
});
