import { describe, expect, it } from "vitest";
import { serializeAiContext } from "@/lib/ai-context";

describe("AI context serialization", () => {
  it("keeps short identifiers while bounding long free text", () => {
    const serialized = serializeAiContext({
      source_catalog: ["notes:n1"],
      records: [
        { id: "n1", body: "a".repeat(900) },
        { id: "n2", body: "b".repeat(900) },
        { id: "n3", body: "c".repeat(900) },
      ],
    }, { maxLongTextChars: 600, maxStringChars: 550 });
    const parsed = JSON.parse(serialized) as {
      source_catalog: string[];
      records: { id: string; body: string }[];
    };

    expect(parsed.source_catalog).toEqual(["notes:n1"]);
    expect(parsed.records.map((record) => record.id)).toEqual(["n1", "n2", "n3"]);
    expect(parsed.records[0].body).toContain("[truncated]");
    expect(parsed.records[1].body).toContain("[truncated]");
    expect(parsed.records[2].body).toContain("context limit reached");
  });
});
