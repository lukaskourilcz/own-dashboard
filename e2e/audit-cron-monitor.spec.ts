import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";
import { dashboard } from "../src/lib/i18n/sections/dashboard";
import { common } from "../src/lib/i18n/sections/common";
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: history recovers, renders each run once and bounds visible rows`, async ({ page }) => {
    const c = dashboard[lang].crons; await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.addInitScript(() => localStorage.setItem("dashboardLayout", JSON.stringify(["crons"])));
    let available = false, reads = 0;
    const today = new Date(), previous = new Date(today.getTime() - 13 * 86400000);
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, name: `Synthetic run ${i}`, endpoint: "/api/fixture", status: i === 1 ? "failure" : "success", source: "app", detail: "", fired_at: (i < 75 ? today : previous).toISOString(), cron_id: null }));
    await page.route("**/api/crons/runs?**", route => { reads++; return !available ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { days: 14, partial: true, runs: rows } }); });
    await page.goto("/dev-preview?monitoring=live");
    await expect(page.getByText(c.unavailable, { exact: true })).toBeVisible(); await expect(page.getByText(c.emptyToday, { exact: true })).toHaveCount(0);
    available = true; await page.getByRole("button", { name: common[lang].retry, exact: true }).click();
    await expect(page.getByText(c.partial, { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic run 0", { exact: true })).toHaveCount(1); await expect(page.getByText("Synthetic run 9", { exact: true })).toBeVisible(); await expect(page.getByText("Synthetic run 10", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: c.showMore(65), exact: true }).click(); await expect(page.getByText("Synthetic run 19", { exact: true })).toBeVisible();
    const priorReads = reads; const prev = page.getByRole("button", { name: c.prevDay, exact: true }); const next = page.getByRole("button", { name: c.nextDay, exact: true });
    await prev.focus(); await page.keyboard.press("Enter"); await expect(page.getByText(c.partialEmpty, { exact: true })).toBeVisible();
    await next.click(); await expect(page.getByText("Synthetic run 0", { exact: true })).toBeVisible(); await expect(page.getByText("Synthetic run 10", { exact: true })).toHaveCount(0); expect(reads).toBe(priorReads);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if (width < 768) for (const button of [prev, next]) { await expect(button).toHaveCSS("height", "44px"); const box = (await button.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); }
      if (lang === "cs" && (width === 360 || width === 1440)) await page.getByRole("heading", { name: c.title, exact: true }).locator("..").locator("..").screenshot({ path: `/tmp/app-audit-cron-monitor-cs-${width}.png` });
    }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  });
}
