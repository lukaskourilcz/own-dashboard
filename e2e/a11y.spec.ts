import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, stubBackend } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING = new Set(["serious", "critical"]);

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];
type Violation = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"][number];

function summarize(violations: Violation[]) {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
  }));
}

async function scan(page: Page) {
  // @axe-core/playwright bundles a newer playwright-core than the pinned
  // @playwright/test; the Page runtime API is compatible, so bridge the types.
  const { violations } = await new AxeBuilder({ page: page as unknown as AxePage })
    .withTags(WCAG)
    .analyze();
  return violations.filter((v) => BLOCKING.has(v.impact ?? ""));
}

test.describe("accessibility (axe-core, WCAG 2.0/2.1 A & AA)", () => {
  test("login", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubBackend(page);
    await page.goto("/login");
    // Let the card's entrance fade settle before scanning.
    await page.waitForTimeout(600);
    const serious = await scan(page);
    expect(JSON.stringify(summarize(serious), null, 2)).toBe("[]");
  });

  const TABS = [
    "Home",
    "Calendar",
    "Notes",
    "Tasks",
    "Work overview",
    "Opportunities",
    "Clients",
    "Money overview",
    "Invoices",
    "Subscriptions",
    "Goals",
    "Dates",
    "Inbox",
    "Settings",
  ] as const;

  for (const tab of TABS) {
    test(`dashboard – ${tab}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === "mobile", "scan once on desktop");
      await gotoPreview(page);
      if (tab !== "Home") {
        const region = tab === "Settings" ? page.locator("aside") : page.locator("aside nav");
        await region.getByRole("button", { name: tab, exact: true }).click();
      }
      // Wait out both the initial Home entrance and subsequent tab transition
      // (AnimatePresence mode="wait" plays an exit then an enter) so axe never
      // samples content while parent opacity is still below 1.
      await page.waitForTimeout(600);
      const serious = await scan(page);
      expect(JSON.stringify(summarize(serious), null, 2)).toBe("[]");
    });
  }
});
