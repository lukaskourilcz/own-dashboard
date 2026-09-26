import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser, watchConsole } from "./helpers";
import { aiLinks } from "../src/lib/demo/fixtures";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

async function openTips(page: Page, mobile: boolean, cs = false) {
  if (mobile) {
    await page.getByTestId("mobile-nav").getByRole("button", { name: cs ? "Více" : "More", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "IG TIPS", exact: true }).click();
  } else {
    await page.locator("aside nav").getByRole("button", { name: "IG TIPS", exact: true }).click();
  }
  await expect(page.locator("header").getByRole("heading", { level: 1, name: "IG TIPS" })).toBeVisible();
}

/** PostgREST stand-in for ai_links that records writes and echoes them back. */
async function aiLinksStub(page: Page) {
  const rows = aiLinks.map((row) => ({ ...row })) as Record<string, unknown>[];
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  await page.route(/example\.supabase\.co\/rest\/v1\/ai_links(\?|$)/, async (route: Route) => {
    const request = route.request();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "GET") return json(rows);
    const body = request.postDataJSON() as Record<string, unknown>;
    writes.push({ method: request.method(), body });
    if (request.method() === "POST") {
      const saved = { id: "created-tip", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), project_relevance: [], source_urls: [], ...body };
      rows.unshift(saved);
      return json(saved, 201);
    }
    const id = new URL(request.url()).searchParams.get("id")?.replace(/^eq\./, "");
    const index = rows.findIndex((row) => row.id === id);
    rows[index] = { ...rows[index], ...body };
    return json(rows[index]);
  });
  return writes;
}

