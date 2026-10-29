import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { projects as copy } from "../src/lib/i18n/sections/projects";
import { professional } from "../src/lib/i18n/sections/professional";
const owner = "11111111-1111-4111-8111-111111111111", stamp = "2026-10-24T09:00:00Z";
const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd"];
for (const lang of ["en", "cs"] as const) test(`${lang}: shared project/task index respects known and inactive repository identities`, async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  const rows = ids.map((id, index) => ({ id, user_id: owner, name: ["Renamed", "Actual", "Legacy", "Inactive actual"][index], slug: `identity-${index}`, repo_id: [101, 999, null, 888][index], repo_full_name: ["owner/new", "owner/reused", "owner/reused", "owner/inactive"][index], previous_repo_full_names: index === 0 ? ["owner/reused", "owner/old"] : [], sort_order: index === 2 ? -1 : index, is_active: index !== 3, engagement: "own", parent_id: null, notes: "", url: null, dev_url: null, color: null, created_at: stamp, updated_at: stamp }));
  const tasks = [
    { title: "Known identity", repo_id: "999", repo_full_name: "owner/reused" },
    { title: "Legacy fallback", repo_id: null, repo_full_name: " OWNER/REUSED " },
    { title: "Historical fallback", repo_id: null, repo_full_name: " OWNER/OLD " },
    { title: "Explicit binding", project_id: ids[0], repo_id: "999", repo_full_name: "owner/reused" },
    { title: "Inactive known identity", repo_id: "888", repo_full_name: "owner/reused" },
    { title: "Conflicting known identity", repo_id: "777", repo_full_name: "owner/new" },
    { title: "Global inactive binding", is_global: true, repo_id: "888", repo_full_name: "owner/reused" },
  ].map((row, index) => ({ id: `fixture-task-${index}`, user_id: owner, source: "github", project_id: null, is_global: false, done: false, importance: 3, due_date: "2000-01-01", created_at: stamp, updated_at: stamp, ...row }));
  await page.route("**/api/vercel/analytics?**", route => route.fulfill({ json: { kind: "unconfigured" } }));
  let writes = 0;
  await page.route("**/rest/v1/rpc/read_owned_collection", route => route.fulfill({ json: ({ projects: rows, todos: tasks } as Record<string, unknown>)[route.request().postDataJSON().p_entity] ?? [] }));
  await page.route("**/rest/v1/todos?**", route => { if (route.request().method() !== "GET") writes++; return route.fulfill({ json: [] }); });
  await page.goto("/dev-preview?tab=projects&projectRecords=live");
  const table = page.getByRole("table", { name: copy[lang].title, exact: true });
  for (const [name, count] of [["Renamed", "2"], ["Actual", "1"], ["Legacy", "1"]]) {
    const row = table.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
    await expect(row).toHaveCount(1); await expect(row.getByRole("cell").nth(6)).toHaveText(count);
  }
  await expect(table.getByRole("link", { name: "Inactive actual", exact: true })).toHaveCount(0);
  await table.getByRole("link", { name: "Actual", exact: true }).click();
  await page.getByRole("tab", { name: professional[lang].projectTasksNotes, exact: true }).click();
  await expect(page.getByText("Known identity", { exact: true })).toBeVisible();
  for (const name of ["Legacy fallback", "Explicit binding", "Inactive known identity", "Conflicting known identity"]) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  await page.goto("/dev-preview?tab=tasks&projectRecords=live");
  await expect(page.getByText("Known identity", { exact: true })).toBeVisible();
  for (const name of ["Legacy fallback", "Historical fallback", "Explicit binding", "Global inactive binding"]) await expect(page.getByText(name, { exact: true })).toBeVisible();
  for (const name of ["Inactive known identity", "Conflicting known identity"]) await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  const actual = page.getByRole("link", { name: "Actual", exact: true }).locator("xpath=ancestor::div[contains(@class,'break-inside-avoid')]");
  await expect(actual.getByText("Known identity", { exact: true })).toBeVisible(); await expect(actual.getByText("Legacy fallback", { exact: true })).toHaveCount(0);
  await page.goto("/dev-preview?tab=work&projectRecords=live");
  for (const [name, count] of [["Renamed", "2"], ["Actual", "1"], ["Legacy", "1"]]) {
    const attention = page.getByRole("main").getByRole("link").filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByText(`${professional[lang].overdueTasks}: ${count}`, { exact: true }) });
    await expect(attention).toHaveCount(1);
    await expect(attention.getByText(`${professional[lang].overdueTasks}: ${count}`, { exact: true })).toBeVisible();
  }
  expect(writes).toBe(0);
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});
