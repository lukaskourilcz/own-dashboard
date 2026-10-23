import { expect, test } from "@playwright/test";
import { gotoPreview, watchConsole } from "./helpers";

test.use({ timezoneId: "America/Los_Angeles" });

test("new calendar forms refresh the default day and preserve a chosen day", async ({ page }) => {
  const errors = watchConsole(page);
  await page.clock.setFixedTime(new Date("2026-10-23T12:00:00Z"));
  await gotoPreview(page);
  const open = () => page.getByRole("button", { name: "New calendar event", exact: true }).click();
  await open();
  await expect(page.locator("#cal-date")).toHaveValue("2026-10-23");
  await page.keyboard.press("Escape");
  await page.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
  await open();
  await expect(page.locator("#cal-date")).toHaveValue("2026-10-24");
  await page.locator("#cal-date").fill("2026-10-30");
  await page.keyboard.press("Escape");
  await page.clock.setFixedTime(new Date("2026-10-25T12:00:00Z"));
  await open();
  await expect(page.locator("#cal-date")).toHaveValue("2026-10-30");
  expect(errors).toEqual([]);
});

test("new important dates use the day the form opens", async ({ page }) => {
  const errors = watchConsole(page);
  await page.clock.setFixedTime(new Date("2026-10-23T12:00:00Z"));
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=dates");
  await page.getByRole("button", { name: "Add a date", exact: true }).click();
  await expect(page.locator("#ind-date")).toHaveValue("2026-10-23");
  await page.keyboard.press("Escape");
  await page.clock.setFixedTime(new Date("2026-10-25T12:00:00Z"));
  await page.getByRole("button", { name: "Add a date", exact: true }).click();
  await expect(page.locator("#ind-date")).toHaveValue("2026-10-25");
  expect(errors).toEqual([]);
});

test("goal timeline preserves a date-only value west of UTC", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=goals");
  const card = page.locator("li").filter({ has: page.getByText("Launch side project", { exact: true }) }).first();
  const date = (await card.innerText()).match(/\d{4}-\d{2}-\d{2}/)![0];
  const expected = await page.evaluate(date => new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }), date);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(card).toContainText(expected);
  await expect(card.getByRole("combobox", { name: "Launch side project: Status", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("calendar times hydrate in the browser timezone without rebuilding the page", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=calendar");
  await expect(page.locator("#main-content").getByText("Standup", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("calendar creation sends the browser timezone and confirms the saved event", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  let payload: Record<string, unknown> | null = null;
  await page.route("**/api/calendar/event", async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "fixture-event", htmlLink: "https://calendar.google.com/" }) });
  });
  await page.getByRole("button", { name: "New calendar event", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Project review");
  await dialog.locator('button[type="submit"]').click();
  await expect(dialog.getByText("Event added to your Google Calendar.")).toBeVisible();
  expect(payload).toMatchObject({ title: "Project review", timeZone: "America/Los_Angeles", startTime: "09:00", endTime: "10:00" });
  expect(errors).toEqual([]);
});
