import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";
import { categories } from "../src/lib/i18n/sections/categories";
import { nav } from "../src/lib/i18n/sections/nav";
import { subscriptions } from "../src/lib/i18n/sections/subscriptions";

const owner = "11111111-1111-4111-8111-111111111111";
const stored = { id: "22222222-2222-4222-8222-222222222222", user_id: owner, name: "Software", sort_order: 0, created_at: "2026-10-25T00:00:00.123456Z" };
for (const lang of ["en", "cs"] as const) test(`${lang}: categories retain failed drafts, wait for confirmation and preserve legacy labels`, async ({ page }) => {
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  let readFails = true, createFails = true, deleteFails = true, creates = 0, deletes = 0;
  let release: (() => void) | undefined;
  const requests: Record<string, unknown>[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/rest/v1/spend_categories**", async route => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill(readFails ? { status: 503, json: { message: "Synthetic unavailable" } } : { json: [stored], headers: { "content-range": "0-0/1", "access-control-expose-headers": "content-range" } });
    if (method === "POST") {
      creates++; requests.push(route.request().postDataJSON());
      if (createFails) return route.fulfill({ status: 503, json: { message: "Synthetic unavailable" } });
      await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ status: 409, json: { code: "23505", message: "Synthetic existing name" } });
    }
    deletes++; return route.fulfill({ json: deleteFails ? [] : [stored] });
  });
  await page.goto("/dev-preview?tab=subscriptions&categories=live");
  await page.getByRole("button", { name: subscriptions[lang].addSubscription, exact: true }).click();
  await page.locator("#sub-name").fill("Unsaved parent subscription");
  await page.getByRole("button", { name: categories[lang].manage, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: categories[lang].manageTitle, exact: true });
  await expect(dialog.getByRole("alert")).toContainText(categories[lang].loadErr);
  const input = dialog.getByRole("textbox", { name: categories[lang].newName, exact: true });
  await input.fill("software"); readFails = false;
  await dialog.getByRole("button", { name: lang === "en" ? "Try again" : "Zkusit znovu", exact: true }).click();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await dialog.boundingBox(); expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await expect.poll(() => input.evaluate(element => element.getBoundingClientRect().height)).toBe(width < 768 ? 44 : 32);
    const field = await input.boundingBox(), action = await dialog.getByRole("button", { name: categories[lang].create, exact: true }).boundingBox();
    expect(field).not.toBeNull(); expect(action).not.toBeNull(); expect(field!.height).toBe(action!.height); expect(action!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
    expect(Math.abs(field!.y - action!.y)).toBeLessThanOrEqual(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: test.info().project.name === "mobile" ? 430 : 1440, height: 1000 });
  await dialog.screenshot({ path: `/tmp/app-audit-category-${lang}-${test.info().project.name}.png` });
  const add = dialog.getByRole("button", { name: categories[lang].create, exact: true });
  await expect(add).toBeEnabled(); await add.click();
  await expect(dialog.getByRole("alert")).toContainText(categories[lang].saveErr); await expect(input).toHaveValue("software");
  await dialog.getByRole("button", { name: lang === "en" ? "Close" : "Zavřít", exact: true }).click();
  await page.getByRole("button", { name: categories[lang].manage, exact: true }).click(); await expect(input).toHaveValue("software");
  createFails = false; await add.click(); await expect.poll(() => creates).toBe(2);
  await expect(input).toBeDisabled(); await page.keyboard.press("Escape"); await expect(dialog).toBeVisible();
  release!(); await expect(dialog).toBeHidden(); expect(requests[0]).toEqual(requests[1]);
  await expect(page.locator("#sub-category")).toContainText("Software");
  await expect(page.locator("#sub-name")).toHaveValue("Unsaved parent subscription");
  await expect(page.getByText(subscriptions[lang].nameAndAmountRequired, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: categories[lang].manage, exact: true }).click();
  await dialog.getByRole("button", { name: `${categories[lang].deleteAria}: Software`, exact: true }).click();
  const confirm = page.getByRole("dialog", { name: categories[lang].removeTitle, exact: true });
  await confirm.getByRole("button", { name: categories[lang].remove, exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(categories[lang].changed); expect(deletes).toBe(1);
  await dialog.getByRole("button", { name: lang === "en" ? "Try again" : "Zkusit znovu", exact: true }).click();
  deleteFails = false; await dialog.getByRole("button", { name: `${categories[lang].deleteAria}: Software`, exact: true }).click();
  await confirm.getByRole("button", { name: categories[lang].remove, exact: true }).click();
  await expect(dialog.getByRole("button", { name: `${categories[lang].deleteAria}: Software`, exact: true })).toHaveCount(0);
  await expect(input).toBeFocused();
  await expect.poll(() => input.evaluate(element => getComputedStyle(element).opacity)).toBe("1");
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]:not([aria-hidden="true"])').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape"); await expect(dialog).toBeHidden();
  await expect(page.locator("#sub-category")).toContainText("Software"); expect(errors).toEqual([]);
});

for (const lang of ["en", "cs"] as const) test(`${lang}: fixture and guest category management require an owner without a private request`, async ({ page }) => {
  await gotoPreview(page, { lang }); let reads = 0;
  await page.route("**/rest/v1/spend_categories**", route => { reads++; return route.fulfill({ json: [] }); });
  for (const url of ["/dev-preview?tab=subscriptions", `/guest?lang=${lang}`]) {
    await page.goto(url);
    if (url.startsWith("/guest")) {
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        await page.getByTestId("mobile-nav").getByRole("button", { name: nav[lang].more, exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: subscriptions[lang].title, exact: true }).click();
      } else await page.locator("aside").getByRole("button", { name: subscriptions[lang].title, exact: true }).click();
    }
    await page.getByRole("button", { name: subscriptions[lang].addSubscription, exact: true }).click();
    await page.getByRole("button", { name: categories[lang].manage, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: categories[lang].manageTitle, exact: true });
    await expect(dialog.getByText(categories[lang].readOnly, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: categories[lang].newName, exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: categories[lang].create, exact: true })).toBeDisabled();
  }
  expect(reads).toBe(0);
});
