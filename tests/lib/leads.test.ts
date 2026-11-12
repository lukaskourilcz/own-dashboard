import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEAD_REGIONS as SCRIPT_REGIONS } from "../../scripts/import-lead-contacts";
import { LEAD_REGIONS, leadMailto, leadSearchTerm, leadTemplateValues, renderLeadTemplate } from "@/lib/leads";

const migration = readFileSync("supabase/migrations/20261112180000_lead_contacts.sql", "utf8");
const seededBody = migration.match(/\$body\$([\s\S]*?)\$body\$/)![1]!;
const withWebsite = { name: "Jan Novák – hodinový manžel", city: "Plzeň", region: "Plzeňský kraj", website: "https://hodinovymanzel-novak.cz/", quality_reason: "Na mobilu se rozpadá menu, chybí ceník.", activity: "drobné opravy", email_source_url: "https://www.firmy.cz/detail/123.html" };
const withoutWebsite = { ...withWebsite, website: null, quality_reason: null };

describe("lead e-mail template", () => {
  it("fills the seeded template for a contact with a website", () => {
    const { text, unknown } = renderLeadTemplate(seededBody, leadTemplateValues(withWebsite));
    expect(unknown).toEqual([]);
    expect(text).toContain("Prošel jsem si váš web hodinovymanzel-novak.cz. Na mobilu se rozpadá menu, chybí ceník. Termín");
    expect(text).not.toContain("Vlastní web jsem k vám nenašel");
    expect(text).toContain("Váš e-mail jsem našel na https://www.firmy.cz/detail/123.html.");
    expect(text).not.toMatch(/\{\{|\}\}/);
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(120);
    expect(text).not.toMatch(/[—–]/);
  });

  it("switches to the no-website paragraph", () => {
    const { text } = renderLeadTemplate(seededBody, leadTemplateValues(withoutWebsite));
    expect(text).toContain("Vlastní web jsem k vám nenašel.");
    expect(text).not.toContain("Prošel jsem si");
    expect(text).not.toMatch(/\n{3,}/);
  });

  it("reports unknown variables and leaves them empty", () => {
    expect(renderLeadTemplate("Ahoj {{jmeno}} {{prijmeni}}{{#telefon}}x{{/telefon}}", { jmeno: "Jan" })).toEqual({ text: "Ahoj Jan", unknown: ["telefon", "prijmeni"] });
  });

  it("builds a mailto link with CRLF line breaks", () => {
    expect(leadMailto("jan@seznam.cz", "Web: test", "A\nB „ne“")).toBe("mailto:jan@seznam.cz?subject=Web%3A%20test&body=A%0D%0AB%20%E2%80%9Ene%E2%80%9C");
  });
});

describe("lead search and regions", () => {
  it("keeps the filter syntax intact", () => {
    expect(leadSearchTerm("  jan.novak@seznam.cz, (x)*  ")).toBe("jan.novak@seznam.cz x");
  });
  it("uses one region list in the app, the import and the database", () => {
    expect(SCRIPT_REGIONS).toEqual(LEAD_REGIONS);
    for (const region of LEAD_REGIONS) expect(migration).toContain(`'${region}'`);
  });
});
