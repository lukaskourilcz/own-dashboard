import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { aiLinks } from "../src/lib/demo/fixtures";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

async function openLinks(page: import("@playwright/test").Page, mobile: boolean) {
  if (mobile) {
    await page.getByTestId("mobile-nav").getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Links", exact: true }).click();
  } else await page.locator("aside").getByRole("button", { name: "Links", exact: true }).click();
}

test("exports exact pricing selection, Markdown, clipboard and download", async ({ page, context }, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await gotoPreview(page);
  await openLinks(page, info.project.name === "mobile");
  const trigger = page.getByRole("button", { name: "Copy links to JSON / Markdown" });
  await expect(trigger).toBeVisible();
  // IG tips have their own section; Links no longer lists or exports them.
  await expect(page.getByRole("heading", { name: "Ideas", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Copy IG tips to JSON / Markdown" })).toHaveCount(0);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const preview = dialog.getByLabel("Preview", { exact: true });
  const all = JSON.parse(await preview.inputValue());
  expect(all.items).toHaveLength(8);
  await dialog.getByLabel("Include", { exact: true }).click();
  await page.getByRole("option", { name: "Selected categories", exact: true }).click();
  await dialog.getByRole("checkbox", { name: /SECURITY/ }).click();
  expect(JSON.parse(await preview.inputValue()).items.map((x: {title:string}) => x.title)).toEqual(["Have I Been Pwned"]);
  await dialog.getByLabel("JSON structure", { exact: true }).click();
  await page.getByRole("option", { name: "Grouped by category", exact: true }).click();
  expect(JSON.parse(await preview.inputValue()).categories[0].category).toBe("SECURITY");
  await dialog.getByLabel("JSON structure", { exact: true }).click();
  await page.getByRole("option", { name: "Detailed flat list", exact: true }).click();
  await dialog.getByLabel("Include", { exact: true }).click();
  await page.getByRole("option", { name: "All categories", exact: true }).click();
  await dialog.getByLabel("Pricing", { exact: true }).click();
  await page.getByRole("option", { name: "Free only", exact: true }).click();
  expect(JSON.parse(await preview.inputValue()).items.map((x: {title:string}) => x.title)).toEqual(["Have I Been Pwned", "Google Search Console", "PageSpeed Insights"]);
  await dialog.getByLabel("Pricing", { exact: true }).click();
  await page.getByRole("option", { name: "Free + partially paid (freemium)", exact: true }).click();
  expect(JSON.parse(await preview.inputValue()).items).toHaveLength(7);
  await dialog.getByLabel("Format", { exact: true }).click();
  await page.getByRole("option", { name: "Markdown", exact: true }).click();
  const markdown = await preview.inputValue();
  expect(markdown).toContain("# Links");
  expect(markdown).not.toContain("Midjourney");
  await dialog.getByRole("button", { name: "Copy all content" }).click();
  await expect(dialog.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(markdown);
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download file" }).click();
  expect((await downloaded).suggestedFilename()).toBe("links.md");
  expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("clipboard denial preserves a manual-copy fallback", async ({ page }, info) => {
  await gotoPreview(page);
  await openLinks(page, info.project.name === "mobile");
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } }); });
  await page.getByRole("button", { name: "Copy links to JSON / Markdown" }).click();
  await page.getByRole("button", { name: "Copy all content" }).click();
  await expect(page.getByText("Could not copy. Select the preview text and copy it manually.")).toBeVisible();
  await expect(page.getByLabel("Preview", { exact: true })).toHaveValue(/Midjourney/);
});


test("Czech dark export reflows at the supported widths", async ({ page }) => {
  await gotoPreview(page, { lang: "cs", theme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("aside").getByRole("button", { name: "Odkazy", exact: true }).click();
  await page.getByRole("button", { name: "Kopírovat odkazy do JSON / Markdown" }).click();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("Náhled", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/links-export-czech-dark.png" });
});


test("an entry switched to IG tip leaves Links for IG TIPS", async ({ page }, info) => {
  await gotoPreview(page);
  await signInFixtureUser(page);
  const rows = aiLinks.map((row) => ({ ...row })) as Record<string, unknown>[];
  const patches: Record<string, unknown>[] = [];
  await page.route(/example\.supabase\.co\/rest\/v1\/ai_links(\?|$)/, async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
    const body = request.postDataJSON() as Record<string, unknown>;
    patches.push(body);
    const id = new URL(request.url()).searchParams.get("id")?.replace(/^eq\./, "");
    const index = rows.findIndex((row) => row.id === id);
    rows[index] = { ...rows[index], ...body };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows[index]) });
  });
  await page.reload();
  const mobile = info.project.name === "mobile";
  await openLinks(page, mobile);
  const main = page.locator("#main-content");
  await expect(main.locator('[data-link-card="al8"]')).toBeVisible();

  await main.getByRole("button", { name: "Edit: Figma", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Edit link" });
  await form.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "IG tip", exact: true }).click();
  await expect(form.getByRole("combobox", { name: "Type" })).toHaveAccessibleDescription("An IG tip is listed under IG TIPS, not in Links.");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toBeHidden();
  expect(patches.at(-1)).toMatchObject({ record_type: "idea", title: "Figma", url: "https://www.figma.com/" });
  await expect(page.getByText("Moved to IG TIPS.", { exact: true })).toBeVisible();
  await expect(main.locator('[data-link-card="al8"]')).toHaveCount(0);

  if (mobile) {
    await page.getByTestId("mobile-nav").getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "IG TIPS", exact: true }).click();
  } else await page.locator("aside nav").getByRole("button", { name: "IG TIPS", exact: true }).click();
  // Without a topic yet, the moved entry waits under Ungrouped with its notes.
  const moved = main.locator('section[aria-labelledby="tips-ungrouped"] [data-tip-card="al8"]');
  await expect(moved).toContainText("Interface design and prototyping.");
  await expect(moved).toContainText("From figma.com");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
