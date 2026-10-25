import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { calendar as copy } from "../src/lib/i18n/sections/calendar";
import { settings } from "../src/lib/i18n/sections/settings";
import { common } from "../src/lib/i18n/sections/common";

for (const lang of ["en", "cs"] as const) {
  test(`${lang}: long calendars render incrementally and reflow at six widths`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "Six explicit widths include mobile.");
    const t = copy[lang]; await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.route("**/api/calendar/list", route => route.fulfill({ json: { calendars: [{ id: "primary-id", summary: "Owner calendar", primary: true }] } }));
    await page.route("**/api/user/preferences", route => route.fulfill({ json: { ok: true, ownerId: route.request().headers()["x-own-dashboard-owner"], saved: { selected_calendar_ids: ["primary"] } } }));
    await page.route("**/api/calendar/events?**", route => route.fulfill({ json: { ok: true, events: Array.from({ length: 101 }, (_, index) => ({ id: `event-${index}`, summary: `Project review ${index + 1}`, description: "<p>Review the project</p>", start: { dateTime: "2026-10-25T09:00:00Z" }, end: { dateTime: "2026-10-25T10:00:00Z" } })) } }));
    await page.goto("/dev-preview?tab=calendar&calendar=live"); await page.getByRole("button", { name: t.primaryLabel, exact: true }).click();
    await expect(page.getByRole("button", { name: "Owner calendar", exact: false })).toBeVisible(); await page.getByRole("button", { name: t.save, exact: true }).click();
    await expect(page.getByText(t.showingEvents(50, 101), { exact: true })).toBeVisible(); await expect(page.getByText("Project review 51", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: t.showMore, exact: true }).click(); await expect(page.getByText(t.showingEvents(100, 101), { exact: true })).toBeVisible();
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 900 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (width === 360 || width === 1440) {
        const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze(); expect(axe.violations).toEqual([]);
      }
    }
  });
  test(`${lang}: a dismissed calendar draft remains protected during navigation`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "The desktop sidebar exercises the shared shell navigation guard.");
    const t = copy[lang]; await gotoPreview(page, { lang });
    await page.getByRole("button", { name: t.newEvent, exact: true }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: t.title, exact: true }).fill("Keep this calendar draft"); await page.keyboard.press("Escape");
    await page.getByRole("button", { name: settings[lang].title, exact: true }).click();
    const guard = page.getByRole("dialog", { name: common[lang].unsaved.title }); await expect(guard).toBeVisible(); await guard.getByRole("button", { name: common[lang].unsaved.stay, exact: true }).click();
    await page.getByRole("button", { name: t.newEvent, exact: true }).click(); await expect(page.getByRole("dialog").getByRole("textbox", { name: t.title, exact: true })).toHaveValue("Keep this calendar draft");
  });
  test(`${lang}: calendar selection retries, keeps its captured draft and refreshes events after confirmation`, async ({ page }) => {
    const errors = watchConsole(page), t = copy[lang];
    await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    let fail = true, saved = false, release!: () => void, eventReads = 0;
    await page.route("**/api/calendar/list", route => route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: "unavailable" } : { calendars: [{ id: "primary-id", summary: "Owner calendar", primary: true }, { id: "shared", summary: "Shared project calendar" }] } }));
    await page.route("**/api/user/preferences", async route => {
      expect(route.request().postDataJSON()).toEqual({ selected_calendar_ids: ["primary", "shared"] });
      await new Promise<void>(resolve => { release = resolve; }); saved = true;
      await route.fulfill({ json: { ok: true, ownerId: route.request().headers()["x-own-dashboard-owner"], saved: { selected_calendar_ids: ["primary", "shared"] } } });
    });
    await page.route("**/api/calendar/events?**", route => {
      eventReads++; return route.fulfill({ json: { ok: true, events: [{ id: "refreshed", sourceCalendarId: "shared", summary: saved ? "Refreshed selected calendar" : "Before confirmation", start: { dateTime: "2026-10-25T09:00:00Z" }, end: { dateTime: "2026-10-25T10:00:00Z" } }] } });
    });
    await page.goto("/dev-preview?tab=calendar&calendar=live");
    await page.getByRole("button", { name: t.primaryLabel, exact: true }).click();
    await expect(page.getByText(t.couldNotLoadCalendars, { exact: true })).toBeVisible(); fail = false;
    await page.getByRole("button", { name: t.retry, exact: true }).click();
    const shared = page.getByRole("button", { name: "Shared project calendar", exact: true });
    await shared.click(); await expect(shared).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: t.cancel, exact: true }).click();
    await page.getByRole("button", { name: t.primaryLabel, exact: true }).click(); await expect(shared).toHaveAttribute("aria-pressed", "false");
    await shared.click(); await page.getByRole("button", { name: t.save, exact: true }).click();
    await expect(shared).toBeDisabled(); await page.keyboard.press("Escape"); await expect(shared).toBeVisible();
    await expect.poll(() => typeof release).toBe("function"); release();
    await expect(shared).not.toBeVisible(); await expect(page.getByRole("button", { name: t.countSelected(2), exact: true })).toBeVisible();
    await expect(page.getByText("Refreshed selected calendar", { exact: true })).toBeVisible(); expect(eventReads).toBeGreaterThan(0);
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze(); expect(axe.violations).toEqual([]);
    expect(errors.filter(error => !(error.includes("status of 503") && error.endsWith("/api/calendar/list)")))).toEqual([]);
  });
  test(`${lang}: an ambiguous calendar creation retains its draft and pending work cannot be edited or dismissed`, async ({ page }) => {
    const errors = watchConsole(page), t = copy[lang];
    await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    let attempt = 0, release!: () => void;
    await page.route("**/api/calendar/event", async route => {
      attempt++; await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ status: attempt === 1 ? 502 : 200, json: attempt === 1 ? { reason: "unconfirmed" } : { id: "created", htmlLink: "javascript:alert(1)" } });
    });
    await page.getByRole("button", { name: t.newEvent, exact: true }).click();
    const dialog = page.getByRole("dialog"), title = dialog.getByRole("textbox", { name: t.title, exact: true });
    await title.fill("Preserve this draft"); await dialog.getByRole("button", { name: t.addToGoogleCalendar, exact: true }).click();
    await expect(title).toBeDisabled(); await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
    await expect.poll(() => typeof release).toBe("function"); release();
    await expect(dialog.getByRole("alert")).toHaveText(t.resultUnconfirmed); await expect(title).toBeEnabled(); await expect(title).toHaveValue("Preserve this draft"); expect(attempt).toBe(1);
    release = undefined as unknown as () => void;
    await dialog.getByRole("button", { name: t.addToGoogleCalendar, exact: true }).click(); await expect.poll(() => typeof release).toBe("function"); release();
    await expect(dialog.getByText(t.eventAdded, { exact: false })).toBeVisible(); await expect(title).toHaveValue(""); await expect(dialog.locator('a[href^="javascript:"]')).toHaveCount(0);
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze(); expect(axe.violations).toEqual([]);
    expect(errors.filter(error => !(error.includes("status of 502") && error.endsWith("/api/calendar/event)")))).toEqual([]);
  });
}
