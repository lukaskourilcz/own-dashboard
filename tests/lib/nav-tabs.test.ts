import { describe, expect, it } from "vitest";
import { HIDDEN_NAV_TABS, isDashboardSlug, isHiddenNavTab, isNavPathSegment, isNavTab, tabFromSlug, tabToPath } from "@/lib/nav-tabs";
import { normalizeNavPreferenceIds } from "@/lib/use-prefs";

describe("professional navigation", () => {
  it("uses canonical professional routes", () => {
    expect(tabToPath("home")).toBe("/");
    expect(tabToPath("opportunities")).toBe("/opportunities");
    expect(isNavTab("books")).toBe(false);
    expect(isNavTab("streaks")).toBe(false);
    expect(isNavTab("couple")).toBe(false);
  });

  it("redirects meaningful legacy routes but rejects removed personal routes", () => {
    expect(isNavPathSegment("github")).toBe(true);
    expect(tabFromSlug(["github"])).toBe("projects");
    expect(tabFromSlug(["tugedr"])).toBe("opportunities");
    expect(isNavPathSegment("books")).toBe(false);
    expect(isNavPathSegment("streaks")).toBe(false);
  });

  it("repairs stale local navigation preferences", () => {
    expect(normalizeNavPreferenceIds(["todos", "github", "books", "couple", "inbox", "projects", "projects"])).toEqual(["tasks", "projects"]);
    // Hidden sections are not navigation preferences.
    expect(normalizeNavPreferenceIds(["references", "shortcuts", "links"])).toEqual(["links"]);
  });

  it("hides Inbox and References from navigation but keeps their routes", () => {
    expect([...HIDDEN_NAV_TABS]).toEqual(["inbox", "references"]);
    expect(isHiddenNavTab("inbox")).toBe(true);
    expect(isHiddenNavTab("references")).toBe(true);
    expect(isHiddenNavTab("links")).toBe(false);
    expect(isDashboardSlug(["inbox"])).toBe(true);
    expect(isDashboardSlug(["references"])).toBe(true);
    expect(tabFromSlug(["shortcuts"])).toBe("references");
  });

  it("allows only canonical nested project workspaces", () => {
    expect(isDashboardSlug(["projects", "own-dashboard"])).toBe(true);
    expect(isDashboardSlug(["projects", "one", "extra"])).toBe(false);
    expect(isDashboardSlug(["clients", "client-id"])).toBe(false);
  });
});
