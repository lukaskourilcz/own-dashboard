import { test, expect, type Locator, type Page } from "@playwright/test";
import { gotoPreview, watchConsole } from "./helpers";

/**
 * Owner request, 9 November 2026: the publishing calendar shows exactly what the Design Lab shows. On /dev-preview
 * both read the same in-memory revisions, so the calendar's slides are the Lab's deck strip and its story is the
 * Lab's Story 9:16 render. Each pair is saved side by side under test-results/.
 */
test.beforeEach(async ({}, info) => { test.skip(info.project.name === "mobile", "the round trip uses the desktop sidebar"); });

async function openDneskaiPost(page: Page) {
  await page.goto("/dev-preview?tab=schedule");
  const card = page.getByTestId("publishing-calendar").getByRole("listitem").filter({ hasText: "DNESKAi" }).first().getByRole("button");
  const cover = await card.locator("img").first().evaluate((item) => (item as HTMLImageElement).currentSrc || (item as HTMLImageElement).src);
  await card.click();
  const dialog = page.getByTestId("publishing-post-dialog");
  await expect(dialog).toBeVisible();
  return Object.assign(dialog, { cover });
}

const sources = (images: Locator) => images.evaluateAll((items) => items.map((item) => (item as HTMLImageElement).currentSrc || (item as HTMLImageElement).src));

/** Two element screenshots next to each other in one PNG, for the owner to compare. */
async function sideBySide(page: Page, left: Buffer, right: Buffer, path: string) {
  const other = await page.context().newPage();
  await other.setContent(`<body style="margin:0;display:flex;gap:16px;align-items:flex-start;background:#fff;font:12px system-ui">
    <figure style="margin:8px"><figcaption>Publishing calendar</figcaption><img src="data:image/png;base64,${left.toString("base64")}"></figure>
    <figure style="margin:8px"><figcaption>Design Lab</figcaption><img src="data:image/png;base64,${right.toString("base64")}"></figure></body>`);
  await other.screenshot({ path, fullPage: true });
  await other.close();
}

test("DNESKAi slides and cover in the calendar are the Design Lab's renders of the same revision", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  const dialog = await openDneskaiPost(page);
  await dialog.getByRole("tab", { name: "Post", exact: true }).click();
  const [whole, media] = await Promise.all([dialog.boundingBox(), dialog.getByTestId("publishing-post-media").boundingBox()]);
  expect(media!.width / whole!.width).toBeCloseTo(1 / 3, 2);
  expect(media!.x).toBeLessThan(whole!.x + 2);
  await expect(page.locator('[data-status="published"]')).toHaveClass(/text-success/);
  await expect(page.locator('[data-status="failed"]')).toHaveClass(/text-risk/);
  const slides = dialog.getByTestId("version-slides").locator("img");
  await expect(slides.first()).toBeVisible();
  const calendarSources = await sources(slides);
  if (calendarSources.length > 1) {
    await dialog.getByRole("button", { name: "Next slide" }).click();
    await expect(slides.nth(1)).toBeVisible();
    await dialog.getByRole("button", { name: "Previous slide" }).click();
  }
  const calendarShot = await dialog.screenshot();
  await dialog.getByRole("button", { name: "Edit in Design Lab" }).click();
  await expect(page).toHaveURL(/labPost=/);
  const strip = page.getByTestId("dneskai-deck-strip");
  await expect(strip.locator("img").first()).toBeVisible();
  const labSources = await sources(strip.locator("img"));
  expect(calendarSources.length).toBeGreaterThan(0);
  expect(calendarSources).toEqual(labSources);
  // The card's cover is the Lab's first slide.
  expect(dialog.cover).toBe(labSources[0]);
  // The Feed view shows the saved slides as the Lab stores them; pin the sticky action bar for the capture.
  await page.getByTestId("dneskai-lab-stage").getByText("Feed", { exact: true }).click();
  await expect(page.getByTestId("dneskai-lab-stage").locator("figure img").first()).toHaveAttribute("src", labSources[0]!);
  await page.addStyleTag({ content: '[data-testid="dneskai-lab"] .sticky { position: static !important; }' });
  await sideBySide(page, calendarShot, await page.getByTestId("dneskai-lab-stage").screenshot(), "test-results/calendar-vs-lab-dneskai-slides.png");
  expect(errors).toEqual([]);
});

test("the DNESKAi story in the calendar is the Design Lab's 9:16 story render, not the 4:5 cover", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  const dialog = await openDneskaiPost(page);
  await dialog.getByRole("tab", { name: "Story", exact: true }).click();
  const frame = dialog.getByTestId("story-frame");
  const image = frame.getByTestId("story-image");
  await expect(image).toBeVisible({ timeout: 20_000 });
  const calendarStory = await image.getAttribute("src");
  expect(calendarStory).toMatch(/^data:image\/webp;base64,/);
  const ratio = await image.evaluate((item) => (item as HTMLImageElement).naturalHeight / (item as HTMLImageElement).naturalWidth);
  expect(ratio).toBeGreaterThan(1.7);
  const calendarShot = await frame.screenshot();
  await dialog.getByRole("button", { name: "Edit in Design Lab" }).click();
  await expect(page).toHaveURL(/labView=story/);
  const story = page.getByTestId("dneskai-story");
  await expect(story.getByTestId("dneskai-story-image")).toBeVisible({ timeout: 20_000 });
  expect(await story.getByTestId("dneskai-story-image").getAttribute("src")).toBe(calendarStory);
  await page.addStyleTag({ content: '[data-testid="dneskai-lab"] .sticky { position: static !important; }' });
  await sideBySide(page, calendarShot, await story.screenshot(), "test-results/calendar-vs-lab-dneskai-story.png");
  expect(errors).toEqual([]);
});

test("an unrendered devShark concept in the calendar is the Studio's own slide, and its story shows no stand-in", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=schedule");
  await page.getByTestId("publishing-calendar").getByRole("listitem").filter({ hasText: "devShark" }).first().getByRole("button").click();
  const dialog = page.getByTestId("publishing-post-dialog");
  await dialog.getByRole("tab", { name: "Story", exact: true }).click();
  await expect(dialog.getByTestId("story-frame").locator("img, svg")).toHaveCount(0);
  await expect(dialog.getByTestId("story-frame")).toContainText("Not rendered yet.");
  await dialog.getByRole("tab", { name: "Post", exact: true }).click();
  const calendarSlide = dialog.getByTestId("version-slides").getByTestId("devshark-studio-slide").first();
  await expect(calendarSlide).toBeVisible();
  const calendarSvg = await calendarSlide.locator("svg").first().evaluate((svg) => svg.outerHTML);
  const calendarShot = await dialog.screenshot();
  await dialog.getByRole("button", { name: "Edit in Design Lab" }).click();
  const canvas = page.getByTestId("design-studio-canvas");
  await expect(canvas).toBeVisible();
  expect(await canvas.locator("svg").first().evaluate((svg) => svg.outerHTML)).toBe(calendarSvg);
  await sideBySide(page, calendarShot, await canvas.screenshot(), "test-results/calendar-vs-lab-devshark.png");
  expect(errors).toEqual([]);
});
