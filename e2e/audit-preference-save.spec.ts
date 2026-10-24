import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, integrationStatusFixture, watchConsole } from "./helpers";
import { DEFAULT_UI_PREFERENCES } from "../src/lib/ui-preferences-contract";
import { settings } from "../src/lib/i18n/sections/settings";

for (const lang of ["en", "cs"] as const) test(`${lang}: renewal preference has unknown/retry/pending/confirmed states`, async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  let failed = true, saved = false;
  let release!: () => void;
  await page.route("**/api/user/preferences", async route => {
    if (route.request().method() === "PATCH") {
      expect(route.request().postDataJSON()).toEqual({ notifications_renewals: true });
      await new Promise<void>(resolve => { release = resolve; }); saved = true;
      await route.fulfill({ json: { ok: true, saved: { notifications_renewals: true } } }); return;
    }
    await route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: "unavailable" } : { ...DEFAULT_UI_PREFERENCES, notifications_renewals: saved, sync_available: true } });
  });
  await page.route("**/api/integrations/status", route => route.fulfill({ json: integrationStatusFixture() }));
  await page.goto("/dev-preview?tab=settings&preferences=live");
  const control = page.getByRole("switch", { name: settings[lang].renewalNotifications, exact: true });
  await expect(page.getByText(settings[lang].preferenceLoadFailed, { exact: true })).toBeVisible(); await expect(control).toBeDisabled();
  failed = false; await page.locator("#settings-preferences").getByRole("button", { name: settings[lang].preferenceRetry, exact: true }).click();
  await expect(control).toBeEnabled(); await expect(control).not.toBeChecked();
  await control.focus(); await page.keyboard.press("Space");
  await expect(control).toBeDisabled(); await expect(control).toBeChecked();
  await expect.poll(() => typeof release).toBe("function"); release();
  await expect(control).toBeEnabled(); await expect(control).toBeChecked();
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors.filter(error => !(error.includes("status of 503") && error.endsWith("/api/user/preferences)")))).toEqual([]);
});
