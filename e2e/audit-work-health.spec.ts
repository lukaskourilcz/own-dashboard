import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { nav } from "../src/lib/i18n/sections/nav";
import { professional } from "../src/lib/i18n/sections/professional";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner = "11111111-1111-4111-8111-111111111111", stamp = "2026-10-23T09:00:00Z";
test.use({ timezoneId: "Europe/Prague" });
for (const lang of ["en", "cs"] as const) test(`${lang}: health changes on the clock and heartbeat warnings agree in Work and the workspace`, async ({ page }) => {
  const p = professional[lang], errors = watchConsole(page);
  let workspaceRequests = 0;
  page.on("request", request => { if (["/projects/clock-project", "/dates", "/career", "/opportunities"].includes(new URL(request.url()).pathname)) workspaceRequests++; });
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  await page.clock.install({ time: new Date("2026-10-23T21:30:00Z") });
  const project = { id, user_id: owner, name: "Clock project", slug: "clock-project", repo_full_name: null, sort_order: 0, is_active: true, engagement: "own", parent_id: null, status: "active", notes: "", url: null, dev_url: null, color: null, created_at: stamp, updated_at: stamp };
  const task = { id: "fixture-clock-task", user_id: owner, project_id: id, title: "Due today", source: "manual", done: false, is_global: false, importance: 3, due_date: "2026-10-23", repo_id: null, repo_full_name: null, created_at: stamp, updated_at: stamp };
  const cron = { id: "fixture-clock-cron", user_id: owner, project_id: id, name: "Hourly run", schedule: "0 * * * *", runs_per_month: 720, is_ai_call: false, cost_per_run: 0, currency: "USD", enabled: true, heartbeat_url: "https://example.test/heartbeat", last_success_at: "2026-10-23T20:00:00Z", created_at: stamp, updated_at: stamp };
  const records: Record<string, unknown[]> = { projects: [project], todos: [task], crons: [cron] };
  await page.route("**/rest/v1/rpc/read_owned_collection", route => route.fulfill({ json: records[route.request().postDataJSON().p_entity] ?? [] }));
  await page.goto("/dev-preview?projectRecords=live");
  const mobile = page.getByTestId("mobile-nav");
  if (await mobile.isVisible()) await mobile.getByRole("button", { name: nav[lang].sections.work, exact: true }).click();
  else await page.getByRole("complementary").getByRole("button", { name: nav[lang].sections.work, exact: true }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByText(p.attentionEmpty, { exact: true })).toBeVisible();
  await expect(page.getByText(`${p.overdueTasks}: 1`, { exact: true })).toHaveCount(0);
  await page.clock.fastForward(4 * 60 * 60 * 1000);
  const warning = `${p.overdueTasks}: 1 · ${p.missedHeartbeat}: 1`;
  await expect(page.getByText(warning, { exact: true })).toBeVisible();
  await page.getByRole("link").filter({ has: page.getByText(warning, { exact: true }) }).click();
  await expect(page).toHaveURL(/\/projects\/clock-project$/);
  expect(workspaceRequests).toBe(0);
  await expect(page.getByText(`${p.overdueTasks}: 1`, { exact: true })).toBeVisible();
  await expect(page.getByText(`${p.missedHeartbeat}: 1`, { exact: true })).toBeVisible();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  for (const tab of ["dates", "opportunities", "career"] as const) {
    await page.goBack();
    await expect(page.getByRole("heading", { name: p.workTitle, exact: true })).toBeVisible();
    await page.getByRole("main").locator(`a[href="/${tab}"]`).first().click();
    await expect(page.getByRole("heading", { name: nav[lang].sections[tab], exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/${tab}$`));
  }
  expect(workspaceRequests).toBe(0);
  expect(errors).toEqual([]);
});
