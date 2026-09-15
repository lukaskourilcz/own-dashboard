import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

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
  await expect(page.getByRole("heading", { name: "Ideas", exact: true })).toBeVisible();
  const trigger = page.getByRole("button", { name: "Copy to JSON / Markdown" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const preview = dialog.getByLabel("Preview", { exact: true });
  const all = JSON.parse(await preview.inputValue());
  expect(all.items).toHaveLength(3);
  await dialog.getByLabel("Pricing", { exact: true }).click();
  await page.getByRole("option", { name: "Free only", exact: true }).click();
  expect(JSON.parse(await preview.inputValue()).items.map((x: {title:string}) => x.title)).toEqual(["Have I Been Pwned"]);
  await dialog.getByLabel("Pricing", { exact: true }).click();
  await page.getByRole("option", { name: "Free + partially paid (freemium)", exact: true }).click();
  expect(JSON.parse(await preview.inputValue()).items).toHaveLength(2);
  await dialog.getByLabel("Format", { exact: true }).click();
  await page.getByRole("option", { name: "Markdown", exact: true }).click();
  const markdown = await preview.inputValue();
  expect(markdown).toContain("# Links & ideas");
  expect(markdown).not.toContain("Midjourney");
  await dialog.getByRole("button", { name: "Copy all content" }).click();
  await expect(dialog.getByText("Copied to clipboard.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(markdown);
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download file" }).click();
  expect((await downloaded).suggestedFilename()).toBe("links-and-ideas.md");
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
  await page.getByRole("button", { name: "Copy to JSON / Markdown" }).click();
  await page.getByRole("button", { name: "Copy all content" }).click();
  await expect(page.getByText("Could not copy. Select the preview text and copy it manually.")).toBeVisible();
  await expect(page.getByLabel("Preview", { exact: true })).toHaveValue(/Midjourney/);
});


test("Czech dark export reflows at the supported widths", async ({ page }) => {
  await gotoPreview(page, { lang: "cs", theme: "dark" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("aside").getByRole("button", { name: "Odkazy", exact: true }).click();
  await page.getByRole("button", { name: "Kopírovat do JSON / Markdown" }).click();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("Náhled", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/links-export-czech-dark.png" });
});


test("creates an Idea below Links and exposes review evidence", async ({ page }, info) => {
  await gotoPreview(page);
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: "u1", exp: expiresAt })).toString("base64url"), "test"].join(".");
  await page.context().addCookies([{ name: "sb-example-auth-token", value: "base64-" + Buffer.from(JSON.stringify({ access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expiresAt, expires_in: 3600, user: { id: "u1" } })).toString("base64url"), url: "http://localhost:3939" }]);
  await page.reload();
  let saved: Record<string, unknown> | null = null;
  await page.route("**/rest/v1/ai_links**", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(saved ? [saved] : []) });
    const record = route.request().postDataJSON();
    expect(record.record_type).toBe("idea");
    saved = {
      ...record, id: "test-idea", created_at: "2026-09-15", updated_at: "2026-09-15",
      usefulness_rating: 5, rating_rationale: "Reduce licensing mistakes before publication.",
      project_relevance: [{ repository: "own-dashboard", reason: "Record rights and costs before using generated media." }],
      source_urls: ["https://www.rive.app/pricing"], pricing_evidence: "Reference is free to read; editor and export plans differ.",
    };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(saved) });
  });
  await openLinks(page, info.project.name === "mobile");
  await page.getByRole("button", { name: "Add idea", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("Name", { exact: true }).fill("Check editor and export licensing separately");
  await form.getByLabel("URL", { exact: true }).fill("https://www.rive.app/pricing");
  await form.getByLabel("Description", { exact: true }).fill("Confirm commercial export rights before adopting a free design editor. Preserve the source and review date.");
  await form.getByRole("button", { name: "Create", exact: true }).click();
  await expect(form).not.toBeVisible();
  const ideas = page.locator('section[aria-labelledby="ideas-heading"]');
  await ideas.getByRole("button", { name: "Show details: Check editor and export licensing separately", exact: true }).click();
  await expect(ideas.getByText("Usefulness: 5/5")).toBeVisible();
  await ideas.getByText("Projects that benefit", { exact: true }).click();
  await expect(ideas.getByText("Record rights and costs before using generated media.", { exact: false })).toBeVisible();
  await ideas.getByText("Sources", { exact: true }).click();
  await expect(ideas.locator("details").getByRole("link", { name: "https://www.rive.app/pricing", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
