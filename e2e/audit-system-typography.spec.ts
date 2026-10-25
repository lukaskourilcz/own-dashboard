import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";

for (const lang of ["en", "cs"] as const) test(`${lang}: native UI typography is shared by the note editor at six widths`, async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "The explicit six-width matrix includes mobile.");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  const errors = watchConsole(page);
  await page.goto("/dev-preview?tab=notes");
  const editor = page.locator('[contenteditable="true"]').first(); await expect(editor).toBeVisible();
  const families = await editor.evaluate(el => ({ body: getComputedStyle(document.body).fontFamily, editor: getComputedStyle(el).fontFamily }));
  expect(families.editor).toBe(families.body); expect(families.body.split(",")[0]).toBe("-apple-system");
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 360) {
      const firstNote = page.getByRole("button", { name: /Project ideas/ });
      if (await firstNote.isVisible()) await firstNote.click();
    }
    await expect(editor).toBeVisible();
    expect(await editor.evaluate(el => getComputedStyle(el).fontFamily)).toBe(families.body);
    if (width === 360 || width === 1440) {
      expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      await page.locator("#main-content").screenshot({ path: `/tmp/app-audit-font-${lang}-${width}.png` });
    }
  }
  expect(errors).toEqual([]);
});
