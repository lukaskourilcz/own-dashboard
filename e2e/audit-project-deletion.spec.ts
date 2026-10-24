import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { projects } from "../src/lib/i18n/sections/projects";
import { common } from "../src/lib/i18n/sections/common";
import type { Project } from "../src/lib/types";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner = "11111111-1111-4111-8111-111111111111";
async function fixture(page: Page, lang: "en" | "cs") {
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  let row: Project | null = { id, user_id: owner, name: "Delete fixture", slug: "delete-fixture", notes: "Private retained note", repo_full_name: null, repo_id: null, previous_repo_full_names: [], previous_slugs: [],
    sort_order: 0, is_active: true, engagement: "own", organization_id: null, parent_id: null, url: null, dev_url: null, color: null, created_at: "2026-10-24T09:00:00Z", updated_at: "2026-10-24T09:00:00Z" };
  let calls = 0, fail = false, suppress = false, lost = false, hold = false, release: (() => void) | undefined;
  await page.route("**/rest/v1/rpc/read_owned_collection", route => route.fulfill({ json: route.request().postDataJSON().p_entity === "projects" && row ? [row] : [] }));
  await page.route("**/rest/v1/projects?**", async route => {
    if (route.request().method() !== "DELETE") return route.fulfill({ json: [] });
    calls++; const url = new URL(route.request().url()); expect(url.searchParams.get("id")).toBe(`eq.${id}`); expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    expect(url.searchParams.get("select")).toBe("id,user_id,updated_at"); expect(route.request().postData()).toBeNull();
    if (hold) await new Promise<void>(resolve => { release = resolve; }); release = undefined;
    if (lost) { row = null; return route.fulfill({ status: 503, json: { message: "Private backend details" } }); }
    if (fail) return route.fulfill({ status: 503, json: { message: "Private backend details" } });
    if (suppress || !row || url.searchParams.get("updated_at") !== `eq.${row.updated_at}`) return route.fulfill({ json: [] });
    const receipt = { id, user_id: owner, updated_at: row.updated_at }; row = null; return route.fulfill({ json: [receipt] });
  });
  await page.goto("/dev-preview?tab=projects&projectRecords=live"); await page.getByRole("table").getByRole("button", { name: projects[lang].manage, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: projects[lang].manage, exact: true }); await expect(dialog).toBeVisible();
  const confirm = () => page.getByRole("dialog", { name: projects[lang].deleteProject, exact: true });
  return { dialog, confirm, calls: () => calls, fail: (value: boolean) => { fail = value; }, lost: () => { lost = true; }, hold: () => { hold = true; },
    suppress: (value: boolean) => { suppress = value; }, external: () => { row = { ...row!, notes: "Newer private note", updated_at: "2026-10-24T09:01:00Z" }; },
    release: async () => { await expect.poll(() => typeof release).toBe("function"); release!(); } };
}
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: project deletion requires a confirmed result, protects pending exits and retries without exposing provider text`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang), t = projects[lang], c = common[lang]; f.fail(true); f.hold();
    await f.dialog.getByRole("button", { name: t.deleteProject, exact: true }).click(); await f.confirm().getByRole("button", { name: c.delete, exact: true }).click();
    await expect(f.dialog.getByRole("button", { name: t.deleteProject, exact: true })).toBeDisabled(); await expect(f.dialog.getByRole("button", { name: c.edit, exact: true })).toBeDisabled();
    await f.dialog.getByRole("button", { name: lang === "cs" ? "Zavřít" : "Close", exact: true }).click();
    const guard = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: c.unsaved.stay, exact: true }) }); await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: c.unsaved.stay, exact: true }).click(); await f.release();
    await expect(f.dialog.getByRole("alert")).toHaveText(t.deleteFailed); await expect(f.dialog.getByRole("button", { name: t.deleteProject, exact: true })).toBeEnabled();
    await expect(f.dialog).not.toContainText("Private backend details"); expect(f.calls()).toBe(1);
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    f.fail(false); f.suppress(true); await f.dialog.getByRole("button", { name: t.deleteProject, exact: true }).click(); await f.confirm().getByRole("button", { name: c.delete, exact: true }).click(); await f.release();
    await expect(f.dialog.getByRole("alert")).toHaveText(t.deleteConflict); expect(f.calls()).toBe(2);
    f.suppress(false); await f.dialog.getByRole("button", { name: t.deleteProject, exact: true }).click(); await f.confirm().getByRole("button", { name: c.delete, exact: true }).click(); await f.release();
    await expect(f.dialog).toHaveCount(0); await expect(page.getByRole("link", { name: "Delete fixture", exact: true })).toHaveCount(0); expect(f.calls()).toBe(3);
    expect(errors.filter(error => !(error.includes("503") && error.includes("/rest/v1/projects")))).toEqual([]);
  });
  test(`${lang}: stale project deletion keeps the updated project and cancellation sends no request`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang), t = projects[lang], c = common[lang];
    await f.dialog.getByRole("button", { name: t.deleteProject, exact: true }).click(); await f.confirm().getByRole("button", { name: c.cancel, exact: true }).click(); expect(f.calls()).toBe(0);
    await f.dialog.getByRole("button", { name: t.deleteProject, exact: true }).click(); f.external(); await f.confirm().getByRole("button", { name: c.delete, exact: true }).click();
    await expect(f.dialog.getByRole("alert")).toHaveText(t.deleteConflict); await expect(f.dialog.getByText("Newer private note", { exact: true })).toBeVisible(); expect(f.calls()).toBe(1);
    expect(errors).toEqual([]);
  });
  test(`${lang}: a lost delete reply reconciles removal and keeps its operations view readable`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang), t = projects[lang], c = common[lang]; f.lost();
    await f.dialog.getByRole("button", { name: t.deleteProject, exact: true }).click(); await f.confirm().getByRole("button", { name: c.delete, exact: true }).click();
    await expect(f.dialog.getByText(t.deleteFailed, { exact: true })).toBeVisible(); await expect(f.dialog.getByText(t.projectUnavailable, { exact: true })).toBeVisible();
    await expect(f.dialog.getByRole("button", { name: t.deleteProject, exact: true })).toBeDisabled(); await expect(f.dialog.getByText("Private retained note", { exact: true })).toBeVisible(); expect(f.calls()).toBe(1);
    expect(errors.filter(error => !(error.includes("503") && error.includes("/rest/v1/projects")))).toEqual([]);
  });
}
