import { describe, it, expect } from "vitest";
import {
  normalizeArbeitnowItem,
  normalizeJobicyItem,
  normalizeRemoteOkItem,
  normalizeRemotiveItem,
  normalizeStartupJobsItem,
  parseCzechDate,
  parseJobsCzCards,
  parsePraceCzCards,
  parseWwrItems,
  startupJobsSalary,
  unescapeHtml,
} from "@/lib/jobs/sources";

const NOW = new Date("2026-07-16T12:00:00Z");

describe("unescapeHtml", () => {
  it("decodes named and numeric entities", () => {
    expect(unescapeHtml("MAKRO Cash &amp; Carry &#268;R &quot;s.r.o.&quot;")).toBe(
      'MAKRO Cash & Carry ČR "s.r.o."',
    );
  });
});

describe("parseCzechDate", () => {
  it("parses day-month genitives within the current year", () => {
    expect(parseCzechDate("19. června", NOW)).toBe(
      "2026-06-19T00:00:00.000Z",
    );
  });

  it("rolls a future day-month back a year", () => {
    expect(parseCzechDate("24. prosince", NOW)).toBe(
      "2025-12-24T00:00:00.000Z",
    );
  });

  it("handles dnes and včera", () => {
    expect(parseCzechDate("Vloženo dnes", NOW)).toBe(
      "2026-07-16T00:00:00.000Z",
    );
    expect(parseCzechDate("včera", NOW)).toBe("2026-07-15T00:00:00.000Z");
  });

  it("returns null for unknown text", () => {
    expect(parseCzechDate("brzy", NOW)).toBeNull();
    expect(parseCzechDate("", NOW)).toBeNull();
  });
});

describe("normalizeStartupJobsItem", () => {
  const base = {
    id: 102781,
    name: "Frontend vývojář (React)",
    company: "Ecomail.cz",
    url: "/nabidka/102781/frontend-vyvojar",
    locations: "Praha",
    isRemote: true,
    salary: null,
    areaNames: ["Frontend vývojář", "Vývoj"],
    mainAreaName: "Frontend vývojář",
    seniorities: ["medior", "senior"],
  };

  it("normalizes a remote frontend offer", () => {
    const job = normalizeStartupJobsItem(base);
    expect(job).not.toBeNull();
    expect(job!.source).toBe("startupjobs");
    expect(job!.externalId).toBe("102781");
    expect(job!.role).toBe("frontend");
    expect(job!.url).toBe("https://www.startupjobs.cz/nabidka/102781/frontend-vyvojar");
    expect(job!.remote).toBe(true);
    expect(job!.seniority).toBe("medior, senior");
  });

  it("drops on-site offers", () => {
    expect(normalizeStartupJobsItem({ ...base, isRemote: false })).toBeNull();
  });

  it("drops non-matching roles", () => {
    expect(
      normalizeStartupJobsItem({
        ...base,
        name: "PPC Specialista pro SaaS",
        areaNames: ["Marketing"],
        mainAreaName: "PPC specialista",
      }),
    ).toBeNull();
  });

  it("renders structured salary", () => {
    expect(
      startupJobsSalary({ from: 60000, to: 90000, currency: "Kč" }),
    ).toMatch(/60.*90.*Kč/);
    expect(startupJobsSalary(null)).toBeNull();
    expect(startupJobsSalary({ currency: "Kč" })).toBeNull();
  });
});

// Fixture mirrors the live jobs.cz SearchResultCard markup (attributes on
// their own lines, entity-escaped title link, footer with svg + text items).
const JOBSCZ_HTML = `
<article
    class="SearchResultCard"
>
  <header class="SearchResultCard__header">
    <h2 data-test-ad-title="SENIOR FRONTEND VÝVOJÁŘ" class="SearchResultCard__title">
      <a data-jobad-id="2001290203"
        href="https://www.jobs.cz/rpd/2001290203/?searchId=abc&amp;rps=233"
        class="link-primary SearchResultCard__titleLink"
      >SENIOR FRONTEND VÝVOJÁŘ</a>
    </h2>
    <div class="SearchResultCard__logo">
      <img class="Image" alt="BENU Česká republika s.r.o." src="x.png" />
    </div>
    <div data-test-ad-status="default" class="SearchResultCard__status SearchResultCard__status--default">
      19. června
    </div>
  </header>
  <footer class="SearchResultCard__footer">
    <ul class="SearchResultCard__footerList">
      <li class="SearchResultCard__footerItem"
>
        <svg xmlns="http://www.w3.org/2000/svg"><path d="M1" /></svg>
        Praha – Hostivař
      </li>
      <li class="SearchResultCard__footerItem"
>
        <svg xmlns="http://www.w3.org/2000/svg"><path d="M2" /></svg>
        70 000–90 000 Kč
      </li>
    </ul>
  </footer>
</article>
<article class="SearchResultCard">
  <h2 data-test-ad-title="Skladák" class="SearchResultCard__title">
    <a data-jobad-id="999" href="https://www.jobs.cz/rpd/999/" class="SearchResultCard__titleLink">Skladák</a>
  </h2>
</article>
`;

