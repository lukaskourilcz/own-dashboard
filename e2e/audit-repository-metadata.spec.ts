import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { professional } from "../src/lib/i18n/sections/professional";
import { github } from "../src/lib/i18n/sections/github";
const repo = { id: 1001, name: "renamed-own-dashboard", full_name: "lukaskourilcz/renamed-own-dashboard", owner: "lukaskourilcz", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/lukaskourilcz/renamed-own-dashboard", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: a scoped repository outside the recent catalog retries and retains confirmed metadata`, async ({ page }) => {
    const t = github[lang], errors = watchConsole(page); await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    let catalog = 0, lookups = 0;
    await page.route("**/api/vercel/analytics**", route => route.fulfill({ json: { kind: "unconfigured" } }));
    await page.route("**/api/github/repos", route => { catalog++; return route.fulfill({ json: { repos: [], hasMore: true } }); });
    await page.route("**/api/github/repos/lookup?**", route => {
      lookups++; expect(new URL(route.request().url()).searchParams.get("repo")).toBe("lukaskourilcz/own-dashboard");
      return route.fulfill(lookups === 1 || lookups === 3 ? { status: 503, json: { error: "Fixture unavailable" } } : { json: { id: repo.id, full_name: repo.full_name, repo } });
    });
    await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=repository");
    await expect(page.getByText(t.loadErr, { exact: true })).toBeVisible(); await page.getByRole("button", { name: t.refresh, exact: true }).click();
    await expect(page.getByRole("button", { name: t.writeFile, exact: true })).toBeVisible(); await expect(page.locator(`a[href="${repo.html_url}"]`).last()).toBeVisible();
    expect(catalog).toBe(0); expect(lookups).toBe(2);
    await page.getByRole("button", { name: t.refresh, exact: true }).click(); await expect(page.getByText(t.cachedReadFailed, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: t.writeFile, exact: true })).toBeVisible(); await expect(page.getByText(t.repositoryUnavailable, { exact: true })).toHaveCount(0); expect(catalog).toBe(0); expect(lookups).toBe(3);
    expect(errors.filter(error => !(error.includes("status of 503") && error.includes("/api/github/repos/lookup?")))).toEqual([]);
  });
  test(`${lang}: archived scoped repositories retain local controls and reflow`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "Six explicit widths include mobile.");
    const t = github[lang], errors = watchConsole(page); await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.route("**/api/vercel/analytics**", route => route.fulfill({ json: { kind: "unconfigured" } }));
    await page.route("**/api/github/repos/lookup?**", route => route.fulfill({ json: { id: repo.id, full_name: repo.full_name, repo: { ...repo, archived: true } } }));
    await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=repository");
    await expect(page.getByRole("button", { name: t.writeFile, exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: t.saveNotes, exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: t.addNote, exact: true })).toBeEnabled();
    await expect(page.getByText(t.archivedReadOnly, { exact: true })).toBeVisible();
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 360 || width === 1440) expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
}

test("a cold project URL serves the requested tab before JavaScript hydrates", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  try {
    const page = await context.newPage();
    await page.goto("/dev-preview?project=own-dashboard&projectTab=repository");
    await expect(page.getByRole("tab", { name: professional.cs.projectRepository, exact: true, includeHidden: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: professional.cs.projectOverview, exact: true, includeHidden: true })).toHaveAttribute("aria-selected", "false");
  } finally { await context.close(); }
});
