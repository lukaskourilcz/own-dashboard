import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { projects } from "../src/lib/demo/fixtures";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

/**
 * A PostgREST stand-in for `projects`: GET answers the fixture rows as they
 * stand, PATCH applies the change and records its body, like the database the
 * owner's session writes to.
 */
async function projectsStub(page: Page, { failWrites = false } = {}) {
  const rows = projects.map((row) => ({ ...row }));
  const patches: { id: string; body: Record<string, unknown> }[] = [];
  await page.route(/example\.supabase\.co\/rest\/v1\/projects(\?|$)/, async (route: Route) => {
    const request = route.request();
    const id = new URL(request.url()).searchParams.get("id")?.replace(/^eq\./, "");
    if (request.method() === "PATCH" && id) {
      if (failWrites) {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) });
      }
      const body = request.postDataJSON() as Record<string, unknown>;
      patches.push({ id, body });
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows[index] = { ...rows[index], ...body };
      return route.fulfill({ status: 204, body: "" });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  return patches;
}

async function openSettings(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByTestId("mobile-nav").getByRole("button", { name: /^(More|Více)$/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(Settings|Nastavení)$/ }).click();
  } else {
    await page.locator("aside").getByRole("button", { name: /^(Settings|Nastavení)$/ }).click();
  }
}

test("Settings moves a project into Freelance and back without a reload", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile";
  await gotoPreview(page);
  await signInFixtureUser(page);
  const patches = await projectsStub(page);
  await page.reload();
  await openSettings(page, mobile);

  const control = page.getByRole("group", { name: "Own or Freelance: Recipe box app" });
  const own = control.getByRole("button", { name: "Own", exact: true });
  const freelance = control.getByRole("button", { name: "Freelance", exact: true });
  await expect(own).toHaveAttribute("aria-pressed", "true");
  await expect(freelance).toHaveAttribute("aria-pressed", "false");
  // The client projects already sit in Freelance.
  await expect(
    page.getByRole("group", { name: "Own or Freelance: Acme customer portal" }).getByRole("button", { name: "Freelance", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  if (mobile) {
    // Touch targets stay at least 44 px tall.
    const box = await freelance.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const freelanceList = page.locator('aside ul[aria-labelledby="sidebar-freelance-projects"]');

  await freelance.click();
  await expect(freelance).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => patches.at(-1)?.body.engagement).toBe("client");
  expect(patches.at(-1)?.id).toBe("proj-recipe-box");
  await expect(page.getByText("Recipe box app is now listed under Freelance.")).toBeVisible();
  if (!mobile) {
    await expect(freelanceList.getByRole("link", { name: "Recipe box app", exact: true })).toBeVisible();
  }

  await own.click();
  await expect(own).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => patches.at(-1)?.body.engagement).toBe("own");
  expect(patches).toHaveLength(2);
  if (!mobile) {
    await expect(freelanceList.getByRole("link", { name: "Recipe box app", exact: true })).toHaveCount(0);
    await expect(page.locator("aside").getByRole("link", { name: "Recipe box app", exact: true })).toBeVisible();
  }

  // The Projects table groups from the same record.
  if (mobile) {
    await page.getByTestId("mobile-nav").getByRole("button", { name: "Projects", exact: true }).click();
  } else {
    await page.locator("aside nav").getByRole("button", { name: "Projects", exact: true }).click();
  }
  const table = page.getByRole("table");
  await expect(table.getByRole("row", { name: "Freelance", exact: true })).toBeVisible();
  const rows = await table.locator("tbody tr").allTextContents();
  const divider = rows.findIndex((text) => text.trim() === "Freelance");
  const recipe = rows.findIndex((text) => text.includes("Recipe box app"));
  expect(recipe).toBeGreaterThan(-1);
  expect(recipe).toBeLessThan(divider);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("a failed write keeps the project where it was and says so", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered once on desktop");
  await gotoPreview(page);
  await signInFixtureUser(page);
  await projectsStub(page, { failWrites: true });
  await page.reload();
  await openSettings(page, false);

  const control = page.getByRole("group", { name: "Own or Freelance: Recipe box app" });
  await control.getByRole("button", { name: "Freelance", exact: true }).click();
  await expect(page.getByText("Could not move Recipe box app. It stays where it was.")).toBeVisible();
  await expect(control.getByRole("button", { name: "Own", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator('aside ul[aria-labelledby="sidebar-freelance-projects"]').getByRole("link", { name: "Recipe box app", exact: true }),
  ).toHaveCount(0);
});

test("Czech Settings offers Vlastní and Freelance at 360 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the width is set explicitly");
  await page.setViewportSize({ width: 360, height: 800 });
  await gotoPreview(page, { lang: "cs", theme: "dark" });
  await openSettings(page, true);
  const control = page.getByRole("group", { name: "Vlastní nebo Freelance: Harbor Bakery website" });
  await expect(control.getByRole("button", { name: "Vlastní", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(control.getByRole("button", { name: "Freelance", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const { violations } = await new AxeBuilder({ page: page as unknown as AxePage })
    .include("li[data-settings-project]")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(violations).toEqual([]);
});
