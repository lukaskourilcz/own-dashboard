import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { finances } from "../src/lib/i18n/sections/finances";
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

for (const lang of ["en", "cs"] as const) {
  const copy = finances[lang].rules;
  const save = lang === "cs" ? "Uložit" : "Save";
  test(`${lang}: rule edits retain explicit clears, failed drafts and captured versions`, async ({ page }) => {
    await gotoPreview(page, { lang }); await signInFixtureUser(page);
    const row = { id: "11111111-1111-4111-8111-111111111111", user_id: "u1", name: "Audit rule", stage: "default", enabled: true,
      conditions: [{ field: "note", op: "contains", value: "merchant" }], actions: { category: null, note: null }, sort_order: 0,
      created_at: "2026-10-23T12:00:00Z", updated_at: "2026-10-23T12:00:00Z" };
    let writes = 0; let release!: () => void; let payload: Record<string, unknown> = {};
    await page.route("**/rest/v1/transaction_rules**", async route => {
      if (route.request().method() !== "PATCH") return route.fulfill({ json: [row] });
      payload = route.request().postDataJSON(); writes++;
      expect(new URL(route.request().url()).searchParams.get("updated_at")).toBe(`eq.${row.updated_at}`);
      if (writes === 1) { await new Promise<void>(resolve => { release = resolve; }); return route.fulfill({ status: 500, json: { message: "Synthetic conflict" } }); }
      return route.fulfill({ json: { id: row.id } });
    });
    await page.goto("/dev-preview?tab=categories");
    await page.getByRole("button", { name: `${lang === "cs" ? "Upravit" : "Edit"}: Audit rule`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: copy.editRule });
    await expect(dialog.getByRole("checkbox", { name: copy.actionCategory, exact: true })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: copy.actionNote, exact: true })).toBeChecked();
    await dialog.getByRole("textbox", { name: copy.ruleName, exact: true }).fill("Retained draft");
    await dialog.getByRole("button", { name: copy.addCondition, exact: true }).click();
    await expect(dialog.getByRole("button", { name: save, exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: copy.checkAll, exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: `${copy.removeCondition} 2`, exact: true }).click();
    await page.route("**/api/money/rules/apply", route => route.fulfill({ json: { matched: 2, changed: 1, updated: 0 } }));
    await dialog.getByRole("button", { name: copy.checkAll, exact: true }).click();
    await expect(dialog.getByText(copy.checkedResult(2, 1), { exact: false })).toBeVisible();
    await dialog.getByRole("textbox", { name: copy.actionNote, exact: true }).fill("Changed");
    await expect(dialog.getByText(copy.checkedResult(2, 1), { exact: false })).toHaveCount(0);
    await dialog.getByRole("textbox", { name: copy.actionNote, exact: true }).fill("");
    await dialog.getByRole("button", { name: save, exact: true }).click();
    await expect.poll(() => !!release).toBe(true);
    await expect(dialog.getByRole("textbox", { name: copy.ruleName, exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); release();
    await expect(dialog.getByRole("alert")).toHaveText(copy.saveErr);
    await expect(dialog.getByRole("textbox", { name: copy.ruleName, exact: true })).toHaveValue("Retained draft");
    expect(payload.actions).toEqual({ category: null, note: null }); expect(payload).not.toHaveProperty("user_id");
    expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      if (lang === "cs" && (width === 360 || width === 1440)) await dialog.screenshot({ path: `/tmp/app-audit-rule-editor-cs-${width}.png` });
    }
    await dialog.getByRole("button", { name: save, exact: true }).click(); await expect(dialog).toHaveCount(0); expect(writes).toBe(2);
  });

  test(`${lang}: an ambiguous rule creation retries the same identity without overwriting it`, async ({ page }) => {
    await gotoPreview(page, { lang, theme: "dark" }); await signInFixtureUser(page);
    let created: Record<string, unknown> | null = null; const ids: string[] = [];
    await page.route("**/rest/v1/transaction_rules**", async route => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON() as Record<string, unknown>; ids.push(String(payload.id));
        expect(url.searchParams.get("on_conflict")).toBe("id"); expect(route.request().headers().prefer).toContain("resolution=ignore-duplicates");
        if (!created) { created = { ...payload, updated_at: "2026-10-23T12:00:00Z", created_at: "2026-10-23T12:00:00Z", sort_order: 0 }; return route.fulfill({ status: 503, json: {} }); }
        return route.fulfill({ json: [] });
      }
      return route.fulfill({ json: url.searchParams.has("id") ? created : created ? [created] : [] });
    });
    await page.goto("/dev-preview?tab=categories"); await page.getByRole("button", { name: copy.newRule, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: copy.newRule });
    await dialog.getByRole("textbox", { name: `${copy.value} 1`, exact: true }).fill("merchant");
    await dialog.getByRole("checkbox", { name: copy.actionNote, exact: true }).check();
    await dialog.getByRole("button", { name: save, exact: true }).click(); await expect(dialog.getByRole("alert")).toHaveText(copy.saveErr);
    await dialog.getByRole("button", { name: save, exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(ids).toHaveLength(2); expect(new Set(ids).size).toBe(1);
    expect(created).toMatchObject({ actions: { note: null } });
  });
}