describe("parseJobsCzCards", () => {
  it("extracts matching cards with company, location, salary and date", () => {
    const jobs = parseJobsCzCards(JOBSCZ_HTML, NOW);
    expect(jobs).toHaveLength(1);
    const j = jobs[0];
    expect(j.externalId).toBe("2001290203");
    expect(j.title).toBe("SENIOR FRONTEND VÝVOJÁŘ");
    expect(j.role).toBe("frontend");
    expect(j.url).toBe("https://www.jobs.cz/rpd/2001290203/");
    expect(j.company).toBe("BENU Česká republika s.r.o.");
    expect(j.location).toBe("Praha – Hostivař");
    expect(j.salary).toContain("Kč");
    expect(j.postedAt).toBe("2026-06-19T00:00:00.000Z");
    expect(j.remote).toBe(true);
  });

  it("returns nothing for empty html", () => {
    expect(parseJobsCzCards("<html></html>", NOW)).toEqual([]);
  });
});

// Fixture mirrors the live prace.cz JobCard markup (RSC output with
// accessibility-hidden field labels).
const PRACECZ_HTML = `
<article id="advert-d0c922f6-0764-4c1d-978a-12552ae2e9e9" class="JobCard-module__JobCard">
  <header>
    <h2 data-testid="job-card-title" class="JobCardTitle"><a data-testid="advert-link" class="link-primary" href="https://firma.prace.cz/pd/2000534629?originJobAdUuid=d0c922f6&amp;rps=2078">Fullstack Developer (React + Node)</a></h2>
  </header>
  <div class="JobCardBody">
    <ul>
      <li><span class="accessibility-hidden">Lokalita<!-- -->:</span><span class="typography-body-medium-semibold text-wrap-pretty">Praha<span class="delimiter"></span></span></li>
      <li><span class="accessibility-hidden">Název firmy<!-- -->:</span><span class="typography-body-medium-regular text-wrap-pretty">Acme s.r.o.<span class="delimiter"></span></span></li>
    </ul>
  </div>
</article>
<article id="advert-ffffffff-0000-1111-2222-333333333333" class="JobCard-module__JobCard">
  <h2 data-testid="job-card-title"><a data-testid="advert-link" href="https://www.prace.cz/pd/1">Skladák</a></h2>
</article>
<article id="advert-aaaaaaaa-1111-2222-3333-444444444444" class="JobCard-module__JobCard">
  <h2 data-testid="job-card-title"><a data-testid="advert-link" href="/firma/acme/nabidka/xyz?rps=2078">Software Engineer (Node.js)</a></h2>
</article>
`;

describe("parsePraceCzCards", () => {
  it("extracts matching cards with label-driven fields", () => {
    const jobs = parsePraceCzCards(PRACECZ_HTML);
    expect(jobs).toHaveLength(2);
    const j = jobs[0];
    expect(j.externalId).toBe("d0c922f6-0764-4c1d-978a-12552ae2e9e9");
    expect(j.title).toBe("Fullstack Developer (React + Node)");
    expect(j.role).toBe("fullstack");
    expect(j.url).toBe("https://firma.prace.cz/pd/2000534629");
    expect(j.company).toBe("Acme s.r.o.");
    expect(j.location).toBe("Praha");
  });

  it("resolves relative advert links against prace.cz", () => {
    const jobs = parsePraceCzCards(PRACECZ_HTML);
    expect(jobs[1].url).toBe("https://www.prace.cz/firma/acme/nabidka/xyz");
  });
});

