import { test, expect } from "@playwright/test";
import { gotoPreview, watchConsole } from "./helpers";

// Section labels in English (gotoPreview forces lang=en).
const TABS = [
  "Overview",
  "Calendar",
  "Notes",
  "Tasks",
  "Habits",
  "Finances",
  "Invoices",
  "Subscriptions",
  "Plans",
  "Books",
  "Dates",
  "Couple",
  "Jobs",
] as const;

test.describe("dashboard sections", () => {
  test("every section opens from the sidebar without console errors", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === "mobile",
      "Sidebar navigation is desktop-only; mobile nav is covered in responsive.spec.",
    );

    const errors = watchConsole(page);
    await gotoPreview(page);

    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    for (const name of TABS) {
      const item = sidebar.getByRole("button", { name, exact: true });
      await item.click();
      await expect(item).toHaveAttribute("aria-current", "page");
      // Let the tab transition settle before moving on.
      await page.waitForTimeout(120);
    }

    // Settings lives outside the nav list (gear button in the footer).
    await sidebar.getByRole("button", { name: "Settings" }).click();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("overview shows lifelike fixture content", async ({ page }) => {
    await gotoPreview(page);
    // Greeting hero addresses the fixture user by first name.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Jan");
    // KPI + customize affordance present.
    await expect(
      page.getByRole("button", { name: "Customize" }),
    ).toBeVisible();
  });
});
