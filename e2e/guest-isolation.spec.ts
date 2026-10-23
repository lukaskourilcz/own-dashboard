import { expect, test } from "@playwright/test";
import { guest } from "../src/lib/i18n/sections/guest";

test("public tour keeps live writes, exports and authentication out of the session", async ({ page }) => {
  const liveRequests: string[] = [];
  // A permissive stand-in proves that the tour blocks the request before the
  // network, rather than depending on an anonymous session or backend RLS.
  await page.route("**/api/**", route => {
    liveRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: '{}' });
  });
  await page.route(/example\.supabase\.co/, route => {
    liveRequests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "application/json", body: '[]' });
  });
  // The assertion concerns live-data isolation, not third-party icon loading.
  await page.goto("/guest?lang=en", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Guest tour", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "New calendar event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Tour event");
  await dialog.locator('button[type="submit"]').click();
  await expect(page.locator('[role="status"]').filter({ hasText: guest.en.readOnlyAction })).toBeVisible();
  await page.keyboard.press("Escape");
  // Simulate the same in-shell URL change used by destination navigation.
  await page.evaluate(() => history.pushState({}, "", "/notes"));
  expect(await page.evaluate(async () => (await fetch("/api/export/full")).status)).toBe(403);
  expect(await page.evaluate(async () => (await fetch("/api/calendar/event", { method: "POST" })).status)).toBe(403);
  expect(liveRequests).toEqual([]);
});
