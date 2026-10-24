import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { projects } from "../src/lib/i18n/sections/projects";
import { common } from "../src/lib/i18n/sections/common";
import { settings } from "../src/lib/i18n/sections/settings";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner = "11111111-1111-4111-8111-111111111111";
async function fixture(page: Page, lang: "en" | "cs", tab: "settings" | "projects") {
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  let tick = 0, writes = 0, direct = 0, reads = 0, mode: "saved" | "conflict" | "ambiguous" = "saved", release: (() => void) | undefined;
  const stamp = () => new Date(Date.UTC(2026, 9, 24, 13, 0, tick++)).toISOString();
  let row = { id, user_id: owner, name: "Preference fixture", slug: "preference-fixture", notes: "Private fixture note", repo_full_name: null, sort_order: 0, is_active: true, engagement: "own", parent_id: null, url: null, dev_url: null, color: null, created_at: stamp(), updated_at: stamp() };
  await page.route("**/rest/v1/rpc/read_owned_collection", route => { if (route.request().postDataJSON().p_entity === "projects") { reads++; return route.fulfill({ json: [row] }); } return route.fulfill({ json: [] }); });
  await page.route("**/rest/v1/projects?**", route => { if (route.request().method() !== "GET") direct++; return route.fulfill({ json: [] }); });
  await page.route("**/rest/v1/rpc/set_project_preferences", async route => {
    writes++; const input = route.request().postDataJSON(); expect(Object.keys(input).sort()).toEqual(["p_expected_updated_at", "p_id", "p_patch"]); expect(input.p_id).toBe(id);
    expect(JSON.stringify(input)).not.toContain("Private fixture note");
    await new Promise<void>(resolve => { release = resolve; }); release = undefined;
    if (mode === "conflict") row = { ...row, name: "Changed elsewhere", updated_at: stamp() };
    const before = row.updated_at, previous = Object.fromEntries(Object.keys(input.p_patch).map(key => [key, row[key as keyof typeof row]]));
    const kind = mode === "conflict" ? "conflict" : "saved";
    if (kind === "saved") row = { ...row, ...input.p_patch, updated_at: stamp() };
    if (mode === "ambiguous") return route.fulfill({ status: 503, json: { message: "Private fixture failure" } });
    return route.fulfill({ json: { kind, id, user_id: owner, values: kind === "saved" ? input.p_patch : previous, previous_values: previous, source_updated_at: before, updated_at: row.updated_at } });
  });
  await page.goto(`/dev-preview?tab=${tab}&projectRecords=live`);
  return { state: () => ({ writes, direct, reads, row }), mode: (next: typeof mode) => { mode = next; },
    release: async () => { await expect.poll(() => typeof release).toBe("function"); release!(); } };
}

for (const lang of ["en", "cs"] as const) {
  test(`${lang}: Settings confirms project classification, exposes conflicts and reconciles lost replies`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang, "settings"), t = projects[lang];
    const row = page.locator('[data-settings-project="preference-fixture"]'), toggle = row.getByRole("switch"), client = row.getByRole("button", { name: t.engagementClient, exact: true });
    await expect(toggle).toBeChecked(); await client.focus(); await page.keyboard.press("Enter");
    await expect(toggle).toBeDisabled(); await expect(client).toBeDisabled(); await expect(client).toHaveAttribute("aria-pressed", "false");
    await f.release(); await expect(client).toHaveAttribute("aria-pressed", "true"); await expect(toggle).toBeEnabled();
    const reads = f.state().reads; expect(f.state().row.notes).toBe("Private fixture note");
    f.mode("conflict"); await row.getByRole("button", { name: t.engagementOwn, exact: true }).click(); await f.release();
    await expect(page.getByText(t.preferenceConflict, { exact: true })).toBeVisible(); await expect(row.getByText("Changed elsewhere", { exact: true })).toBeVisible();
    await expect(client).toHaveAttribute("aria-pressed", "true"); expect(f.state().reads).toBeGreaterThan(reads);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect.poll(async () => (await client.boundingBox())!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
    }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    f.mode("ambiguous"); await toggle.click(); await expect(toggle).toBeChecked(); await expect(toggle).toBeDisabled(); await f.release();
    await expect(page.getByText(t.preferenceSaveFailed, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: settings[lang].showInactiveProjects(1), exact: true }).click();
    await expect(toggle).not.toBeChecked(); expect(f.state().row.is_active).toBe(false); expect(f.state().writes).toBe(3); expect(f.state().direct).toBe(0);
    expect(errors.filter(error => !(error.includes("503") && error.includes("/rpc/set_project_preferences")))).toEqual([]);
  });
  test(`${lang}: project operations keep a pending active change guarded and confirm it without a direct PATCH`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang, "projects"), t = projects[lang], c = common[lang];
    await page.getByRole("table").getByRole("button", { name: t.manage, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: t.manage, exact: true }), toggle = dialog.getByRole("button", { name: t.markInactive, exact: true });
    await toggle.click(); await expect(toggle).toBeDisabled(); await expect(toggle).toHaveAttribute("aria-busy", "true");
    await dialog.getByRole("button", { name: lang === "cs" ? "Zavřít" : "Close", exact: true }).click();
    const guard = page.getByRole("dialog", { name: c.unsaved.pendingTitle, exact: true }); await expect(guard).toBeVisible();
    await expect(guard.getByRole("button", { name: c.unsaved.discard, exact: true })).toBeDisabled();
    await guard.getByRole("button", { name: c.unsaved.stay, exact: true }).click(); await f.release();
    await expect(dialog.getByRole("button", { name: t.markActive, exact: true })).toBeEnabled();
    expect(f.state().row.is_active).toBe(false); expect(f.state().writes).toBe(1); expect(f.state().direct).toBe(0); expect(errors).toEqual([]);
  });
}
