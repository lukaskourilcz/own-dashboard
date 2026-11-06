import { describe, expect, it } from "vitest";
import {
  canonicalJobUrl,
  careerPositionKey,
  OSLO_JOBS,
  researchForUrl,
  researchIsStale,
  researchScore,
} from "@/lib/jobs/oslo-research";

describe("evidence-based research", () => {
  it("recognizes alternate portal links without tracking params or trailing slash", () => {
    expect(
      researchForUrl("https://www.linkedin.com/jobs/view/4474611780/?trk=test")
        ?.id,
    ).toBe("flowcase-frontend");
    expect(canonicalJobUrl("https://thehub.io/jobs/one?utm_source=x")).toBe(
      "thehub.io/jobs/one",
    );
  });
  it("deduplicates verified employer aliases but keeps uncertain agency adverts separate", () => {
    expect(careerPositionKey("https://jobs.ashbyhq.com/sanity/52fc85b3-fa35-48ec-ae43-63f8e7d22ac7")).toBe(careerPositionKey("https://www.sanity.io/careers/senior-software-engineer-content-agent"));
    expect(careerPositionKey("https://www.linkedin.com/jobs/view/4470834718/")).not.toBe(careerPositionKey("https://www.linkedin.com/jobs/view/4470834708/"));
  });
  it("expires priorities without resetting original research and catches passed deadlines", () => {
    const flowcase = OSLO_JOBS.find((row) => row.id === "flowcase-frontend")!;
    expect(researchIsStale(flowcase, new Date("2026-10-16"))).toBe(false);
    expect(researchIsStale(flowcase, new Date("2026-11-21"))).toBe(true);
    expect(
      researchIsStale(
        OSLO_JOBS.find((row) => row.id === "monil-embedded")!,
        new Date("2026-10-16"),
      ),
    ).toBe(true);
  });
  it("caps mandatory barriers and does not present repost-only roles as saved LinkedIn jobs", () => {
    expect(
      researchScore(OSLO_JOBS.find((row) => row.id === "di-frontend")!),
    ).toBeLessThanOrEqual(49);
    expect(
      researchScore(OSLO_JOBS.find((row) => row.id === "visoid-growth")!),
    ).toBeLessThanOrEqual(59);
    expect(
      OSLO_JOBS.find((row) => row.id === "six-frontend")?.linkedinSaved,
    ).not.toBe(true);
    for (const job of OSLO_JOBS)
      expect(researchScore(job)).toBeGreaterThanOrEqual(0);
  });
});
