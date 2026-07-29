import { describe, expect, it } from "vitest";
import {
  parseCareerCopilotOutput,
  parseKnowledgeReviewOutput,
  parseProjectBriefOutput,
} from "@/lib/ai-output";

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

describe("source-grounded model output", () => {
  const sources = new Set(["projects:p1", "notes:n1", "job_listings:j1"]);

  it("validates Career and knowledge proposal boundaries", () => {
    expect(parseCareerCopilotOutput({
      summary: "Grounded fit review.",
      evidence: [{ claim: "A project is relevant.", source_ids: ["projects:p1"] }],
      gaps: ["No confirmed employment evidence."],
      suggestions: ["Verify the draft."],
      cover_letter_draft: "A bounded draft.",
      interview_questions: ["Which project trade-off would you discuss?"],
    }, sources)?.coverLetterDraft).toBe("A bounded draft.");

    expect(parseKnowledgeReviewOutput({
      summary: "One candidate task.",
      proposals: [{ kind: "candidate_task", title: "Resolve question", reason: "The note leaves it open.", source_ids: ["notes:n1"] }],
    }, sources)?.proposals[0]).toEqual({
      kind: "candidate_task",
      title: "Resolve question",
      reason: "The note leaves it open.",
      sourceIds: ["notes:n1"],
    });
  });
});
