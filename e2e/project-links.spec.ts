import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { projectLinks } from "../src/lib/demo/fixtures";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

/**
 * Echo project_links writes back as saved rows, as PostgREST would, and serve
 * the fixture rows plus those writes to the refetch that follows.
 */
async function echoProjectLinkWrites(page: Page) {
  const saved: Record<string, unknown>[] = [];
  await page.route(/example\.supabase\.co\/rest\/v1\/project_links/, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>[] | Record<string, unknown>;
      const rows = (Array.isArray(body) ? body : [body]).map((row) => ({
        id: `saved-${saved.length + 1}`,
        created_at: new Date().toISOString(),
        ...row,
      }));
      saved.push(...rows);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(rows) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([...projectLinks, ...saved]) });
  });
}

test("a project workspace lists the links it uses and adds one from the library", async ({ page }, testInfo) => {
  await gotoPreview(page);
  await signInFixtureUser(page);
  await echoProjectLinkWrites(page);
  await page.goto("/dev-preview?project=dneskai");
  const section = page.getByRole("list", { name: "Links" });
  await expect(section.getByRole("link", { name: "Google Search Console", exact: true })).toBeVisible();
  await expect(section.getByText("Checks that each daily edition is indexed.")).toBeVisible();
  await expect(section.getByText("Tool", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add link", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Add link: DNESKAi" });
  await expect(picker).toBeVisible();
  // Links already used by the project are not offered.
  await expect(picker.getByText("Google Search Console")).toHaveCount(0);
  await picker.getByRole("textbox", { name: "Search links and ideas…" }).fill("supabase");
  await picker.getByRole("checkbox", { name: /Supabase/ }).check();
  if (testInfo.project.name === "desktop") {
    expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  }
  await picker.getByRole("button", { name: "Add 1", exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(section.getByRole("link", { name: "Supabase", exact: true })).toBeVisible();

  // The Links library shows the relation on the card and in the export.
  if (testInfo.project.name === "mobile") {
    await page.getByTestId("mobile-nav").getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Links", exact: true }).click();
  } else {
    await page.locator("aside").getByRole("button", { name: "Links", exact: true }).click();
  }
  const supabaseCard = page.locator('[data-link-card="al5"]');
  await expect(supabaseCard.getByRole("list", { name: "Used by: Supabase" })).toContainText("DNESKAi");
  const vercelCard = page.locator('[data-link-card="al4"]');
  await expect(vercelCard.getByRole("list", { name: "Used by: Vercel" })).toContainText("devShark");
  await expect(vercelCard.getByText("Tool", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Copy links to JSON / Markdown" }).click();
  const preview = page.getByRole("dialog").getByLabel("Preview", { exact: true });
  const data = JSON.parse(await preview.inputValue());
  expect(data.version).toBe(3);
  const exported = data.items.find((item: { title: string }) => item.title === "Supabase");
  expect(exported.usedBy.map((usage: { project: string }) => usage.project)).toContain("DNESKAi");
  await page.keyboard.press("Escape");

  // The project filter narrows the library to one project's links.
  await page.getByRole("combobox", { name: "Used by project" }).click();
  await page.getByRole("option", { name: "devShark", exact: true }).click();
  await expect(vercelCard).toBeVisible();
  await expect(page.locator('[data-link-card="al1"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("Czech link cards say which projects use them", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "covered once on desktop");
  await gotoPreview(page, { lang: "cs", theme: "dark" });
  await page.locator("aside").getByRole("button", { name: "Odkazy", exact: true }).click();
  await expect(page.locator('[data-link-card="al4"]').getByText("Používá", { exact: true })).toBeVisible();
  await page.locator('[data-link-card="al4"]').getByRole("button", { name: /Vercel/ }).first().click();
  await page.getByRole("button", { name: "Přidat k projektu", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Přidat k projektu: Vercel" })).toBeVisible();
});
