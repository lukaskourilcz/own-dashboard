import { describe, expect, it } from "vitest";
import { isCareerRelevant, isNorwayRemote, isOslo, isOsloRelevant } from "@/lib/jobs/filter";
import { normalizeEmployerJob } from "@/lib/jobs/employer-sources";
import { canonicalJobUrl, OSLO_JOBS, researchForUrl, researchIsStale, researchScore } from "@/lib/jobs/oslo-research";

describe("Oslo discovery boundaries", () => {
  it("keeps Norway distinct from EU-only and country-limited remote work", () => {
    for (const location of ["Oslo", "Lysaker", "Fornebu, Norway"]) expect(isOslo(location)).toBe(true);
    for (const location of ["Europe", "EEA", "Remote - Norway", "Worldwide"]) expect(isNorwayRemote(location)).toBe(true);
    for (const location of ["EU", "EU-only", "Europe - Germany only", "Europe excluding Norway", "Prague", "Remote", ""]) expect(isNorwayRemote(location)).toBe(false);
    expect(isOsloRelevant({location:"Bergen, Norway",remote:false})).toBe(false);
    expect(isOsloRelevant({location:"Norway",remote:true})).toBe(true);
  });
  it("retains senior stretches, adjacent stacks and AI integrations for assessment", () => {
    const base={tags:[],location:"Oslo",remote:false};
    for (const [title,description] of [
      ["Principal React Engineer","React TypeScript, minimum 8 years"],
      ["Senior Fullstack Engineer","React, Python and Node.js"],
      ["AI Integration Engineer","n8n, LangChain and APIs"],
      ["Frontend Developer","SvelteKit and TypeScript"],
      ["Backend Engineer","Node.js TypeScript PostgreSQL"],
    ]) expect(isCareerRelevant({...base,title,description})).toBe(true);
    expect(isCareerRelevant({...base,title:"QA Engineer",description:"React TypeScript"})).toBe(false);
    expect(isCareerRelevant({...base,title:"React Native Developer",description:"React Native TypeScript"})).toBe(false);
  });
  it("does not lose Oslo when an employer API puts London first", () => {
    const result=normalizeEmployerJob({id:"test",title:"Senior Fullstack Engineer",location:"London, UK",secondaryLocations:[{location:"Oslo, Norway"}],descriptionPlain:"React TypeScript",jobUrl:"https://jobs.ashbyhq.com/sanity/test"},{id:"ashby-sanity",name:"Sanity"});
    expect(result?.location).toBe("London, UK / Oslo, Norway");
    expect(result && isOsloRelevant(result)).toBe(true);
  });
});

describe("evidence-based research", () => {
  it("recognizes alternate portal links without tracking params or trailing slash", () => {
    expect(researchForUrl("https://www.linkedin.com/jobs/view/4474611780/?trk=test")?.id).toBe("flowcase-frontend");
    expect(canonicalJobUrl("https://thehub.io/jobs/one?utm_source=x")).toBe("thehub.io/jobs/one");
  });
  it("expires priorities without resetting original research and catches passed deadlines", () => {
    const flowcase=OSLO_JOBS.find(row=>row.id==="flowcase-frontend")!;
    expect(researchIsStale(flowcase,new Date("2026-10-16"))).toBe(false);
    expect(researchIsStale(flowcase,new Date("2026-11-21"))).toBe(true);
    expect(researchIsStale(OSLO_JOBS.find(row=>row.id==="monil-embedded")!,new Date("2026-10-16"))).toBe(true);
  });
  it("caps mandatory barriers and does not present repost-only roles as saved LinkedIn jobs", () => {
    expect(researchScore(OSLO_JOBS.find(row=>row.id==="di-frontend")!)).toBeLessThanOrEqual(49);
    expect(researchScore(OSLO_JOBS.find(row=>row.id==="visoid-growth")!)).toBeLessThanOrEqual(59);
    expect(OSLO_JOBS.find(row=>row.id==="six-frontend")?.linkedinSaved).not.toBe(true);
    for(const job of OSLO_JOBS) expect(researchScore(job)).toBeGreaterThanOrEqual(0);
  });
});
