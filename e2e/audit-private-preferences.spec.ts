import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, integrationStatusFixture, watchConsole } from "./helpers";
import { DEFAULT_UI_PREFERENCES } from "../src/lib/ui-preferences-contract";
import { settings } from "../src/lib/i18n/sections/settings";

for (const lang of ["en", "cs"] as const) test(`${lang}: private drafts ignore legacy owners and survive a mismatched save receipt`, async ({ page }) => {
  const errors = watchConsole(page), legacy = "https://docs.example.test/legacy-owner", draft = "https://docs.example.test/current-owner";
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  await page.evaluate(legacy => { localStorage.setItem("cvUrlCs", legacy); localStorage.setItem("showCzechCareer", "1"); }, legacy);
  let matches = false, writes = 0, capturedOwner = "";
  await page.route("**/api/user/preferences", async route => {
    const request = route.request(), ownerId = request.headers()["x-own-dashboard-owner"]; expect(ownerId).toBeTruthy();
    capturedOwner = ownerId;
    if (request.method() === "GET") return route.fulfill({ json: { ...DEFAULT_UI_PREFERENCES, sync_available: true, ownerId } });
    writes++; expect(request.postDataJSON()).toEqual({ cv_url_cs: draft });
    return route.fulfill({ json: { ok: true, ownerId: matches ? ownerId : "foreign-owner", saved: { cv_url_cs: draft } } });
  });
  await page.route("**/api/integrations/status", route => route.fulfill({ json: integrationStatusFixture() }));
  await page.goto("/dev-preview?tab=settings&preferences=live");
  const cs = page.locator("#cv-cs"); await expect(cs).toHaveValue("");
  await cs.fill(draft); await cs.blur();
  await expect(page.getByText(settings[lang].preferenceSaveFailed, { exact: true })).toBeVisible(); await expect(cs).toHaveValue(draft);
  const state = () => page.evaluate(ownerId => JSON.parse(localStorage.getItem(`owner-preference:${encodeURIComponent(ownerId)}:cv_url_cs`)!), capturedOwner);
  await expect.poll(async () => (await state()).dirty).toBe(true);
  matches = true; await cs.focus(); await cs.blur();
  await expect.poll(async () => (await state()).dirty).toBe(false); expect(writes).toBe(2);
  await page.locator("#cv-en").focus(); await page.locator("#cv-en").blur(); await cs.focus(); await cs.blur(); expect(writes).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem("cvUrlCs"))).toBe(legacy);
  await page.reload(); await expect(page.locator("#cv-cs")).toHaveValue(draft);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(errors).toEqual([]);
  await page.locator("#settings-cv").screenshot({ path: `/tmp/app-audit-private-prefs-${lang}-${(page.viewportSize()?.width ?? 0) < 768 ? "mobile" : "desktop"}.png` });
});
