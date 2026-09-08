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
