import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { relink } from "../src/lib/i18n/sections/relink";
import { common } from "../src/lib/i18n/sections/common";
import { calendar } from "../src/lib/i18n/sections/calendar";
import { settings } from "../src/lib/i18n/sections/settings";
async function fixture(page: Page, lang: "en" | "cs") {
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  await page.route("**/api/calendar/events?**", route => route.fulfill({ json: { ok: false, reason: "unauthorized" } }));
  await page.route("**/api/calendar/list", route => route.fulfill({ json: { calendars: [{ id: "primary-id", summary: "Fixture calendar", primary: true }] } }));
  await page.route("**/api/user/preferences", route => route.fulfill({ json: { ok: true, ownerId: route.request().headers()["x-own-dashboard-owner"], saved: { selected_calendar_ids: ["primary"] } } }));
  await page.goto("/dev-preview?tab=calendar&calendar=live");
  // The deterministic shell starts with confirmed fixture events. Saving the
  // picker invalidates them and exercises the live, stubbed read boundary.
  await page.getByRole("button", { name: calendar[lang].primaryLabel, exact: true }).click();
  await expect(page.getByRole("button", { name: "Fixture calendar", exact: false })).toBeVisible();
  await page.getByRole("button", { name: calendar[lang].save, exact: true }).click();
  const button = page.getByRole("button", { name: relink[lang].relinkGoogle, exact: true }); await expect(button).toBeVisible(); return button;
}
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: rejected Google preparation stays on the page with an accessible retry`, async ({ page }) => {
    const errors = watchConsole(page), button = await fixture(page, lang);
    await page.evaluate(() => { crypto.subtle.digest = () => Promise.reject(Error("Private fixture detail")); });
    await button.click(); const message = page.getByRole("alert").filter({ hasText: relink[lang].failed }); await expect(message).toHaveText(relink[lang].failed);
    await expect(button).toBeEnabled(); await expect(button).toHaveAttribute("aria-describedby", (await message.getAttribute("id"))!); await expect(page.locator("body")).not.toContainText("Private fixture detail");
    for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await button.focus(); await expect(button).toBeFocused(); await page.keyboard.press("Enter"); await expect(message).toHaveText(relink[lang].failed); expect(errors).toEqual([]);
  });
  test(`${lang}: an expired Google preparation cannot redirect late and a new explicit attempt uses the auth endpoint`, async ({ page }) => {
    const errors = watchConsole(page); await fixture(page, lang);
    await page.evaluate(() => {
      const saved = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = () => new Promise(resolve => { (window as unknown as { releaseOAuth: () => void }).releaseOAuth = () => { crypto.subtle.digest = saved; resolve(new ArrayBuffer(32)); }; });
    });
    await page.getByRole("button", { name: relink[lang].relinkGoogle, exact: true }).click();
    await expect(page.getByRole("button", { name: common[lang].redirecting, exact: true })).toBeDisabled();
    await expect(page.getByRole("alert").filter({ hasText: relink[lang].failed })).toBeVisible({ timeout: 20000 });
    await page.evaluate(() => (window as unknown as { releaseOAuth: () => void }).releaseOAuth());
    await expect(page).toHaveURL(/\/dev-preview.*tab=calendar/);
    let navigations = 0; await page.route("https://example.supabase.co/auth/v1/authorize?**", route => { navigations++; return route.fulfill({ contentType: "text/plain", body: "Fixture authorization endpoint" }); });
    await page.getByRole("button", { name: relink[lang].relinkGoogle, exact: true }).click(); await expect(page).toHaveURL(/^https:\/\/example\.supabase\.co\/auth\/v1\/authorize\?/); expect(navigations).toBe(1); expect(errors).toEqual([]);
  });
  test(`${lang}: leaving the calendar cancels Google preparation before a late response`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "The desktop sidebar exercises unmount; mobile recovery is covered above.");
    const errors = watchConsole(page); await fixture(page, lang);
    await page.evaluate(() => { crypto.subtle.digest = () => new Promise(resolve => { (window as unknown as { releaseOAuth: () => void }).releaseOAuth = () => resolve(new ArrayBuffer(32)); }); });
    await page.getByRole("button", { name: relink[lang].relinkGoogle, exact: true }).click(); await page.getByRole("button", { name: settings[lang].title, exact: true }).click();
    await expect(page.getByRole("heading", { name: settings[lang].title, exact: true })).toBeVisible(); await page.evaluate(() => (window as unknown as { releaseOAuth: () => void }).releaseOAuth());
    await expect(page.getByRole("heading", { name: settings[lang].title, exact: true })).toBeVisible(); await expect(page).toHaveURL(/localhost|127\.0\.0\.1/); expect(errors).toEqual([]);
  });
}
