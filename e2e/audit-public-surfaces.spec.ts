import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { stubBackend, watchConsole } from "./helpers";
import { login } from "../src/lib/i18n/sections/login";
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];
for (const lang of ["en", "cs"] as const) for (const theme of ["light", "dark"] as const) {
  test(`${lang}/${theme}: compact login keeps sign-in reachable across six widths`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the test explicitly covers narrow and wide viewports");
    const errors = watchConsole(page);
    await page.emulateMedia({ reducedMotion: "reduce" }); await stubBackend(page);
    await page.addInitScript(({ lang, theme }) => { localStorage.setItem("lang", lang); localStorage.setItem("theme", theme); }, { lang, theme });
    await page.goto("/login?error=auth");
    const button = page.getByRole("button", { name: login[lang].continueWithGoogle, exact: true });
    await expect(button).toBeEnabled(); await expect(page.locator('p[role="alert"]')).toHaveText(login[lang].authError);
    await expect(page.getByText(login[lang].privateSystem, { exact: true })).toHaveCount(1);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const bounds = await button.boundingBox(); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(800); expect(bounds!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 40);
      if (width === 360 || width === 1440) {
        expect((await new AxeBuilder({ page: page as unknown as AxePage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: `/tmp/app-audit-login-${lang}-${theme}-${width}.png`, fullPage: true });
      }
    }
    expect(errors).toEqual([]);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`${colorScheme}: blocked preference storage still uses the system theme`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "validate pre-hydration bootstrap once per theme");
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" }); await stubBackend(page);
    await page.addInitScript(() => { const original = Storage.prototype.getItem; Object.defineProperty(Storage.prototype, "getItem", { value: function (key: string) { if (key === "theme" || key === "lang") throw new DOMException("Synthetic blocked preferences", "SecurityError"); return original.call(this, key); } }); });
    await page.goto("/login");
    await expect(page.getByRole("button", { name: login.cs.continueWithGoogle, exact: true })).toBeEnabled();
    expect(await page.locator("html").evaluate(element => element.classList.contains("dark"))).toBe(colorScheme === "dark");
  });
}
