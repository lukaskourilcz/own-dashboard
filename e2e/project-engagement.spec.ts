import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { projects as demoProjects } from "../src/lib/demo/fixtures";
import { projects as projectCopy } from "../src/lib/i18n/sections/projects";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

const owner = "11111111-1111-4111-8111-111111111111";
const recipeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Exercise the current captured-version RPC and the shared complete read,
 * with invented UUID rows. Direct table writes are never accepted. */
async function projectsStub(page: Page, { failWrites = false } = {}) {
  let tick = 0, directWrites = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 24, 13, 0, tick++)).toISOString();
  const rows = demoProjects.map((row, index) => ({ ...row,
    id: row.id === "proj-recipe-box" ? recipeId : `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
    user_id: owner, updated_at: stamp(),
  }));
  const writes: { id: string; patch: Record<string, unknown> }[] = [];
  await page.route("**/rest/v1/rpc/read_owned_collection", route => route.fulfill({
    json: route.request().postDataJSON().p_entity === "projects" ? rows : [],
  }));
  await page.route("**/rest/v1/projects?**", route => {
    if (route.request().method() !== "GET") directWrites++;
    return route.fulfill({ status: 405, json: {} });
  });
  await page.route("**/rest/v1/rpc/set_project_preferences", route => {
    const input = route.request().postDataJSON();
    expect(Object.keys(input).sort()).toEqual(["p_expected_updated_at", "p_id", "p_patch"]);
    const row = rows.find(row => row.id === input.p_id);
    expect(row).toBeDefined(); expect(input.p_expected_updated_at).toBe(row!.updated_at);
    writes.push({ id: input.p_id, patch: input.p_patch });
    if (failWrites) return route.fulfill({ status: 503, json: { message: "Private fixture failure" } });
    const previous = { engagement: row!.engagement }, before = row!.updated_at;
    Object.assign(row!, input.p_patch, { updated_at: stamp() });
    return route.fulfill({ json: { kind: "saved", id: row!.id, user_id: owner,
      values: input.p_patch, previous_values: previous, source_updated_at: before, updated_at: row!.updated_at } });
  });
  return { writes, directWrites: () => directWrites };
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
  const backend = await projectsStub(page);
  await page.goto("/dev-preview?projectRecords=live");
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
  await expect.poll(() => backend.writes.at(-1)?.patch.engagement).toBe("client");
  expect(backend.writes.at(-1)?.id).toBe(recipeId);
  await expect(page.getByText("Recipe box app is now listed under Freelance.")).toBeVisible();
  if (!mobile) {
    await expect(freelanceList.getByRole("link", { name: "Recipe box app", exact: true })).toBeVisible();
  }

  await own.click();
  await expect(own).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => backend.writes.at(-1)?.patch.engagement).toBe("own");
  expect(backend.writes).toHaveLength(2); expect(backend.directWrites()).toBe(0);
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
  const backend = await projectsStub(page, { failWrites: true });
  await page.goto("/dev-preview?projectRecords=live");
  await openSettings(page, false);

  const control = page.getByRole("group", { name: "Own or Freelance: Recipe box app" });
  await control.getByRole("button", { name: "Freelance", exact: true }).click();
  await expect(page.getByText(projectCopy.en.preferenceSaveFailed, { exact: true })).toBeVisible();
  await expect(control.getByRole("button", { name: "Own", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(backend.writes).toHaveLength(1); expect(backend.directWrites()).toBe(0);
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
