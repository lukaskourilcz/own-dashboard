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

  test("home shows lifelike fixture content and no removed personal navigation", async ({ page }) => {
    await gotoPreview(page);
    // Greeting hero addresses the fixture user by first name.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Jan");
    // KPI + customize affordance present.
    await expect(
      page.getByRole("button", { name: "Customize" }),
    ).toBeVisible();
    const sidebar = page.locator("aside");
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
    await expect(nav.getByRole("button", { name: "Home" })).toBeVisible();
    if (testInfo.project.name === "mobile") {
      await nav.getByRole("button", { name: "More", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "All areas" }).getByRole("button", { name: "Opportunities", exact: true })).toBeVisible();
    } else {
      await expect(nav.getByRole("button", { name: "Opportunities", exact: true })).toBeVisible();
    }
  });

  test("project workspace exposes the unified project context", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "covered once on desktop");
    await gotoPreview(page);
    await page.goto("/dev-preview?project=aifirst");
    await expect(page.getByRole("heading", { level: 1, name: "aifirst" })).toBeVisible();
    for (const tab of ["Overview", "Tasks", "Activity", "Repository", "Operations", "Finance", "Knowledge"]) {
      await expect(page.getByRole("tab", { name: tab })).toBeVisible();
    }
    await page.getByRole("tab", { name: "Operations" }).click();
    await expect(page.getByText("Daily article generation")).toBeVisible();
    await page.getByRole("tab", { name: "Finance" }).click();
    await expect(page.getByText("Supabase", { exact: true })).toBeVisible();
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
