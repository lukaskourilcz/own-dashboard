import { describe, it, expect } from "vitest";
import { BUILTIN_TEMPLATES, fillTemplate } from "@/lib/jobs/template";

describe("fillTemplate", () => {
  it("substitutes all known placeholders", () => {
    const out = fillTemplate(
      "Re: {{position}} at {{company}} (via {{source}}), {{date}}",
      {
        position: "Frontend Engineer",
        company: "Acme",
        source: "Jobs.cz",
        date: "1 July 2026",
      },
    );
    expect(out).toBe(
      "Re: Frontend Engineer at Acme (via Jobs.cz), 1 July 2026",
    );
  });

  it("is case-insensitive and tolerates inner whitespace", () => {
    expect(
      fillTemplate("{{ Position }} / {{COMPANY}}", {
        position: "Dev",
        company: "Acme",
      }),
    ).toBe("Dev / Acme");
  });

  it("falls back to neutral phrases for missing values", () => {
    const out = fillTemplate("{{position}} at {{company}}", {});
    expect(out).toBe("this position at your company");
  });

  it("leaves unknown placeholders untouched", () => {
    expect(fillTemplate("Hello {{recruiter}}", {})).toBe(
      "Hello {{recruiter}}",
    );
  });

  it("trims substituted values", () => {
    expect(fillTemplate("{{company}}", { company: "  Acme  " })).toBe("Acme");
  });
});

describe("BUILTIN_TEMPLATES", () => {
  it("provides at least three templates in both languages", () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    for (const tpl of BUILTIN_TEMPLATES) {
      expect(tpl.name.en).toBeTruthy();
      expect(tpl.name.cs).toBeTruthy();
      expect(tpl.body.en).toContain("{{position}}");
      expect(tpl.body.cs).toContain("{{position}}");
    }
  });
});