describe("normalizeRemoteOkItem", () => {
  const base = {
    id: "1134891",
    slug: "remote-frontend-dev",
    position: "Frontend Developer",
    company: "Acme",
    location: "Europe",
    tags: ["react", "typescript"],
    url: "https://remoteOK.com/remote-jobs/remote-frontend-dev",
    date: "2026-07-15T06:42:16+00:00",
    salary_min: 60000,
    salary_max: 90000,
  };

  it("normalizes a Europe-friendly item with salary", () => {
    const j = normalizeRemoteOkItem(base);
    expect(j).not.toBeNull();
    expect(j!.role).toBe("frontend");
    expect(j!.salary).toBe("$60k – $90k");
    expect(j!.postedAt).toBe("2026-07-15T06:42:16+00:00");
  });

  it("accepts empty location as worldwide", () => {
    expect(normalizeRemoteOkItem({ ...base, location: "" })).not.toBeNull();
  });

  it("drops region-restricted items", () => {
    expect(
      normalizeRemoteOkItem({ ...base, location: "USA only" }),
    ).toBeNull();
  });

  it("drops the legal-notice pseudo item", () => {
    expect(normalizeRemoteOkItem({} as never)).toBeNull();
  });
});

describe("normalizeRemotiveItem", () => {
  const base = {
    id: 2091062,
    url: "https://remotive.com/remote-jobs/software-development/x-2091062",
    title: "Senior Product Engineer (Fullstack)",
    company_name: "Clipster",
    tags: ["golang", "react"],
    publication_date: "2026-07-13T07:05:10",
    candidate_required_location: "Europe, UK, Germany",
    salary: "",
  };

  it("normalizes a Europe listing", () => {
    const j = normalizeRemotiveItem(base);
    expect(j).not.toBeNull();
    expect(j!.role).toBe("fullstack");
    expect(j!.company).toBe("Clipster");
    expect(j!.salary).toBeNull();
  });

  it("fails closed when the location is unknown", () => {
    expect(
      normalizeRemotiveItem({ ...base, candidate_required_location: "" }),
    ).toBeNull();
  });
});

describe("normalizeArbeitnowItem", () => {
  const base = {
    slug: "senior-software-engineer-berlin-247930",
    company_name: "Think3DDD",
    title: "Senior Software Engineer (TypeScript)",
    remote: true,
    url: "https://www.arbeitnow.com/jobs/companies/x/senior-software-engineer",
    tags: ["Software Development"],
    job_types: ["Full-Time"],
    location: "Berlin",
    created_at: 1784152826,
  };

  it("normalizes remote items with unix timestamps", () => {
    const j = normalizeArbeitnowItem(base);
    expect(j).not.toBeNull();
    expect(j!.role).toBe("software");
    expect(j!.postedAt).toBe(new Date(1784152826 * 1000).toISOString());
  });

  it("drops on-site items", () => {
    expect(normalizeArbeitnowItem({ ...base, remote: false })).toBeNull();
  });
});

describe("normalizeJobicyItem", () => {
  it("normalizes and decodes industry tags", () => {
    const j = normalizeJobicyItem({
      id: 146254,
      url: "https://jobicy.com/jobs/146254",
      jobTitle: "React Developer",
      companyName: "Softgic",
      jobGeo: "Anywhere",
      jobIndustry: ["DevOps &amp; Infrastructure"],
      jobLevel: "Senior",
      pubDate: "2026-07-15T20:15:03+00:00",
    });
    expect(j).not.toBeNull();
    expect(j!.role).toBe("frontend");
    expect(j!.tags).toEqual(["DevOps & Infrastructure"]);
    expect(j!.seniority).toBe("Senior");
  });
});

const WWR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <item>
    <title><![CDATA[Acme Corp: Full-Stack Engineer]]></title>
    <region>Anywhere in the World</region>
    <category>Full-Stack Programming</category>
    <link>https://weworkremotely.com/remote-jobs/acme-corp-full-stack-engineer</link>
    <pubDate>Tue, 30 Jun 2026 20:31:25 +0000</pubDate>
    <guid>https://weworkremotely.com/remote-jobs/acme-corp-full-stack-engineer</guid>
  </item>
  <item>
    <title>OnlyUS: Backend Developer</title>
    <region>USA Only</region>
    <link>https://weworkremotely.com/remote-jobs/onlyus-backend</link>
    <guid>https://weworkremotely.com/remote-jobs/onlyus-backend</guid>
  </item>
</channel>
</rss>`;

describe("parseWwrItems", () => {
  it("splits company from title and filters by region", () => {
    const jobs = parseWwrItems(WWR_XML);
    expect(jobs).toHaveLength(1);
    const j = jobs[0];
    expect(j.company).toBe("Acme Corp");
    expect(j.title).toBe("Full-Stack Engineer");
    expect(j.role).toBe("fullstack");
    expect(j.location).toBe("Anywhere in the World");
    expect(j.postedAt).toBe("2026-06-30T20:31:25.000Z");
  });
});
