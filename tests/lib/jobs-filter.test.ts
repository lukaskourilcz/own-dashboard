import { describe, it, expect } from "vitest";
import { isEuropeFriendly, matchRole } from "@/lib/jobs/filter";

describe("matchRole", () => {
  it("classifies fullstack titles (spelling variants)", () => {
    expect(matchRole("Fullstack Developer")).toBe("fullstack");
    expect(matchRole("Full Stack Engineer")).toBe("fullstack");
    expect(matchRole("Full-stack vývojář (React/Node)")).toBe("fullstack");
    expect(matchRole("FULL STACK DEVELOPER (Plzeň / hybrid / remote)")).toBe(
      "fullstack",
    );
  });

  it("classifies frontend titles including framework-named roles", () => {
    expect(matchRole("Frontend Engineer")).toBe("frontend");
    expect(matchRole("SENIOR FRONTEND VÝVOJÁŘ")).toBe("frontend");
    expect(matchRole("Front-end Developer")).toBe("frontend");
    expect(matchRole("React Developer")).toBe("frontend");
    expect(matchRole("Vue.js vývojář")).toBe("frontend");
    expect(matchRole("Frontend Development Engineer - Angular")).toBe(
      "frontend",
    );
  });

  it("classifies generic software-engineering titles", () => {
    expect(matchRole("Software Engineer")).toBe("software");
    expect(matchRole("Senior Software Developer")).toBe("software");
    expect(matchRole("PHP Developer")).toBe("software");
    expect(matchRole("Backend Engineer (Go)")).toBe("software");
    expect(matchRole("Java programátor")).toBe("software");
    expect(matchRole("Web Developer")).toBe("software");
  });

  it("prefers fullstack over frontend when both appear", () => {
    expect(matchRole("Frontend/Fullstack Developer (Senior)")).toBe(
      "fullstack",
    );
  });

  it("rejects other disciplines even with dev words", () => {
    expect(matchRole("QA Engineer")).toBeNull();
    expect(matchRole("QA Tester/ka - Stream Platby")).toBeNull();
    expect(matchRole("DevOps Engineer")).toBeNull();
    expect(matchRole("Data Engineer (Python)")).toBeNull();
    expect(matchRole("Business Developer")).toBeNull();
    expect(matchRole("Vývojář HW")).toBeNull();
    expect(matchRole("Power BI Consultant")).toBeNull();
    expect(matchRole("Android Developer (Kotlin)")).toBeNull();
    expect(matchRole("PPC Specialista pro SaaS")).toBeNull();
  });

  it("rejects non-dev titles entirely", () => {
    expect(matchRole("Head of Marketing")).toBeNull();
    expect(matchRole("Skladový operátor - noční směny")).toBeNull();
    expect(matchRole("")).toBeNull();
  });

  it("uses the extra haystack to rescue, never to veto", () => {
    // Title alone is ambiguous; category names identify the role.
    expect(matchRole("Wizard of code", "Frontend vývojář")).toBe("frontend");
    // A marketing-y category must not veto a clear frontend title.
    expect(matchRole("Frontend Developer", "Marketing")).toBe("frontend");
  });
});

describe("isEuropeFriendly", () => {
  it("accepts explicit Europe signals", () => {
    expect(isEuropeFriendly("Europe")).toBe(true);
    expect(isEuropeFriendly("EMEA only")).toBe(true);
    expect(
      isEuropeFriendly("Europe, UK, Germany, France, European timezones"),
    ).toBe(true);
    expect(isEuropeFriendly("Czechia")).toBe(true);
    expect(isEuropeFriendly("Praha, Česká republika")).toBe(true);
  });

  it("accepts worldwide phrasings", () => {
    expect(isEuropeFriendly("Anywhere in the World")).toBe(true);
    expect(isEuropeFriendly("Worldwide")).toBe(true);
    expect(isEuropeFriendly("Remote")).toBe(true);
  });

  it("rejects other-region-only restrictions", () => {
    expect(isEuropeFriendly("USA only")).toBe(false);
    expect(isEuropeFriendly("Remote - US only")).toBe(false);
    expect(isEuropeFriendly("North America")).toBe(false);
    expect(isEuropeFriendly("LATAM")).toBe(false);
    expect(isEuropeFriendly("Australia & New Zealand")).toBe(false);
  });

  it("Europe wins over a co-mentioned other region", () => {
    expect(isEuropeFriendly("Europe or US")).toBe(true);
    expect(isEuropeFriendly("USA, UK")).toBe(true);
  });

  it("fails closed on unknown text and empty by default", () => {
    expect(isEuropeFriendly("Columbia-Shuswap E,")).toBe(false);
    expect(isEuropeFriendly("")).toBe(false);
    expect(isEuropeFriendly(null)).toBe(false);
  });

  it("treats empty as worldwide only when emptyOk", () => {
    expect(isEuropeFriendly("", { emptyOk: true })).toBe(true);
    expect(isEuropeFriendly(null, { emptyOk: true })).toBe(true);
  });
});
