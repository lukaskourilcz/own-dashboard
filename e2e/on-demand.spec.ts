import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

/** Requests a destination would make for its own data. */
function watchDataRequests(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\/rest\/v1\/|\/api\/jobs\/|\/api\/cron\//.test(url)) seen.push(`${request.method()} ${url}`);
  });
  return seen;
}

async function open(page: Page, mobile: boolean, name: string) {
  if (mobile) {
    const bar = page.getByTestId("mobile-nav");
    if (await bar.getByRole("button", { name, exact: true }).count()) {
      await bar.getByRole("button", { name, exact: true }).click();
      return;
    }
    await bar.getByRole("button", { name: /^(More|Více)$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
  } else {
    await page.locator("aside nav").getByRole("button", { name, exact: true }).click();
  }
}

test("Career shows public Czech research without eager private or scraper requests", async ({ page }, testInfo) => {
  await gotoPreview(page);
  const requests = watchDataRequests(page);
  await open(page, testInfo.project.name === "mobile", "Career");
  await expect(page.getByRole("heading", { name: "Your next role in Czechia." })).toBeVisible();
  await expect(page.getByTestId("career-job-grid")).toBeVisible();
  await expect(page.getByRole("button", { name: "Senior Frontend Engineer (React)", exact: true })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);
  if (testInfo.project.name === "desktop") {
    expect((await new AxeBuilder({ page: page as unknown as AxePage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  }

  await page.getByRole("button", { name: "Check for new offers", exact: true }).click();
  await expect(page.getByRole("button", { name: "Senior Frontend Engineer (React)", exact: true })).toBeVisible();
  // Leaving and returning keeps the loaded state for the session.
  await open(page, testInfo.project.name === "mobile", "Projects");
  await open(page, testInfo.project.name === "mobile", "Career");
  await page.getByRole("button", { name: "Researched roles", exact: true }).click();
  await expect(page.getByTestId("career-job-grid")).toBeVisible();
  await page.getByRole("button", { name: "Open positions", exact: true }).click();
  await expect(page.getByRole("button", { name: "Senior Frontend Engineer (React)", exact: true })).toBeVisible();
});
