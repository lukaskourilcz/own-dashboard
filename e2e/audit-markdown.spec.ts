import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { professional } from "../src/lib/i18n/sections/professional";
import { common } from "../src/lib/i18n/sections/common";
const code = "const documentedValue = '" + "wide-code-".repeat(50) + "';";
const document = `# Fixture document\n\n## Review section\n\n**Readable text** and [valid link](https://example.com).\n\n[Unsafe credential link](https://user:pass@example.com/)\n\n| Field | Value |\n| --- | ---: |\n| Amount | 10 |\n\n\x60\x60\x60js\n${code}\n\x60\x60\x60\n\n${"[".repeat(20000)}`;
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: repository documents expose headings, safe links and keyboard scrolling at every target width`, async ({ page }) => {
    const errors = watchConsole(page); await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.route("**/api/github/file?**", route => route.fulfill({ json: { content: document, sha: "a".repeat(40), html_url: "https://github.com/fixture/repo/blob/main/scaling.md" } }));
    for (const tab of ["scaling", "monetization", "knowledge"]) {
      await page.goto(`/dev-preview?project=own-dashboard&projectTab=${tab}&repositories=live`);
      const panel = page.getByRole("tabpanel"); await expect(panel.getByRole("heading", { name: "Fixture document", level: 3, exact: true })).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Review section", level: 4, exact: true })).toBeVisible();
      await expect(panel.getByRole("link", { name: "valid link", exact: true })).toHaveAttribute("href", "https://example.com/"); await expect(panel.getByRole("link", { name: "Unsafe credential link", exact: true })).toHaveCount(0);
      const table = panel.getByRole("region", { name: common[lang].documentTable, exact: true }), pre = panel.getByRole("region", { name: common[lang].documentCode, exact: true });
      await expect(table.getByRole("table", { name: common[lang].documentTable, exact: true })).toBeVisible(); await table.focus(); await expect(table).toBeFocused();
      for (const width of [360, 430, 768, 1024, 1440, 1728]) {
        await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const card = pre.locator("xpath=ancestor::div[contains(@class, 'max-w-3xl')][last()]");
        const box = await card.boundingBox(); expect(box).not.toBeNull(); expect(box!.width).toBeLessThanOrEqual(768);
        if (width < 640) {
          const description = professional[lang][tab === "knowledge" ? "aboutProjectDescription" : tab === "scaling" ? "scalingDescription" : "monetizationDescription"];
          const text = await panel.getByText(description, { exact: true }).boundingBox(); expect(text).not.toBeNull(); expect(text!.width).toBeGreaterThan(box!.width * 0.75);
        }
        const parent = await card.locator("..").boundingBox(); expect(parent).not.toBeNull(); expect(Math.abs(box!.x + box!.width / 2 - parent!.x - parent!.width / 2)).toBeLessThanOrEqual(1);
      }
      // Test native keyboard scrolling once per document after the width
      // sequence, so a previous viewport's scroll animation cannot race it.
      await page.setViewportSize({ width: 360, height: 1000 });
      await pre.focus(); await expect(pre).toBeFocused();
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await pre.evaluate(element => { element.scrollLeft = 0; }); await expect.poll(() => pre.evaluate(element => element.scrollLeft)).toBe(0);
      await page.keyboard.press("ArrowRight"); await expect.poll(() => pre.evaluate(element => element.scrollLeft), { message: `${lang}/${tab}: keyboard code scrolling` }).toBeGreaterThan(0);
      if (lang === "cs" && tab === "scaling") {
        for (const width of [1440, 360]) {
          await page.setViewportSize({ width, height: 1000 });
          await panel.getByRole("heading", { name: professional[lang].projectScaling, level: 2, exact: true }).scrollIntoViewIfNeeded();
          await page.screenshot({ path: `/tmp/app-audit-markdown-cs-${width}.png` });
        }
      }
      expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="tabpanel"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
}
