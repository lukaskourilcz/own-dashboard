import { describe, expect, it } from "vitest";
import { isGoogleLetterUrl, isPositionReady, progressEventLabel } from "@/lib/jobs/pipeline";

describe("career document links", () => {
  it("accepts reviewed text-only drafts while preserving a linked letter review hold", () => {
    expect(isPositionReady({readiness:"ready"})).toBe(true);
    expect(isPositionReady({readiness:"draft"})).toBe(false);
    expect(isPositionReady({readiness:"needs_review",cover_letter_url:"https://docs.google.com/document/d/a/edit"})).toBe(false);
    expect(isPositionReady({cover_letter_url:"https://docs.google.com/document/d/a/edit"})).toBe(true);
  });
  it("accepts optional canonical Google document links and rejects lookalike hosts", () => {
    for (const url of ["", "https://docs.google.com/document/d/abc-123/edit", "https://drive.google.com/file/d/abc/view"]) expect(isGoogleLetterUrl(url)).toBe(true);
    for (const url of ["javascript:alert(1)", "https://docs.google.com.evil.example/document/d/a", "https://docs.google.com@evil.example/document/d/a", "https://drive.google.com/drive/folders/a", "http://docs.google.com/document/d/a"]) expect(isGoogleLetterUrl(url)).toBe(false);
  });
  it("rejects control characters, credentials, overbound links and whitespace-only stored links", () => {
    for(const url of [" ","\n","https://docs.google.com/document/d/"+"a".repeat(2000),"https://docs.google.com/docu\nment/d/a/edit","https://user:pass@docs.google.com/document/d/a/edit","https://docs.google.com:8443/document/d/a/edit"])
      expect(isGoogleLetterUrl(url)).toBe(false);
    expect(isPositionReady({cover_letter_url:"javascript:alert(1)"})).toBe(false);
    expect(isPositionReady({cover_letter_url:" "})).toBe(false);
    expect(isPositionReady({readiness:"ready",cover_letter_url:null})).toBe(true);
  });
  it("never formats inherited object properties as a response label", () => {
    for(const name of ["constructor","__proto__","toString","hasOwnProperty"]) {
      expect(progressEventLabel(JSON.stringify({response_kind:name}),false)).toBe("Progress details updated");
      expect(progressEventLabel(JSON.stringify({response_kind:name,notes:"Retained note"}),true)).toBe("Retained note");
    }
  });
  it("renders legacy notes and structured response history without raw JSON", () => {
    expect(progressEventLabel("Called recruiter", false)).toBe("Called recruiter");
    expect(progressEventLabel(JSON.stringify({ response_kind: "positive", responded_on: "2026-09-10", follow_up_at: "2026-09-15T09:00:00Z", notes: "Interview" }), true)).toBe("Kladná odpověď · 2026-09-10 · Další kontakt: 2026-09-15 · Interview");
  });
});
