import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";
import { portfolio } from "../src/lib/i18n/sections/portfolio";
import { projects } from "../src/lib/i18n/sections/projects";
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: Money keeps distinct headings, keyboard-accessible tables and static currency changes`, async ({ page }) => {
    const f = portfolio[lang].finance; await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.goto("/dev-preview?tab=money");
    for (const name of [f.timelineTitle, f.byProjectTitle, f.byVendorTitle, f.projectDetails, f.subscriptionDetails]) await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(1);
    await expect(page.getByText(f.timelineHint, { exact: true })).toBeVisible(); await expect(page.getByText(f.allocationsHint, { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: f.projectDetails, exact: true }).getByRole("button", { name: "Harbor Bakery website", exact: true })).toBeVisible();
    const currency = page.getByRole("combobox", { name: projects[lang].displayIn, exact: true }); await currency.click(); await page.getByRole("option", { name: "EUR", exact: true }).click(); await expect(currency).toHaveText("EUR");
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      for (const name of [f.projectDetails, f.subscriptionDetails]) {
        const region = page.getByRole("region", { name, exact: true }); await expect(region).toBeVisible();
        if (width === 360) { await region.focus(); await page.keyboard.press("ArrowRight"); await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0); await region.evaluate(element => { element.scrollLeft = 0; }); }
      }
      if (width < 768) await expect(page.getByRole("region", { name: f.projectDetails, exact: true }).getByRole("button").first()).toHaveCSS("min-height", "44px");
      if (lang === "cs" && (width === 360 || width === 1440)) await page.locator("main").screenshot({ path: `/tmp/app-audit-dev-finance-cs-${width}.png` });
    }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  });
}
