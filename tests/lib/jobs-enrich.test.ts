import { describe, expect, it } from "vitest";
import { jobPageTitleFields, normalizeJobUrl } from "@/lib/jobs/enrich";

describe("saved job URL import", () => {
  it("normalizes pasted job links", () => {
    expect(normalizeJobUrl("jobs.example.com/react-engineer")).toBe(
      "https://jobs.example.com/react-engineer",
    );
    expect(normalizeJobUrl("javascript:alert(1)")).toBeNull();
  });

  it("extracts a position and company from common page titles", () => {
    expect(jobPageTitleFields("Frontend Engineer | Acme | LinkedIn")).toEqual({
      title: "Frontend Engineer",
      company: "Acme",
    });
    expect(jobPageTitleFields("Full Stack Engineer at Deel")).toEqual({
      title: "Full Stack Engineer",
      company: "Deel",
    });
  });
});

it.each([null,[],{},42,"https://user:password@jobs.example.test/role","x".repeat(2049)])("rejects malformed or credential-bearing job links (%j)",value => {
 expect(normalizeJobUrl(value)).toBeNull();
});

it("refuses a normalized URL whose encoded form exceeds the storage contract",()=>{
 expect(normalizeJobUrl("https://example.test/"+"界".repeat(300))).toBeNull();
});
