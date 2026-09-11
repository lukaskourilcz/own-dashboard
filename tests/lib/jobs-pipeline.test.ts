import { describe, expect, it } from "vitest";
import { isGoogleLetterUrl, progressEventLabel } from "@/lib/jobs/pipeline";

describe("career document links", () => {
  it("accepts optional canonical Google document links and rejects lookalike hosts", () => {
    for (const url of ["", "https://docs.google.com/document/d/abc-123/edit", "https://drive.google.com/file/d/abc/view"]) expect(isGoogleLetterUrl(url)).toBe(true);
    for (const url of ["javascript:alert(1)", "https://docs.google.com.evil.example/document/d/a", "https://docs.google.com@evil.example/document/d/a", "https://drive.google.com/drive/folders/a", "http://docs.google.com/document/d/a"]) expect(isGoogleLetterUrl(url)).toBe(false);
  });
  it("renders legacy notes and structured response history without raw JSON", () => {
    expect(progressEventLabel("Called recruiter", false)).toBe("Called recruiter");
    expect(progressEventLabel(JSON.stringify({ response_kind: "positive", responded_on: "2026-09-10", follow_up_at: "2026-09-15T09:00:00Z", notes: "Interview" }), true)).toBe("Kladná odpověď · 2026-09-10 · Další kontakt: 2026-09-15 · Interview");
  });
});
