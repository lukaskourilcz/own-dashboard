import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

async function openPrompts(page: Page, mobile: boolean, label = "Prompts") {
  if (mobile) {
    await page.getByTestId("mobile-nav").getByRole("button", { name: /^(More|Více)$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
  } else {
    await page.locator("aside nav").getByRole("button", { name: label, exact: true }).click();
  }
}

test("prompts are grouped by kind and copy with the project and its links", async ({ page, context }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoPreview(page);
  await openPrompts(page, testInfo.project.name === "mobile");

  const main = page.locator("#main-content");
  const headings = await main.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings.map((text) => text.replace(/\d+ prompts?$/, "").trim())).toEqual([
    "Audit",
    "Analysis",
    "Documentation",
    "SEO",
    "Marketing",
  ]);
  await expect(main.locator('[data-prompt-card="pr4"]').getByText("Public", { exact: true })).toBeVisible();

  // Kind filter chips narrow the list.
  await main.getByRole("group", { name: "Filter by kind" }).getByRole("button", { name: "SEO", exact: true }).click();
  await expect(main.locator("[data-prompt-card]")).toHaveCount(1);

  // Collapsing a group hides its cards.
  await main.getByRole("group", { name: "Filter by kind" }).getByRole("button", { name: "All kinds", exact: true }).click();
  const audit = main.getByRole("heading", { level: 2, name: /^Audit/ }).getByRole("button");
  await audit.click();
  await expect(audit).toHaveAttribute("aria-expanded", "false");
  await expect(main.locator('[data-prompt-card="pr1"]')).toBeHidden();
  await audit.click();

  // Copy preview: default project, kind-matched project links, no hosting link.
  await main.getByRole("button", { name: "Copy with project and links: SEO check" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Copy: SEO check" });
  await expect(dialog).toBeVisible();
  const preview = dialog.getByLabel("Preview", { exact: true });
  const text = await preview.inputValue();
  expect(text).toContain("Run an SEO check of DNESKAi at https://aifirst.example.com.");
  expect(text).toContain("## Project\nDNESKAi, lukaskourilcz/aifirst, https://aifirst.example.com");
  expect(text).toContain("- PageSpeed Insights — https://pagespeed.web.dev — Run it on the Today page first.");
  expect(text).toContain("- Google Search Console — https://search.google.com/search-console — Checks that each daily edition is indexed.");
  expect(text).not.toContain("Vercel");
  if (testInfo.project.name === "desktop") {
    expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  }

  // Without a project the placeholders stay and the Project block goes.
  await dialog.getByLabel("Project", { exact: true }).click();
  await page.getByRole("option", { name: "No project (keep placeholders)", exact: true }).click();
  const bare = await preview.inputValue();
  expect(bare).toContain("{{project.name}}");
  expect(bare).not.toContain("## Project");

  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(bare);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("the prompt copy preview works by keyboard and in Czech at 360 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the width is set explicitly");
  await page.setViewportSize({ width: 360, height: 800 });
  await gotoPreview(page, { lang: "cs", theme: "dark" });
  await openPrompts(page, true, "Prompty");
  const main = page.locator("#main-content");
  await expect(main.getByRole("heading", { level: 2, name: /Audit projektu/ })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: /Analýza projektu/ })).toBeVisible();
  const copy = main.getByRole("button", { name: "Kopírovat s projektem a odkazy: SEO check" }).first();
  await copy.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Kopírovat: SEO check" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Náhled", { exact: true })).toHaveValue(/## Links to consult/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(copy).toBeFocused();
});

test("the project workspace copies prompts with that project", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered once on desktop");
  await gotoPreview(page);
  await page.goto("/dev-preview?project=devshark");
  await page.getByRole("tab", { name: "Knowledge" }).click();
  await page.locator("summary", { hasText: /^SEO/ }).click();
  await page.getByRole("button", { name: "Copy with project and links: SEO check" }).click();
  const dialog = page.getByRole("dialog", { name: "Copy: SEO check" });
  const text = await dialog.getByLabel("Preview", { exact: true }).inputValue();
  expect(text).toContain("Run an SEO check of devShark");
  expect(text).toContain("## Project\ndevShark, lukaskourilcz/react-express-app");
  // devShark has no SEO links of its own; only the prompt's link is listed.
  expect(text).toContain("PageSpeed Insights");
  expect(text).not.toContain("Vercel");
  await expect(dialog.getByLabel("Project", { exact: true })).toHaveCount(0);
});
