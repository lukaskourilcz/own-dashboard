import { describe, expect, it } from "vitest";
import {
  isCareerRelevant,
  isCzechRelevant,
  isCzechRemote,
  isCzechSnapshot,
} from "@/lib/jobs/filter";
import { normalizeEmployerJob } from "@/lib/jobs/employer-sources";

describe("Czech discovery boundaries", () => {
  it("keeps Prague offices and Czech-compatible remote work", () => {
    for (const location of ["Praha", "Prague, Czechia", "Praha 8 - Karlín"])
      expect(isCzechRelevant({ location, remote: false })).toBe(true);
    for (const location of ["Czechia", "Remote - Czech Republic", "Europe", "EU", "EMEA", "Worldwide"])
      expect(isCzechRemote(location)).toBe(true);
    for (const location of ["Europe excluding Czechia", "Germany only", "US-only", "Remote", ""])
      expect(isCzechRemote(location)).toBe(false);
  });
  it("no longer treats Oslo or another Czech city as a Prague office", () => {
    expect(isCzechRelevant({ location: "Oslo, Norway", remote: false })).toBe(false);
    expect(isCzechRelevant({ location: "Norway", remote: true })).toBe(false);
    expect(isCzechRelevant({ location: "Brno", remote: false })).toBe(false);
  });
  it("establishes remote snapshots only from explicit text or remote-only boards", () => {
    expect(isCzechSnapshot({ location: "Remote · Europe", source: "manual" })).toBe(true);
    expect(isCzechSnapshot({ location: "Na dálku z Česka", source: null })).toBe(true);
    expect(isCzechSnapshot({ location: "Europe", source: "remotive" })).toBe(true);
    expect(isCzechSnapshot({ location: "Europe", source: "manual" })).toBe(false);
  });
  it("retains senior stretches, adjacent stacks and AI integrations for assessment", () => {
    const base = { tags: [], location: "Praha", remote: false };
    for (const [title, description] of [
      ["Principal React Engineer", "React TypeScript, minimum 8 years"],
      ["Senior Fullstack Engineer", "React, Python and Node.js"],
      ["AI Integration Engineer", "n8n, LangChain and APIs"],
      ["Frontend Developer", "SvelteKit and TypeScript"],
      ["Backend Engineer", "Node.js TypeScript PostgreSQL"],
      ["Frontend vývojář", "React a TypeScript"],
    ])
      expect(isCareerRelevant({ ...base, title, description })).toBe(true);
    expect(isCareerRelevant({ ...base, title: "QA Engineer", description: "React TypeScript" })).toBe(false);
    expect(isCareerRelevant({ ...base, title: "React Native Developer", description: "React Native TypeScript" })).toBe(false);
    expect(isCareerRelevant({ ...base, location: "Oslo", title: "Frontend Developer", description: "React" })).toBe(false);
  });
  it("does not lose Prague when an employer API puts another office first", () => {
    const result = normalizeEmployerJob(
      {
        id: "test",
        title: "Senior Fullstack Engineer",
        location: "London, UK",
        secondaryLocations: [{ location: "Prague, Czechia" }],
        descriptionPlain: "React TypeScript",
        jobUrl: "https://jobs.ashbyhq.com/apify/test",
      },
      { id: "ashby-apify", name: "Apify" },
    );
    expect(result?.location).toBe("London, UK / Prague, Czechia");
    expect(result && isCzechRelevant(result)).toBe(true);
  });
});
