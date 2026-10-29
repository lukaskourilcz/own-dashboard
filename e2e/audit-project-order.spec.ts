import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { projects } from "../src/lib/i18n/sections/projects";
import { nav } from "../src/lib/i18n/sections/nav";
import { common } from "../src/lib/i18n/sections/common";
const owner = "11111111-1111-4111-8111-111111111111", stamp = "2026-10-24T09:00:00Z", newer = "2026-10-24T09:01:00Z", savedAt = "2026-10-24T09:02:00Z";
const ids = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"];
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: keyboard project order is atomic, preserves refreshed rows and guards pending navigation`, async ({ page }) => {
    const t = projects[lang], u = common[lang].unsaved, errors = watchConsole(page);
    await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    let rows = ids.map((id, index) => ({ id, user_id: owner, name: ["A", "B", "C", "Client", "Child"][index], slug: `fixture-${index}`, sort_order: index, is_active: true, engagement: index === 3 ? "client" : "own", parent_id: index === 4 ? ids[0] : null, notes: "", url: null, dev_url: null, repo_full_name: null, color: null, created_at: stamp, updated_at: stamp }));
    let writes = 0, finish: (() => void) | undefined;
    await page.route("**/rest/v1/rpc/read_owned_collection", route => route.fulfill({ json: route.request().postDataJSON().p_entity === "projects" ? rows : [] }));
    await page.route("**/rest/v1/rpc/reorder_owned_projects", async route => {
      const input = route.request().postDataJSON().p_rows as { id: string; user_id: string; previous_sort_order: number; sort_order: number; updated_at: string }[];
      expect(input).toHaveLength(3); expect(new Set(input.map(row => row.id))).toEqual(new Set(ids.slice(0, 3))); expect(input.map(row => row.id)).toEqual([ids[1], ids[0], ids[2]]);
      expect(input.every(row => row.user_id === owner && !('notes' in row))).toBe(true);
      const attempt = ++writes; await new Promise<void>(resolve => { finish = resolve; });
      if (attempt === 1) { rows = rows.map(row => row.id === ids[0] ? { ...row, name: "A refreshed elsewhere", updated_at: newer } : row); return route.fulfill({ status: 409, json: { message: "Synthetic stale project group" } }); }
      expect(input.find(row => row.id === ids[0])!.updated_at).toBe(newer);
      const changed = input.filter(row => row.previous_sort_order !== row.sort_order);
      rows = rows.map(row => { const change = changed.find(item => item.id === row.id); return change ? { ...row, sort_order: change.sort_order, updated_at: savedAt } : row; });
      return route.fulfill({ json: changed.map(row => ({ id: row.id, user_id: owner, sort_order: row.sort_order, updated_at: savedAt })) });
    });
    try {
    await page.goto("/dev-preview?tab=projects&projectRecords=live");
    const table = page.getByRole("table", { name: t.title, exact: true }); await expect(table.getByRole("link", { name: "A", exact: true })).toBeVisible();
    const moveA = async (name: string) => {
      const handle = table.getByRole("button", { name: `${t.dragHandle}: ${name}`, exact: true }); await handle.focus(); await expect(handle).toBeFocused(); await page.keyboard.press("Space");
      await expect(handle).toHaveAttribute("aria-roledescription", t.dragRole); await expect(handle).toHaveAttribute("aria-pressed", "true"); await expect(page.getByText(t.dragOver(name, name), { exact: true })).toHaveCount(1);
      // Sortable targets are measured after the keyboard pickup frame.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await page.keyboard.press("ArrowDown"); await expect(page.getByText(t.dragOver(name, "B"), { exact: true })).toHaveCount(1); await page.keyboard.press("Space");
    };
    await moveA("A"); await expect.poll(() => writes).toBe(1); await expect(page.getByText(t.orderSaving, { exact: true })).toBeVisible();
    await expect(table.getByRole("button", { name: `${t.dragHandle}: A`, exact: true })).toBeDisabled();
    const mobile = page.getByTestId("mobile-nav");
    if (await mobile.isVisible()) await mobile.getByRole("button", { name: nav[lang].short.home ?? nav[lang].sections.home, exact: true }).click();
    else await page.locator("aside").getByRole("button", { name: nav[lang].sections.home, exact: true }).click();
    const guard = page.getByRole("dialog", { name: u.pendingTitle, exact: true }); await expect(guard).toBeVisible(); await expect(guard.getByRole("button", { name: u.discard, exact: true })).toBeDisabled();
    finish!(); await expect(page.locator(".mac-toolbar h1")).toHaveText(nav[lang].sections.home); await expect(page.getByRole("dialog")).toHaveCount(0);
    if (await mobile.isVisible()) {
      const failure = page.locator("[data-sonner-toast]").filter({ hasText: t.orderFailed }); await expect(failure).toBeVisible();
      const original = page.viewportSize()!;
      // Include the interval between Sonner's 600px and the app's 768px breakpoints.
      for (const width of [360, 430, 640, 767]) {
        await page.setViewportSize({ width, height: original.height });
        await failure.hover();
        await expect.poll(async () => { const toast = await failure.boundingBox(), bar = await mobile.boundingBox(); return !!toast && !!bar && toast.y + toast.height <= bar.y - 8; }).toBe(true);
        expect((await failure.getByRole("button", { name: common[lang].closeNotification, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
        if (lang === "cs" && (width === 360 || width === 767)) {
          const box = (await failure.boundingBox())!, y = Math.max(0, Math.floor(box.y) - 8);
          await page.screenshot({ path: `/tmp/app-audit-toast-clearance-cs-${width}.png`, clip: { x: 0, y, width, height: original.height - y } });
        }
      }
      await page.setViewportSize(original);
    }
    if (await mobile.isVisible()) await mobile.getByRole("button", { name: nav[lang].short.projects ?? nav[lang].sections.projects, exact: true }).click();
    else await page.locator("aside").getByRole("button", { name: nav[lang].sections.projects, exact: true }).click();
    await expect(table.getByRole("link", { name: "A refreshed elsewhere", exact: true })).toBeVisible();
    const names = () => table.locator('tbody tr td:nth-child(2) > a').allTextContents();
    await expect.poll(names).toEqual(["A refreshed elsewhere", "Child", "B", "C", "Client"]);
    // The earlier failure remains dismissible after navigation. Clear that
    // acknowledged notice before testing a pointer gesture on the last row.
    const notice = page.locator("[data-sonner-toast]").filter({ hasText: t.orderFailed });
    if (await notice.isVisible()) {
      await notice.hover();
      if (lang === "cs" && page.viewportSize()?.width === 1440) await notice.screenshot({ path: "/tmp/app-audit-toast-feedback-cs-1440.png" });
      expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("[data-sonner-toast]").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      await notice.getByRole("button", { name: common[lang].closeNotification, exact: true }).click(); await expect(notice).toHaveCount(0);
    }
    await moveA("A refreshed elsewhere"); await expect.poll(() => writes).toBe(2); finish!();
    await expect.poll(names).toEqual(["B", "A refreshed elsewhere", "Child", "C", "Client"]); await expect(page.getByText(t.orderSaving, { exact: true })).toHaveCount(0); expect(writes).toBe(2);
    await expect(table.getByRole("button", { name: `${t.dragHandle}: A refreshed elsewhere`, exact: true })).toBeFocused();
    // Child rows are not targets, and another engagement group cannot become
    // a drop target or claim that an ignored cross-group move was saved.
    const childRow = table.getByRole("row").filter({ has: page.getByRole("link", { name: "Child", exact: true }) });
    await expect(childRow.getByRole("button", { name: new RegExp(t.dragHandle) })).toHaveCount(0);
    const clientHandle = table.getByRole("button", { name: `${t.dragHandle}: Client`, exact: true });
    const clientBox = (await clientHandle.boundingBox())!, ownBox = (await table.getByRole("button", { name: `${t.dragHandle}: C`, exact: true }).boundingBox())!;
    await page.mouse.move(clientBox.x + clientBox.width / 2, clientBox.y + clientBox.height / 2); await page.mouse.down();
    await page.mouse.move(ownBox.x + ownBox.width / 2, ownBox.y + ownBox.height / 2, { steps: 8 });
    await expect(clientHandle).toHaveAttribute("aria-pressed", "true"); await page.mouse.up();
    await expect(clientHandle).not.toHaveAttribute("aria-pressed", "true"); await expect(page.getByText(t.dragCanceled("Client"), { exact: true })).toHaveCount(1); expect(writes).toBe(2);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (lang === "cs" && (width === 360 || width === 1440)) await table.locator("..").screenshot({ path: `/tmp/app-audit-project-order-cs-${width}.png` });
      if (width < 768) await expect.poll(async () => (await table.getByRole("button", { name: `${t.dragHandle}: B`, exact: true }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(errors.filter(error => !(error.includes("status of 409") && error.includes("/reorder_owned_projects")))).toEqual([]);
    } finally { finish?.(); await page.mouse.up().catch(() => undefined); }
  });
}
