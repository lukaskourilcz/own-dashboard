import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  isCareerRelevant,
  isCzechRemote,
  careerSeniority,
} from "@/lib/jobs/filter";
import {
  isJobUrl,
  pageAvailability,
  verifyListings,
} from "@/lib/jobs/availability";
import { normalizeApifyJob } from "@/lib/jobs/apify";
import { normalizeEmployerJob } from "@/lib/jobs/employer-sources";
import { buildLetter, suggestEvidence } from "@/lib/jobs/letter-helper";
import type { JobListing } from "@/lib/types";
const candidate = {
  title: "Fullstack React engineer",
  tags: ["TypeScript"],
  description: "React and Node.js applications",
  location: "Prague",
  remote: false,
};
describe("personal career eligibility", () => {
  it("accepts Prague office and Czech-compatible remote roles at all three levels", () => {
    for (const title of [
      "Junior React developer",
      "Medior frontend React developer",
      "Senior Fullstack React developer",
    ])
      expect(isCareerRelevant({ ...candidate, title })).toBe(true);
    expect(
      isCareerRelevant({ ...candidate, remote: true, location: "Europe" }),
    ).toBe(true);
    expect(
      isCareerRelevant({ ...candidate, remote: false, location: "Brno" }),
    ).toBe(false);
  });
  it("does not let React rescue foreign stacks or irrelevant disciplines", () => {
    for (const description of [
      "React with Java Spring",
      "React and Kotlin",
      "Angular or React",
      "Vue.js and TypeScript",
      "React Native",
      "Python React",
      "React with C#",
    ])
      expect(isCareerRelevant({ ...candidate, description })).toBe(false);
    for (const title of [
      "Principal React Engineer",
        "Platform Reliability Engineer",
      "Backend Node.js Developer",
      "QA React Engineer",
    ])
      expect(isCareerRelevant({ ...candidate, title })).toBe(false);
    expect(
      isCareerRelevant({
        ...candidate,
        title: "Frontend developer",
        description: "HTML CSS",
        tags: [],
      }),
    ).toBe(false);
  });
  it("does not confuse the ordinary word go with Golang", () =>
    expect(
      isCareerRelevant({
        ...candidate,
        description: "React and TypeScript. Go to the application page.",
      }),
    ).toBe(true));
  it("rejects country-limited and unspecified remote eligibility", () => {
    for (const location of [
      "US only",
      "UK only",
      "Remote",
      "Germany",
      "Europe - UK only",
    ])
      expect(isCzechRemote(location)).toBe(false);
    expect(isCzechRemote("Czech Republic")).toBe(true);
    expect(
      careerSeniority({ title: "React engineer", seniority: "mid-level" }),
    ).toBe("medior");
  });
});
describe("availability boundary", () => {
  it("rejects private URLs and arbitrary redirect destinations", () => {
    for (const url of [
      "http://jobs.cz/x",
      "https://127.0.0.1/x",
      "https://jobs.cz.evil.com/x",
      "https://user:pass@jobs.cz/x",
      "https://jobs.cz:444/x",
    ])
      expect(isJobUrl(url)).toBe(false);
    expect(isJobUrl("https://jobs.lever.co/outreach/123")).toBe(true);
  });
  it("detects soft closure, expired structured data and blocked responses", () => {
    expect(
      pageAvailability(
        200,
        "React Engineer. No longer accepting applications",
        "React Engineer",
      ),
    ).toBe("closed");
    expect(
      pageAvailability(
        200,
        '<script>{"validThrough":"2020-01-01"}</script>React Engineer Apply now',
        "React Engineer",
      ),
    ).toBe("closed");
    expect(
      pageAvailability(
        200,
        "Verify you are human React Engineer Apply now",
        "React Engineer",
      ),
    ).toBe("unknown");
    expect(pageAvailability(200, "All jobs. Apply now", "React Engineer")).toBe(
      "unknown",
    );
    expect(
      pageAvailability(200, "React Engineer Apply now", "React Engineer"),
    ).toBe("open");
    expect(pageAvailability(403, "", "React Engineer")).toBe("unknown");
  });
  it("keeps network failure distinct from closure", async () => {
    const jobs = [{ id: "one" }, { id: "two" }] as JobListing[];
    const result = await verifyListings(jobs, async (j) => {
      if (j.id === "one") throw Error("timeout");
      return "closed";
    });
    expect(result).toEqual({ one: "unknown", two: "closed" });
  });
});
describe("source normalization", () => {
  it("keeps original Apify observation time and drops closed jobs", () => {
    const row = {
      ...candidate,
      id: "123",
      url: "https://www.jobs.cz/rpd/123",
      isRemote: false,
    };
    expect(
      normalizeApifyJob(row, "task", "2026-09-07T08:00:00Z")?.observedAt,
    ).toBe("2026-09-07T08:00:00Z");
    expect(
      normalizeApifyJob(
        { ...row, jobState: "CLOSED" },
        "task",
        "2026-09-07T08:00:00Z",
      ),
    ).toBeNull();
  });
  it("excludes unlisted Ashby postings", () =>
    expect(
      normalizeEmployerJob(
        {
          id: "x",
          isListed: false,
          ...candidate,
          jobUrl: "https://jobs.ashbyhq.com/example/1",
        },
        { id: "example", name: "Example" },
      ),
    ).toBeNull());
});
describe("position-specific letter guidance", () => {
  it("prioritizes banking experience and operational finance context", () => {
    expect(
      suggestEvidence("fintech payment React role")
        .slice(0, 2)
        .map((s) => s.evidence.id),
    ).toEqual(["embedit", "entain"]);
  });
  it("surfaces pharma operations and open-science engineering", () => {
    expect(
      suggestEvidence("pharma healthcare React role")
        .filter((s) => s.domainMatch)
        .map((s) => s.evidence.id),
    ).toEqual(["controlant", "ersilia"]);
  });
  it("uses only selected evidence in the requested language", () => {
    const letter = buildLetter({
      language: "cs",
      company: "Firma",
      position: "React vývojář",
      motivation: "Zajímá mě váš produkt.",
      evidenceIds: ["controlant"],
      skills: ["React"],
    });
    expect(letter).toContain("V Controlantu");
    expect(letter).not.toContain("EmbedIT");
    expect(letter).toContain("Zajímá mě váš produkt.");
    expect(letter).not.toContain("{{");
  });
});
