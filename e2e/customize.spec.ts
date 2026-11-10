import { test, expect } from "@playwright/test";
import { gotoPreview, watchConsole } from "./helpers";

test("Home keeps only the two execution queues even with a saved legacy widget layout", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  await page.evaluate(() => localStorage.setItem("dashboardLayout", JSON.stringify(["today-hero", "calendar", "goals"])));
  await page.reload();
  const home = page.getByTestId("execution-home");
  await expect(home).toBeVisible();
  await expect(home.getByRole("list", { name: "Backlog tasks" }).getByRole("listitem")).toHaveCount(5);
  await expect(home.getByRole("button", { name: "Career", exact: true })).toBeVisible();
  for (const text of ["Today's seven", "Completion garden", "Follow-ups", "Customize"]) await expect(home.getByText(text, { exact: true })).toHaveCount(0);
  await home.getByRole("button", { name: "All backlog" }).click();
  await expect(page.getByTestId("backlog-panel")).toBeVisible();
  expect(errors).toEqual([]);
});
