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

test("Career loads nothing until Check for new offers is pressed", async ({ page }, testInfo) => {
  await gotoPreview(page);
  const requests = watchDataRequests(page);
  await open(page, testInfo.project.name === "mobile", "Career");
  await expect(page.getByRole("heading", { name: "Career loads when you ask" })).toBeVisible();
  await expect(page.getByText(/^Last checked:/)).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Senior Frontend Engineer (React)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for new offers", exact: true })).toBeVisible();
});

test("Opportunities loads nothing until pressed and remembers the last load", async ({ page }, testInfo) => {
  await gotoPreview(page, { lang: "cs" });
  const requests = watchDataRequests(page);
  await open(page, testInfo.project.name === "mobile", "Příležitosti");
  await expect(page.getByRole("heading", { name: "Příležitosti se načtou, až o to požádáte" })).toBeVisible();
  await expect(page.getByText("V této relaci zatím nenačteno.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Acme customer portal" })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(requests).toEqual([]);

  await page.getByRole("button", { name: "Zkontrolovat nové nabídky", exact: true }).click();
  await expect(page.getByRole("button", { name: "Acme customer portal", exact: true })).toBeVisible();
  await expect(page.getByText(/^Naposledy načteno: .* · Příležitosti: 1 · Platformy: \d+$/)).toBeVisible();

  // A new page load asks again, but the gate shows when and what was last loaded.
  await page.goto("/dev-preview");
  await open(page, testInfo.project.name === "mobile", "Příležitosti");
  await expect(page.getByText(/^Naposledy načteno: .* · Příležitosti: 1 · Platformy: \d+$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Zkontrolovat nové nabídky", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
