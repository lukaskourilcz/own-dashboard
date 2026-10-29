import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, stubBackend, watchConsole } from "./helpers";
import { github } from "../src/lib/i18n/sections/github";
const base = { name: "own-dashboard", owner: "owner", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/owner/own-dashboard", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
for (const lang of ["en", "cs"] as const) test(`${lang}: Projects keeps unlisted repositories and distinguishes device/server saves`, async ({ page, context }) => {
  const t = github[lang], errors = watchConsole(page); await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  await page.evaluate(() => localStorage.setItem("visibleRepoIds", '["123","999"]'));
  const repos = [{ ...base, id: 123, full_name: "owner/own-dashboard" }, { ...base, id: 456, name: "second-project", html_url: "https://github.com/owner/second-project", full_name: "owner/second-project" }, ...Array.from({ length: 40 }, (_, i) => ({ ...base, id: 1000 + i, name: `long-repository-name-for-project-${i}`, html_url: `https://github.com/owner/long-repository-name-for-project-${i}`, full_name: `owner/long-repository-name-for-project-${i}` }))];
  await page.route("**/api/github/repos", route => route.fulfill({ json: { repos } }));
  let attempts = 0, release!: () => void;
  await page.route("**/api/user/preferences", async route => {
    attempts++; expect(route.request().postDataJSON()).toEqual({ visible_repo_ids: [["123", "456", "999"], ["456", "999"], ["123", "456"]][attempts - 1] });
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: attempts === 2 ? 200 : 503, json: attempts === 2 ? { ok: true, ownerId: route.request().headers()["x-own-dashboard-owner"], saved: { visible_repo_ids: ["456", "999"] } } : { error: "unavailable" } });
  });
  await page.goto("/dev-preview?tab=projects&repositories=live"); await page.getByRole("button", { name: t.filter, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: t.filterTitle, exact: true }); await expect(dialog.getByText(t.filterUnlisted(1), { exact: true })).toBeVisible();
  const first = dialog.getByRole("button", { name: "owner/own-dashboard", exact: true }), second = dialog.getByRole("button", { name: "owner/second-project", exact: true });
  await expect(first).toHaveAttribute("aria-pressed", "true"); await expect(second).toHaveAttribute("aria-pressed", "false"); await second.click();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const save = await dialog.getByRole("button", { name: t.save, exact: true }).boundingBox(); expect(save!.x).toBeGreaterThanOrEqual(0); expect(save!.x + save!.width).toBeLessThanOrEqual(width); expect(save!.y + save!.height).toBeLessThanOrEqual(900);
    if (width === 360 || width === 1440) expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  }
  await dialog.getByRole("button", { name: t.save, exact: true }).click(); await expect(second).toBeDisabled(); await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); await expect.poll(() => typeof release).toBe("function"); release();
  await expect(dialog).not.toBeVisible(); await expect(page.getByText(t.filterLocalOnly, { exact: true })).toBeVisible(); expect(await page.evaluate(() => JSON.parse(localStorage.getItem("visibleRepoIds")!))).toEqual(["123", "456", "999"]);
  await page.getByRole("button", { name: t.filter, exact: true }).click(); await first.click();
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === "visibleRepoIds") throw new DOMException("Quota", "QuotaExceededError"); original.call(this, key, value); }; });
  release = undefined as unknown as () => void; await dialog.getByRole("button", { name: t.save, exact: true }).click(); await expect.poll(() => typeof release).toBe("function"); release();
  await expect(dialog).not.toBeVisible(); await expect(page.getByText(t.filterServerOnly, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: t.filter, exact: true }).click(); await expect(first).toHaveAttribute("aria-pressed", "false"); await expect(second).toHaveAttribute("aria-pressed", "true");
  const other = await context.newPage(); await stubBackend(other); await other.goto("/dev-preview?tab=settings"); await other.evaluate(() => localStorage.setItem("visibleRepoIds", '["123"]'));
  await expect(dialog.getByText(t.filterChanged, { exact: true })).toBeVisible(); await expect(dialog.getByRole("button", { name: t.save, exact: true })).toBeDisabled(); await expect(second).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: t.filterReload, exact: true }).click(); await expect(first).toHaveAttribute("aria-pressed", "true"); await expect(second).toHaveAttribute("aria-pressed", "false"); await other.close();
  await second.click(); release = undefined as unknown as () => void;
  await dialog.getByRole("button", { name: t.save, exact: true }).click(); await expect.poll(() => typeof release).toBe("function"); release();
  await expect(page.getByText(t.filterErr, { exact: true })).toBeVisible(); await expect(dialog).toBeVisible(); await expect(second).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("visibleRepoIds")!))).toEqual(["123"]);
  expect(attempts).toBe(3); expect(errors.filter(error => !(error.includes("status of 503") && error.endsWith("/api/user/preferences)")))).toEqual([]);
});
