import { describe, it, expect } from "vitest";
import {
  matchListing,
  listingHaystack,
  compareByFit,
  fitLevel,
  type JobMatch,
} from "@/lib/jobs/match";
import type { JobListing } from "@/lib/types";

function listing(overrides: Partial<JobListing>): JobListing {
  return {
    id: "l1",
    source: "remoteok",
    external_id: "x",
    title: "Software Engineer",
    company: "Acme",
    url: "https://example.com/x",
    location: "Europe",
    role: "software",
    remote: true,
    salary: null,
    tags: [],
    seniority: null,
    description: null,
    posted_at: null,
    first_seen_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("matchListing", () => {
  it("matches stack skills from title, tags and description", () => {
    const m = matchListing(
      listing({
        title: "Senior React Developer",
        tags: ["typescript", "next.js"],
        description: "Work with Node.js and PostgreSQL.",
      }),
    );
    const names = m.matched.map((s) => s.name);
    expect(names).toContain("React");
    expect(names).toContain("TypeScript");
    expect(names).toContain("Next.js");
    expect(names).toContain("Node.js");
    expect(names).toContain("PostgreSQL");
    expect(m.score).toBe(100); // no gaps → full coverage
    expect(m.level).toBe("strong");
  });

  it("counts gaps and lowers the score", () => {
    const m = matchListing(
      listing({
        title: "Frontend Engineer",
        tags: ["react", "aws", "graphql"],
      }),
    );
    expect(m.matched.map((s) => s.name)).toEqual(["React"]);
    expect(m.missing.sort()).toEqual(["AWS", "GraphQL"]);
    // matchedWeight 3 / (3 + 2 gaps × 2) = 3/7 ≈ 43
    expect(m.score).toBe(43);
    expect(m.level).toBe("partial");
  });

  it("returns null score when no known tech is named", () => {
    const m = matchListing(listing({ title: "Backend Engineer", tags: [] }));
    expect(m.score).toBeNull();
    expect(m.level).toBe("unknown");
    expect(m.matched).toEqual([]);
    expect(m.missing).toEqual([]);
  });

  it("does not match substrings across word boundaries", () => {
    // "reactive" must not match React; "google" must not match Go.
    const m = matchListing(
      listing({ title: "Reactive systems at Google", tags: [] }),
    );
    expect(m.matched.map((s) => s.name)).not.toContain("React");
    expect(m.missing).not.toContain("Go");
  });

  it("sorts matched skills by weight, strongest first", () => {
    const m = matchListing(
      listing({ title: "Engineer", tags: ["figma", "react", "css"] }),
    );
    // React(3) before CSS3(1)/Figma(1)
    expect(m.matched[0].name).toBe("React");
  });

  it("distinguishes c# / .net as a gap without matching css", () => {
    const m = matchListing(listing({ title: ".NET Developer", tags: ["c#"] }));
    expect(m.missing).toContain("C#");
    expect(m.matched.map((s) => s.name)).not.toContain("CSS3");
  });
});

describe("listingHaystack", () => {
  it("includes title, tags, seniority and description, lowercased", () => {
    const hay = listingHaystack(
      listing({
        title: "React Dev",
        tags: ["ZOD"],
        seniority: "Senior",
        description: "Uses Prisma",
      }),
    );
    expect(hay).toContain("react dev");
    expect(hay).toContain("zod");
    expect(hay).toContain("senior");
    expect(hay).toContain("prisma");
  });
});

describe("fitLevel", () => {
  it("maps scores to levels", () => {
    expect(fitLevel(90)).toBe("strong");
    expect(fitLevel(60)).toBe("good");
    expect(fitLevel(30)).toBe("partial");
    expect(fitLevel(10)).toBe("weak");
    expect(fitLevel(null)).toBe("unknown");
  });
});

describe("compareByFit", () => {
  const mk = (
    score: number | null,
    matchedWeight = 0,
  ): JobMatch => ({
    score,
    level: fitLevel(score),
    matched: [],
    missing: [],
    matchedWeight,
  });

  it("pins shortlisted to the top", () => {
    const a = { listing: listing({ role: "software" }), match: mk(10), shortlisted: true };
    const b = { listing: listing({ role: "frontend" }), match: mk(90), shortlisted: false };
    expect(compareByFit(a, b)).toBeLessThan(0);
  });

  it("puts frontend/fullstack ahead of software", () => {
    const a = { listing: listing({ role: "software" }), match: mk(90), shortlisted: false };
    const b = { listing: listing({ role: "fullstack" }), match: mk(40), shortlisted: false };
    expect(compareByFit(a, b)).toBeGreaterThan(0); // b (FS) first
  });

  it("orders by score within the same role priority", () => {
    const a = { listing: listing({ role: "frontend" }), match: mk(80), shortlisted: false };
    const b = { listing: listing({ role: "fullstack" }), match: mk(40), shortlisted: false };
    expect(compareByFit(a, b)).toBeLessThan(0); // higher score first
  });

  it("breaks score ties by matched breadth", () => {
    const a = { listing: listing({ role: "frontend" }), match: mk(100, 3), shortlisted: false };
    const b = { listing: listing({ role: "frontend" }), match: mk(100, 9), shortlisted: false };
    expect(compareByFit(a, b)).toBeGreaterThan(0); // b broader → first
  });

  it("sorts null scores last within a role group", () => {
    const a = { listing: listing({ role: "frontend" }), match: mk(null), shortlisted: false };
    const b = { listing: listing({ role: "frontend" }), match: mk(20), shortlisted: false };
    expect(compareByFit(a, b)).toBeGreaterThan(0); // scored b first
  });
});
