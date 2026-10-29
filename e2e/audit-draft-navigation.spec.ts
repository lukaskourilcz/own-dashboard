import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, stubGithubRepositories, watchConsole } from "./helpers";
import { github } from "../src/lib/i18n/sections/github";
import { common } from "../src/lib/i18n/sections/common";
import { professional } from "../src/lib/i18n/sections/professional";
import { nav } from "../src/lib/i18n/sections/nav";
const repo = { id: 1001, name: "own-dashboard", full_name: "lukaskourilcz/own-dashboard", owner: "lukaskourilcz", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/lukaskourilcz/own-dashboard", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: file drafts and pending writes survive Back before a confirmed save and exit`, async ({ page }) => {
    const t = github[lang], u = common[lang].unsaved, p = professional[lang], errors = watchConsole(page), originalViewport = page.viewportSize()!;
    await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.route("**/api/vercel/analytics**", route => route.fulfill({ json: { kind: "unconfigured" } }));
    await stubGithubRepositories(page, [repo]);
    let writes = 0, finish: (() => void) | undefined;
    await page.route("**/api/github/commit", async route => {
      const body = route.request().postDataJSON(); expect(body).toMatchObject({ intent: "replace", owner: repo.owner, repo: repo.name, path: "review/draft.md", content: "Retain this local file draft" });
      const attempt = ++writes; await new Promise<void>(resolve => { finish = resolve; });
      return route.fulfill(attempt === 1 ? { status: 503, json: { error: "Synthetic unavailable write" } } : { json: { path: "review/draft.md", updated: true, unchanged: false, commit: { sha: "b".repeat(40), html_url: `${repo.html_url}/commit/${"b".repeat(40)}` }, content: { sha: "a".repeat(40), html_url: `${repo.html_url}/blob/main/review/draft.md` } } });
    });
    await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=repository");
    // Workspace tabs intentionally replace their history entry. Create the
    // actual shell entry through Projects so Back is an in-document exit.
    const mobile = page.getByTestId("mobile-nav");
    if (await mobile.isVisible()) await mobile.getByRole("button", { name: nav[lang].short.projects ?? nav[lang].sections.projects, exact: true }).click();
    else await page.locator("aside").getByRole("button", { name: nav[lang].sections.projects, exact: true }).click();
    await page.locator("main").getByRole("link", { name: "own-dashboard", exact: true }).click();
    await page.getByRole("tab", { name: p.projectRepository, exact: true }).click();
    await page.getByRole("button", { name: t.writeFile, exact: true }).click();
    const file = page.getByRole("dialog", { name: `${t.writeTitle} ${repo.full_name}`, exact: true });
    await file.getByRole("textbox", { name: t.pathLabel, exact: true }).fill("review/draft.md");
    await file.getByRole("textbox", { name: t.contentLabel, exact: true }).fill("Retain this local file draft");
    await page.goBack();
    let guard = page.getByRole("dialog", { name: u.title, exact: true }); await expect(guard).toBeVisible();
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (width === 360 || width === 1440) {
        expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        if (lang === "cs") await guard.screenshot({ path: `/tmp/app-audit-draft-guard-cs-${width}.png` });
      }
    }
    await page.setViewportSize(originalViewport);
    await guard.getByRole("button", { name: u.stay, exact: true }).click();
    await expect(file.getByRole("textbox", { name: t.contentLabel, exact: true })).toHaveValue("Retain this local file draft"); expect(writes).toBe(0);
    await file.getByRole("button", { name: t.commit, exact: true }).click(); await expect.poll(() => writes).toBe(1);
    await page.goBack(); guard = page.getByRole("dialog", { name: u.pendingTitle, exact: true }); await expect(guard).toBeVisible();
    await expect(guard.getByRole("button", { name: u.discard, exact: true })).toBeDisabled(); await expect(guard.getByRole("button", { name: u.save, exact: true })).toBeDisabled();
    if (lang === "cs") await guard.screenshot({ path: `/tmp/app-audit-pending-guard-cs-${originalViewport.width}.png` });
    await guard.getByRole("button", { name: u.stay, exact: true }).click(); await page.keyboard.press("Escape"); await expect(file).toBeVisible();
    finish!(); await expect(file.getByRole("button", { name: t.commit, exact: true })).toBeEnabled();
    await expect(file.getByRole("textbox", { name: t.contentLabel, exact: true })).toHaveValue("Retain this local file draft");
    await page.goBack(); guard = page.getByRole("dialog", { name: u.title, exact: true }); await guard.getByRole("button", { name: u.save, exact: true }).click();
    await expect.poll(() => writes).toBe(2); guard = page.getByRole("dialog", { name: u.pendingTitle, exact: true });
    await expect(guard.getByRole("button", { name: u.stay, exact: true })).toBeDisabled(); await expect(guard.getByRole("button", { name: u.discard, exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(guard).toBeVisible(); finish!();
    await expect(page.locator(".mac-toolbar h1")).toHaveText(nav[lang].sections.projects); await expect(page).toHaveURL(/\/projects$/); await expect(page.getByRole("dialog")).toHaveCount(0); expect(writes).toBe(2);
    expect(errors.filter(error => !(error.includes("status of 503") && error.includes("/api/github/commit")))).toEqual([]);
  });
}