test("IG TIPS groups the tips by topic on cards without icons", async ({ page }, testInfo) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  await openTips(page, testInfo.project.name === "mobile");
  const main = page.locator("#main-content");

  for (const heading of [/^Content ideas/, /^Formats & editing/, /^Platforms & reach/, /^Growth & retention/, /^Ungrouped/]) {
    await expect(main.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
  await expect(main.getByRole("status")).toHaveText("5 of 5 tips");
  // Nothing in a tip card is an icon.
  await expect(main.locator("[data-tip-card]")).toHaveCount(5);
  await expect(main.locator("[data-tip-card] svg, [data-tip-card] img")).toHaveCount(0);

  const plan = main.locator('[data-tip-card="tip1"]');
  await expect(plan).toContainText("outline a month of posts in one sitting");
  await expect(plan).toContainText("From an Instagram Reel · For own-dashboard");
  await expect(main.locator('[data-tip-card="tip3"]')).toContainText("From 2 Instagram Reels");
  await expect(main.locator('[data-tip-card="tip2"]')).toContainText("From example.com");
  // A tip without a summary shows its stored notes.
  await expect(main.locator('[data-tip-card="tip5"]')).toContainText("note the date you checked");

  // Details open from the keyboard and hold the notes, reasons and sources.
  const details = plan.getByRole("button", { name: "Details: Plan a month of posts around two topics" });
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(plan.getByRole("button", { name: "Hide details: Plan a month of posts around two topics" })).toHaveAttribute("aria-expanded", "true");
  await expect(plan.getByText("Research notes", { exact: true })).toBeVisible();
  await expect(plan.getByText("Why it is useful · usefulness 4/5")).toBeVisible();
  await expect(plan.getByRole("link", { name: "https://www.instagram.com/p/EXAMPLE0001/" })).toBeVisible();
  await expect(plan.getByRole("link", { name: /Open original/ })).toHaveAttribute("target", "_blank");

  // Topic chips and search.
  await main.getByRole("group", { name: "Filter by topic" }).getByRole("button", { name: "Growth & retention" }).click();
  await expect(main.locator("[data-tip-card]")).toHaveCount(1);
  await expect(main.locator('[data-tip-card="tip4"]')).toBeVisible();
  await main.getByRole("button", { name: "Clear filters" }).click();
  await main.getByRole("textbox", { name: "Search tips…" }).fill("carousel 1350");
  await expect(main.locator("[data-tip-card]")).toHaveCount(1);
  await expect(main.locator('[data-tip-card="tip2"]')).toBeVisible();
  await main.getByRole("textbox", { name: "Search tips…" }).fill("no such tip anywhere");
  await expect(main.getByText("No tips match")).toBeVisible();
  await main.getByRole("button", { name: "Clear filters" }).click();
  await expect(main.locator("[data-tip-card]")).toHaveCount(5);

  // The export keeps each tip's topic and card text.
  await main.getByRole("button", { name: "Copy IG tips to JSON / Markdown" }).click();
  const exported = JSON.parse(await page.getByRole("dialog").getByLabel("Preview", { exact: true }).inputValue());
  expect(exported.scope).toBe("idea");
  expect(exported.version).toBe(4);
  expect(exported.items).toHaveLength(5);
  expect(exported.items.find((item: { id: string }) => item.id === "tip1")).toMatchObject({ group: "content", summary: expect.stringContaining("one sitting") });
  await page.keyboard.press("Escape");

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("adds a tip with a topic and a description, then edits it", async ({ page }, testInfo) => {
  await gotoPreview(page);
  await signInFixtureUser(page);
  const writes = await aiLinksStub(page);
  await page.reload();
  await openTips(page, testInfo.project.name === "mobile");
  const main = page.locator("#main-content");

  await page.getByRole("button", { name: "Add tip", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "New tip" });
  await dialog.getByRole("button", { name: "Add tip", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Give the tip a title.");
  await dialog.getByLabel("Title", { exact: true }).fill("Film the hook first");
  await dialog.getByLabel("Original URL", { exact: true }).fill("www.instagram.com/p/EXAMPLE0009/");
  await dialog.getByRole("combobox", { name: "Topic" }).click();
  await page.getByRole("option", { name: "Formats & editing", exact: true }).click();
  await dialog.getByLabel("What the tip says and how to use it", { exact: true }).fill("Record the first two seconds before anything else. Re-shoot them until the first frame shows what the video is about.");
  await dialog.getByRole("button", { name: "Add tip", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes[0]).toMatchObject({
    method: "POST",
    body: { record_type: "idea", tip_group: "formats", title: "Film the hook first", url: "https://www.instagram.com/p/EXAMPLE0009/", category_id: null },
  });
  const created = main.locator('[data-tip-card="created-tip"]');
  await expect(created).toContainText("Record the first two seconds before anything else.");
  await expect(main.locator('section[aria-labelledby="tips-formats"] [data-tip-card="created-tip"]')).toBeVisible();

  await created.getByRole("button", { name: "Edit: Film the hook first" }).click();
  const edit = page.getByRole("dialog", { name: "Edit tip" });
  await edit.getByLabel("What the tip says and how to use it", { exact: true }).fill("Record the opening first.");
  await edit.getByRole("button", { name: "Save", exact: true }).click();
  await expect(edit).toBeHidden();
  expect(writes.at(-1)).toMatchObject({ method: "PATCH", body: { tip_summary: "Record the opening first.", tip_group: "formats" } });
  await expect(created).toContainText("Record the opening first.");
});

test("Czech IG TIPS reads at 360 px without overflow or axe violations", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the width is set explicitly");
  await page.setViewportSize({ width: 360, height: 800 });
  await gotoPreview(page, { lang: "cs", theme: "dark" });
  await openTips(page, true, true);
  const main = page.locator("#main-content");
  await expect(main.getByRole("heading", { level: 2, name: /^Nápady na obsah/ })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: /^Bez skupiny/ })).toBeVisible();
  await expect(main.locator('[data-tip-card="tip1"]')).toContainText("Z Reelu na Instagramu · Pro own-dashboard");
  // Every visible card action keeps a 44 px touch target.
  const heights = await main.locator('[data-tip-card="tip2"]').locator("button:visible, a:visible").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThanOrEqual(4);
  for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const { violations } = await new AxeBuilder({ page: page as unknown as AxePage }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(violations).toEqual([]);
});
