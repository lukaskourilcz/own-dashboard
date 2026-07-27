import { test, expect } from "@playwright/test";
import { gotoPreview, watchConsole } from "./helpers";

// Section labels in English (gotoPreview forces lang=en).
const TABS = [
  "Home",
  "Inbox",
  "Work overview",
  "Projects",
  "Opportunities",
  "Clients",
  "Agents",
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
  "Links",
  "References",
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
        sidebar.getByRole("link", { name: "aifirst", exact: true }),
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
    await page.goto("/dev-preview?project=aifirst");
    await expect(page.getByRole("heading", { level: 1, name: "aifirst" })).toBeVisible();
    for (const tab of ["Overview", "Tasks", "Activity", "Communication", "Repository", "Finance", "Knowledge", "Scaling", "Monetization"]) {
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

    await sidebar.getByRole("link", { name: "aifirst", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "aifirst" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/projects\/aifirst$/);

    await sidebar.getByRole("button", { name: "Projects", exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" }),
    ).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Project" })).toBeVisible();
    await expect(page).toHaveURL(/\/projects$/);
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
      .getByRole("link", { name: "aifirst", exact: true })
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
    await expect(main.getByText("aifirst", { exact: true }).first()).toBeVisible();
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

  test("Career uses sortable operational columns and Agents exposes the VPS queue", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    const sidebar = page.locator("aside nav");
    await sidebar.getByRole("button", { name: "Career" }).click();
    for (const heading of ["Position", "Company", "Match", "Remote", "Location", "Source / found"]) {
      await expect(page.getByRole("columnheader", { name: heading })).toBeVisible();
    }
    await page.getByLabel("Sort").click();
    await page.getByRole("option", { name: "Remote first" }).click();
    await page.getByLabel("Sort").click();
    await page.getByRole("option", { name: "Location A–Z" }).click();
    await sidebar.getByRole("button", { name: "Agents" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
    await expect(page.getByText("Validate the dashboard release")).toBeVisible();
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

  test("read-only AI search shows cited evidence after explicit consent", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await page.route("**/api/quick-add", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ action: { kind: "search", question: "Which invoices are unpaid?" } }) }));
    await page.route("**/api/ai/search", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answer: { answer: "Invoice 2026-001 is issued and unpaid.", evidence: [{ claim: "The invoice is still issued.", sourceIds: ["invoices:inv1"] }], limitations: [] } }) }));
    await gotoPreview(page);
    page.once("dialog", (dialog) => dialog.accept());
    const input = page.getByPlaceholder(/Add an action/);
    await input.fill("Which invoices are unpaid?");
    await input.press("Enter");
    await expect(page.getByText("Invoice 2026-001 is issued and unpaid.")).toBeVisible();
    await expect(page.getByText("invoices:inv1")).toBeVisible();
  });

  test("Career and knowledge copilots render proposals without writing", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await page.route("**/api/ai/career-copilot", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ review: { summary: "Grounded fit.", evidence: [{ claim: "Project evidence matches React.", sourceIds: ["projects:proj-aifirst"] }], gaps: ["No employment metric."], suggestions: ["Verify the draft."], coverLetterDraft: "Evidence-bound draft", interviewQuestions: ["Describe a project trade-off."] } }) }));
    await page.route("**/api/ai/knowledge-review", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ review: { summary: "One maintenance proposal.", proposals: [{ kind: "candidate_task", title: "Resolve analytics question", reason: "A note leaves it open.", sourceIds: ["notes:n1"] }] } }) }));
    await gotoPreview(page);
    const sidebar = page.locator("aside nav");
    await sidebar.getByRole("button", { name: "Career" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Career copilot" }).first().click();
    await page.getByRole("button", { name: "Generate evidence review" }).click();
    await expect(page.getByText("Evidence-bound draft")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await sidebar.getByRole("button", { name: "Notes" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "AI maintenance" }).click();
    await expect(page.getByText("Resolve analytics question")).toBeVisible();
  });
});
