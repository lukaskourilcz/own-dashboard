import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { settings } from "../src/lib/i18n/sections/settings";

for (const lang of ["en", "cs"] as const) test(`Settings has one integration explanation and reflows at six widths (${lang})`, async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "Six explicit widths include mobile.");
  const errors = watchConsole(page);
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  await page.goto("/dev-preview?tab=settings");
  const card = page.locator("#settings-integrations");
  await expect(card.getByText(settings[lang].integrationsPreview, { exact: true })).toBeVisible();
  await expect(card.getByText(settings[lang].integrationsDesc, { exact: true })).toHaveCount(1);
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const frame = await page.locator(".settings-frame").boundingBox(); expect(frame).not.toBeNull();
    if (width >= 1024) expect(frame!.width).toBeLessThanOrEqual(1152);
    if (width === 360 || width === 1440) {
      const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations).toEqual([]);
    }
  }
  expect(errors).toEqual([]);
});
