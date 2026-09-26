import { test, expect } from "@playwright/test";
import { gotoPreview, watchConsole } from "./helpers";

// Section labels in English (gotoPreview forces lang=en).
const TABS = [
  "Home",
  "Work overview",
  "Projects",
  "Competition",
  "Opportunities",
  "Clients",
  "Career",
  "Invoices",
  "Money overview",
  "Accounts",
  "Transactions",
  "Subscriptions",
  "Categories",
  "Tasks",
  "Calendar",
  "Goals",
  "Dates",
  "Notes",
  "Prompts",
  "Tools",
  "Links",
  "IG TIPS",
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
    const nav = sidebar.locator("nav");
    await expect(nav).toBeVisible();

    for (const name of TABS) {
      const item = nav.getByRole("button", { name, exact: true });
      await item.click();
      await expect(item).toHaveAttribute("aria-current", "page");
      // Let the tab transition settle before moving on.
      await page.waitForTimeout(120);
    }

    // Settings lives outside the nav list (gear button in the footer).
    await sidebar.getByRole("button", { name: "Settings" }).click();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("home shows lifelike fixture content and no removed personal navigation", async ({ page }, testInfo) => {
    await gotoPreview(page);
    // The window toolbar owns the screen title; the compact greeting remains
    // a secondary heading inside the Home attention surface.
    await expect(
      page.getByRole("heading", { level: 1, name: "Home" }),
    ).toBeVisible();
    if (testInfo.project.name === "desktop") {
      await expect(page.locator(".mac-window")).toBeVisible();
      await expect(page.locator(".mac-toolbar")).toBeVisible();
      await expect(page.locator(".traffic-light")).toHaveCount(3);
    }
    await expect(page.getByRole("heading", { level: 2 }).first()).toContainText(
      "Jan",
    );
    // KPI + customize affordance present.
    await expect(
      page.getByRole("button", { name: "Customize" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Today's seven" }),
    ).toBeVisible();
    await expect(page.getByText("0 of 7 completed")).toBeVisible();
    await expect(page.getByText("GLOBAL", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 3, name: "Completion garden" }),
    ).toBeVisible();
    await expect(page.getByText(/^Waiting /).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Generate a new seven" }),
    ).toBeVisible();
    const sidebar = page.locator("aside");
    if (testInfo.project.name === "desktop") {
      await expect(
        sidebar.getByRole("link", { name: "DNESKAi", exact: true }),
      ).toBeVisible();
      await expect(
        sidebar.getByRole("link", { name: "own-dashboard", exact: true }),
      ).toBeVisible();
    }
    await expect(sidebar.getByRole("button", { name: "Habits" })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "Books" })).toHaveCount(0);
    await expect(sidebar.getByRole("button", { name: "Couple" })).toHaveCount(0);
  });

  test("repairs stale personal navigation preferences", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem("hiddenNavSections", JSON.stringify(["books", "couple", "overview"]));
      localStorage.setItem("navOrder", JSON.stringify(["streaks", "tugedr", "todos"]));
    });
    await gotoPreview(page);
    const nav = testInfo.project.name === "mobile" ? page.getByTestId("mobile-nav") : page.locator("aside");
    await expect(nav.getByRole("button", { name: /^(Home|Domů)$/ })).toBeVisible();
    if (testInfo.project.name === "mobile") {
      await nav.getByRole("button", { name: /^(More|Více)$/ }).click();
      await expect(page.getByRole("dialog", { name: /^(All areas|Všechny sekce)$/ }).getByRole("button", { name: /^(Opportunities|Příležitosti)$/ })).toBeVisible();
    } else {
      await expect(nav.getByRole("button", { name: /^(Opportunities|Příležitosti)$/ })).toBeVisible();
    }
  });

  test("project workspace exposes the unified project context", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    // The pre-rename slug still resolves to the DNESKAi workspace.
    await page.goto("/dev-preview?project=aifirst");
    await expect(page.getByRole("heading", { level: 1, name: "DNESKAi" })).toBeVisible();
    for (const tab of ["Overview", "Tasks", "Activity", "Communication", "Repository", "Finance", "Competition", "Knowledge", "Scaling", "Monetization"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
    await page.getByRole("tab", { name: "Finance" }).click();
    await expect(page.getByText("Supabase", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Communication" }).click();
    await expect(page.getByText("Confirmed the first release scope and the weekly review cadence.")).toBeVisible();
    await expect(page.getByText("Send the revised launch checklist.")).toBeVisible();
  });

  test("project navigation stays in the shell and Projects returns to the table", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    const sidebar = page.locator("aside");

    await sidebar.getByRole("link", { name: "DNESKAi", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "DNESKAi" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/dneskai$/);

    await sidebar.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Project" })).toBeVisible();
    await expect(page).toHaveURL(/\/projects$/);
  });

  test("Inbox and References are hidden from navigation but open by URL", async ({ page }, testInfo) => {
    await gotoPreview(page);
    if (testInfo.project.name === "mobile") {
      const bar = page.getByTestId("mobile-nav");
      await expect(bar.getByRole("button", { name: "Inbox", exact: true })).toHaveCount(0);
      await bar.getByRole("button", { name: "More", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "All areas" });
      await expect(sheet.getByRole("button", { name: "Links", exact: true })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Inbox", exact: true })).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: "References", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    } else {
      const sidebar = page.locator("aside");
      await expect(sidebar.getByRole("button", { name: "Inbox", exact: true })).toHaveCount(0);
      await expect(sidebar.getByRole("button", { name: "References", exact: true })).toHaveCount(0);

      // The command palette offers neither destination.
      await page.keyboard.press("Control+k");
      const input = page.getByPlaceholder("Type a command or search…");
      await expect(input).toBeVisible();
      await input.fill("Links");
      await expect(page.getByRole("button", { name: "Links", exact: true }).last()).toBeVisible();
      await input.fill("Inbox");
      await expect(page.getByRole("dialog").getByRole("button", { name: "Inbox", exact: true })).toHaveCount(0);
      await input.fill("References");
      await expect(page.getByRole("dialog").getByRole("button", { name: "References", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(input).toBeHidden();

      // `g r` and `g i` no longer navigate.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("g");
      await page.keyboard.press("r");
      await page.keyboard.press("g");
      await page.keyboard.press("i");
      await expect(page.locator("header").getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

      // Settings lists neither section.
      await sidebar.getByRole("button", { name: "Settings" }).click();
      await expect(page.getByRole("switch", { name: "References", exact: true })).toHaveCount(0);
      await expect(page.locator("#main-content").getByText("Inbox", { exact: true })).toHaveCount(0);
    }

    // Both routes still render, with a note that they are hidden.
    await page.goto("/dev-preview?tab=inbox");
    await expect(page.locator("header").getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
    await expect(page.getByText("Hidden from navigation.", { exact: false })).toBeVisible();
    await page.goto("/dev-preview?tab=references");
    await expect(page.locator("header").getByRole("heading", { level: 1, name: "References" })).toBeVisible();
    await expect(page.getByText("Hidden from navigation.", { exact: false })).toBeVisible();
  });

  test("Projects lists own work first and freelance projects behind a divider", async ({ page }, testInfo) => {
    await gotoPreview(page);
    if (testInfo.project.name === "mobile") {
      await page.getByTestId("mobile-nav").getByRole("button", { name: "Projects", exact: true }).click();
    } else {
      await page.locator("aside nav").getByRole("button", { name: "Projects", exact: true }).click();
    }
    const table = page.getByRole("table");
    await expect(table.getByRole("row", { name: "Freelance", exact: true })).toHaveCount(1);
    const names = await table.locator("tbody tr td:nth-child(2) a").allTextContents();
    // The boardlessAI ventures follow their parent as subsections.
    expect(names).toEqual([
      "DNESKAi",
      "own-dashboard",
      "devShark",
      "boardlessAI",
      "Design Lab",
      "GoVIRAL",
      "Recipe box app",
      "Acme customer portal",
      "Harbor Bakery website",
    ]);
    await expect(table.getByRole("row", { name: /Design Lab/ }).getByRole("button", { name: "Drag to reorder" })).toHaveCount(0);
    // Keyboard order follows the visual order: the divider row sits between
    // the last own project and the first freelance project.
    const rows = await table.locator("tbody tr").allTextContents();
    const divider = rows.findIndex((text) => text.trim() === "Freelance");
    expect(rows[divider - 1]).toContain("Recipe box app");
    expect(rows[divider + 1]).toContain("Acme customer portal");
    // The wide table scrolls inside its card; the page itself never widens.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (testInfo.project.name === "desktop") {
      const sidebar = page.locator("aside");
      await expect(sidebar.getByText("Freelance", { exact: true })).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "Harbor Bakery website" })).toBeVisible();
    }
  });

  test("Czech Projects shows the freelance divider", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page, { lang: "cs" });
    await page.locator("aside nav").getByRole("button", { name: "Projekty", exact: true }).click();
    // Czech uses the same plain label; the old "Freelance — najatý" is gone.
    await expect(page.getByRole("table").getByRole("row", { name: "Freelance", exact: true })).toBeVisible();
    await expect(page.getByText(/najatý/)).toHaveCount(0);
  });

  test("navigation and project-tab visibility survive a refresh", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    const sidebar = page.locator("aside");
    await sidebar.getByRole("button", { name: "Settings" }).click();

    await page.getByRole("switch", { name: "Career", exact: true }).click();
    await page.getByRole("switch", { name: "Communication", exact: true }).click();
    await expect(
      sidebar.getByRole("button", { name: "Career", exact: true }),
    ).toHaveCount(0);

    // Re-enter the deterministic preview as a real refresh would re-enter the
    // authenticated catch-all route. The client cache must survive the page.
    await page.goto("/dev-preview");
    await expect(
      page.locator("aside").getByRole("button", { name: "Career", exact: true }),
    ).toHaveCount(0);
    await page
      .locator("aside")
      .getByRole("link", { name: "DNESKAi", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "Communication", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Activity", exact: true })).toBeVisible();
  });

  test("Tasks groups manual and imported work by active project", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    await page.locator("aside nav").getByRole("button", { name: "Tasks" }).click();
    const main = page.locator("#main-content");
    await expect(main.getByText("DNESKAi", { exact: true }).first()).toBeVisible();
    await expect(
      main.getByText("own-dashboard", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      main.getByText("Verify project deployment").first(),
    ).toBeVisible();
    await expect(
      main.getByText("Review dashboard accessibility report").first(),
    ).toBeVisible();
  });

  test("destructive confirmation opens at a stable viewport center", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    await page.locator("aside nav").getByRole("button", { name: "Tasks" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const first = await dialog.boundingBox();
    await page.waitForTimeout(80);
    const settled = await dialog.boundingBox();
    expect(first).not.toBeNull();
    expect(settled).not.toBeNull();
    expect(Math.abs((first?.x ?? 0) - (settled?.x ?? 0))).toBeLessThan(1);
    expect(Math.abs((first?.y ?? 0) - (settled?.y ?? 0))).toBeLessThan(1);
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(
      Math.abs(
        (settled?.x ?? 0) +
          (settled?.width ?? 0) / 2 -
          (viewport?.width ?? 0) / 2,
      ),
    ).toBeLessThan(2);
  });

  test("Career exposes job details and writing tools", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    const sidebar = page.locator("aside nav");
    await sidebar.getByRole("button", { name: "Career" }).click();
    await page.getByRole("button", { name: "Check for new offers", exact: true }).click();
    await expect(page.getByRole("button", { name: "Senior Frontend Engineer (React)", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Senior Frontend Engineer (React)", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cover letters", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Career links", exact: true })).toBeVisible();
    await page.getByLabel("Sort").click();
    await page.getByRole("option", { name: "Remote first" }).click();
    await page.getByLabel("Sort").click();
    await page.getByRole("option", { name: "Location A–Z" }).click();
  });

  test("the weekly review lists what shipped since the last completed review", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    await page.locator("aside nav").getByRole("button", { name: "Work overview", exact: true }).click();
    // The fixture review closed the week of 2026-09-07, so the two newest
    // changelog entries published after it are the ones the block should name.
    await expect(page.getByText("Shipped since last review")).toBeVisible();
    await expect(page.getByText("Tools, project links, Competition, payment matching and weekly planning")).toBeVisible();
    await expect(page.getByText("2026-09-25")).toBeVisible();
  });

  test("weekly planning walks five steps from last week's time to next week's objectives", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    const errors = watchConsole(page);
    await gotoPreview(page);
    await page.locator("aside nav").getByRole("button", { name: "Work overview", exact: true }).click();

    await expect(page.getByText("Weekly planning", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Time by channel" })).toBeVisible();
    // The fixture week names the client, a project and neither, so all three
    // channels are rendered from real classification rather than placeholders.
    await expect(page.getByText("Client work", { exact: true })).toBeVisible();
    await expect(page.getByText("Own projects", { exact: true })).toBeVisible();
    await expect(page.getByText("Admin and other", { exact: true })).toBeVisible();

    const next = page.getByRole("button", { name: "Next", exact: true });
    const back = page.getByRole("button", { name: "Back", exact: true });
    await expect(back).toBeDisabled();

    for (const heading of [
      "What you finished",
      "Carry forward",
      "Next week's objectives",
      "Week summary",
    ]) {
      await next.click();
      await expect(page.getByRole("heading", { level: 3, name: heading })).toBeVisible();
    }
    await expect(next).toBeDisabled();

    // Mutations are disabled in the public preview, so the flow reads without
    // writing.
    await expect(page.getByRole("button", { name: "Complete week", exact: true })).toBeDisabled();

    await back.click();
    await expect(page.getByRole("heading", { level: 3, name: "Next week's objectives" })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Subscriptions group comparable services and show every renewal", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    await page.locator("aside nav").getByRole("button", { name: "Subscriptions", exact: true }).click();
    const netflix = page.getByRole("listitem").filter({ hasText: "Netflix" }).filter({ hasText: "Entertainment" });
    await expect(netflix).toContainText("Entertainment");
    await expect(netflix).toContainText("Optional");
    await expect(netflix).toContainText("in 8d");
    const figma = page.getByRole("listitem").filter({ hasText: "Figma" });
    await expect(figma).toContainText("Development");
    await expect(figma).toContainText("Useful");
    await expect(figma).toContainText("in 120d");
  });

});
