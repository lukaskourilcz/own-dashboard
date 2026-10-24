import { expect, test } from "@playwright/test";
import { gotoPreview, stubBackend } from "./helpers";
import { settings } from "../src/lib/i18n/sections/settings";
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: theme, language and currency follow real storage events between tabs`, async ({ page, context }) => {
    await gotoPreview(page, { lang, theme: "light" }); await page.goto("/dev-preview?tab=settings");
    const other = await context.newPage(); await stubBackend(other); await other.goto("/dev-preview?tab=settings");
    let writes = 0;
    for (const tab of [page, other]) await tab.route("**/api/user/preferences", route => { writes++; return route.fulfill({ json: { ok: true } }); });
    await page.getByRole("button", { name: settings[lang].dark, exact: true }).click();
    await expect(other.locator("html")).toHaveClass(/dark/); await expect(other.getByRole("button", { name: settings[lang].dark, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(other.locator(`button[aria-label="${settings[lang].switchToLight}"]`)).toHaveCount(1);
    await page.getByRole("button", { name: "EUR", exact: true }).click(); await expect(other.getByRole("button", { name: "EUR", exact: true })).toHaveAttribute("aria-pressed", "true");
    const target = lang === "en" ? "cs" : "en";
    await page.getByRole("button", { name: lang === "en" ? settings.en.czech : settings.cs.english, exact: true }).click();
    await expect(other.locator("html")).toHaveAttribute("lang", target);
    await expect(other.locator(`button[aria-label="${settings[target].switchToLight}"]`)).toHaveCount(1);
    await other.getByRole("button", { name: settings[target].light, exact: true }).click(); await expect(page.locator("html")).not.toHaveClass(/dark/);
    expect(writes).toBe(0); await other.close();
  });
}
