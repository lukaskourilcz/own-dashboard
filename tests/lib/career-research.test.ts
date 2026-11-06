import { describe, expect, it } from "vitest";
import {
  RESEARCH_JOBS,
  RESEARCHED_ON,
  canonicalJobUrl,
  careerPositionKey,
  isContractRole,
  isPriorityRole,
  researchForUrl,
  researchIsStale,
  researchScore,
  type ResearchJob,
} from "@/lib/jobs/research";
import { CZECH_COMPANIES } from "@/lib/jobs/czech-companies";
import { isJobUrl } from "@/lib/jobs/availability";

const role = (patch: Partial<ResearchJob> = {}): ResearchJob => ({
  id: "fixture",
  company: "Fixture",
  title: "Frontend Engineer",
  url: "https://example.com/jobs/1",
  aliases: [],
  source: "Employer",
  location: "Praha",
  arrangement: "Hybrid · Full-time",
  stack: ["React"],
  points: [36, 22, 12, 10, 10],
  summary: { cs: "", en: "" },
  evidence: { cs: "", en: "" },
  gaps: { cs: "", en: "" },
  ...patch,
});

describe("Czech research register", () => {
  it("has unique ids, unique URLs and bounded points", () => {
    expect(RESEARCH_JOBS.length).toBeGreaterThan(30);
    expect(new Set(RESEARCH_JOBS.map((job) => job.id)).size).toBe(RESEARCH_JOBS.length);
    const urls = RESEARCH_JOBS.flatMap((job) => [job.url, ...job.aliases]).map(canonicalJobUrl);
    expect(new Set(urls).size).toBe(urls.length);
    for (const job of RESEARCH_JOBS) {
      expect(job.url).toMatch(/^https:\/\//);
      job.points.forEach((point, i) => {
        expect(point).toBeGreaterThanOrEqual(0);
        expect(point).toBeLessThanOrEqual([40, 25, 15, 10, 10][i]);
      });
      expect(job.summary.cs && job.summary.en && job.gaps.cs && job.gaps.en).toBeTruthy();
    }
  });
  it("lets every researched vacancy be checked without opening arbitrary hosts", () => {
    for (const job of RESEARCH_JOBS) expect(isJobUrl(job.url)).toBe(true);
    expect(isJobUrl("https://evil.example/jobs/1")).toBe(false);
    expect(isJobUrl("https://thehub.io/jobs/one")).toBe(false);
  });
  it("matches alternate links without tracking params or a trailing slash", () => {
    const job = RESEARCH_JOBS.find((row) => row.aliases.length)!;
    expect(researchForUrl(`${job.aliases[0]}/?utm_source=x`)?.id).toBe(job.id);
    expect(careerPositionKey(job.aliases[0])).toBe(careerPositionKey(job.url));
    expect(canonicalJobUrl("https://www.jobs.cz/rpd/1/?x=1")).toBe("jobs.cz/rpd/1");
    expect(researchForUrl("")).toBeUndefined();
  });
  it("caps blockers: a missing language at 49%, other mandatory barriers at 59%", () => {
    expect(researchScore(role({ blocker: true, points: [40, 25, 15, 10, 0] }))).toBe(49);
    expect(researchScore(role({ blocker: true, points: [40, 25, 15, 10, 10] }))).toBe(59);
    expect(researchScore(role())).toBe(90);
    for (const job of RESEARCH_JOBS.filter((row) => row.blocker))
      expect(researchScore(job)).toBeLessThanOrEqual(59);
  });
  it("expires priorities after 35 days and on passed deadlines", () => {
    const start = new Date(RESEARCHED_ON);
    expect(researchIsStale(role(), start)).toBe(false);
    expect(researchIsStale(role(), new Date(start.getTime() + 36 * 86400000))).toBe(true);
    expect(researchIsStale(role({ deadline: "2026-11-01" }), start)).toBe(true);
    expect(isPriorityRole(role(), start)).toBe(true);
    expect(isPriorityRole(role({ blocker: true }), start)).toBe(false);
  });
  it("recognizes B2B and contract arrangements", () => {
    expect(isContractRole(role({ arrangement: "Remote · B2B" }))).toBe(true);
    expect(isContractRole(role({ arrangement: "Hybrid · Full-time · HPP or IČO" }))).toBe(true);
    expect(isContractRole(role())).toBe(false);
  });
});

describe("Czech careers directory", () => {
  it("lists unique official HTTPS destinations with bilingual notes", () => {
    expect(CZECH_COMPANIES.length).toBeGreaterThan(100);
    expect(new Set(CZECH_COMPANIES.map((row) => canonicalJobUrl(row.url))).size).toBe(CZECH_COMPANIES.length);
    for (const row of CZECH_COMPANIES) {
      expect(row.url).toMatch(/^https:\/\//);
      expect(row.notes.cs.length).toBeGreaterThan(0);
      expect(row.notes.en.length).toBeGreaterThan(0);
    }
  });
});
