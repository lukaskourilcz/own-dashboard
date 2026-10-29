import { expect, test, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { professional } from "../src/lib/i18n/sections/professional";
import { common } from "../src/lib/i18n/sections/common";
const commit = { sha: "a".repeat(40), shortSha: "aaaaaaa", message: "Reviewed repository history", author: "fixture-author".repeat(20), date: "2026-10-24T00:00:00Z", url: `https://github.com/owner/fixture/commit/${"a".repeat(40)}` };
async function reflow(page: Page, capture?: Locator) {
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (capture && (width === 360 || width === 1440)) await capture.screenshot({ path: `docs/reports/app-wide-audit-2026-10-23/assets/github-history-cs-${width}.png` });
    if (width === 360 || width === 1440) expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
}
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: project history distinguishes failed refresh and a confirmed missing repository`, async ({ page }, info) => {
    const p = professional[lang], errors = watchConsole(page); await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    let reads = 0, catalog = 0, analytics = 0;
    await page.route("**/api/github/repos", route => { catalog++; return route.fulfill({ json: { repos: [], hasMore: false } }); });
    await page.route("**/api/vercel/analytics**", route => { analytics++; return route.fulfill({ json: { kind: "unconfigured" } }); });
    await page.route("**/api/github/commits?**", route => {
      reads++;
      return route.fulfill(reads === 1 || reads === 3 ? { status: 503, json: { error: "Fixture unavailable" } } : reads === 4 ? { status: 404, json: { error: "Fixture not visible" } } : { json: { commits: [commit], codeVolume: { additions: 1234567890123, deletions: 9876543210123, weeks: 1 } } });
    });
    await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=activity");
    const history = page.getByRole("heading", { name: p.githubActivity, exact: true }).locator("..").locator("..");
    await expect(history.getByText(p.githubError, { exact: true })).toBeVisible(); await history.getByRole("button", { name: common[lang].retry, exact: true }).click();
    await expect(history.getByRole("link", { name: commit.message, exact: true })).toBeVisible(); await expect(history.getByText(p.codeVolumeLabel(1), { exact: true })).toBeVisible();
    await reflow(page, lang === "cs" && info.project.name === "desktop" ? history : undefined); expect(catalog).toBe(0); expect(analytics).toBe(0);
    await history.getByRole("button", { name: p.githubRefresh, exact: true }).click(); await expect(history.getByText(p.githubCachedReadFailed, { exact: true })).toBeVisible(); await expect(history.getByRole("link", { name: commit.message, exact: true })).toBeVisible();
    await history.getByRole("button", { name: common[lang].retry, exact: true }).click(); await expect(history.getByText(p.githubRepositoryUnavailable, { exact: true })).toBeVisible(); await expect(history.getByRole("link", { name: commit.message, exact: true })).toHaveCount(0); expect(reads).toBe(4);
    expect(errors.filter(error => !(/status of (503|404)/.test(error) && error.includes("/api/github/commits?")))).toEqual([]);
  });
  test(`${lang}: Work discloses capped and partial history and retains its last confirmed feed`, async ({ page }) => {
    const p = professional[lang], errors = watchConsole(page); await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" }); let reads = 0, fail = false;
    await page.route("**/api/github/activity", route => {
      reads++; return route.fulfill(!fail ? { json: { connected: true, items: [{ ...commit, repo: "owner/fixture", projectId: "33333333-3333-4333-8333-333333333333", projectName: "Fixture project", projectSlug: "fixture" }], scope: { projects: 10, totalProjects: 25, repositories: 2, unavailableRepositories: 1 } } } : { status: 503, json: { error: "Fixture unavailable" } });
    });
    await page.goto("/dev-preview?tab=work&repositories=live");
    const history = page.getByRole("heading", { name: p.crossProjectActivity, exact: true }).locator("..").locator("..");
    await expect(history.getByText(p.githubScope(10, 25, 2), { exact: true })).toBeVisible(); await expect(history.getByText(p.githubPartial(1), { exact: true })).toBeVisible(); await expect(history.getByRole("link", { name: commit.message, exact: true })).toBeVisible();
    await reflow(page); const beforeRefresh = reads; fail = true; await history.getByRole("button", { name: p.githubRefresh, exact: true }).click();
    await expect(history.getByText(p.githubCachedReadFailed, { exact: true })).toBeVisible(); await expect(history.getByRole("link", { name: commit.message, exact: true })).toBeVisible(); expect(reads).toBe(beforeRefresh + 1);
    expect(errors.filter(error => !(error.includes("status of 503") && error.includes("/api/github/activity")))).toEqual([]);
  });
  test(`${lang}: the ordinary preview does not request live commit history`, async ({ page }) => {
    await gotoPreview(page, { lang }); let reads = 0;
    await page.route("**/api/github/activity", route => { reads++; return route.fulfill({ status: 503 }); });
    await page.goto("/dev-preview?tab=work"); await expect(page.getByText(professional[lang].githubPreview, { exact: true })).toBeVisible(); expect(reads).toBe(0);
  });
}
