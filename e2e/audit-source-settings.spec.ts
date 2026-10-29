import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { projects as fixtures } from '../src/lib/demo/fixtures';
import { dneskaiSourceList as copy } from '../src/lib/i18n/sections/dneskai-source-list';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
import { common } from '../src/lib/i18n/sections/common';
import { dneskaiRegistrySourceList, sameDneskaiSourceRow } from '../src/lib/marketing/dneskai-source-list';
const id = '22222222-2222-4222-8222-222222222222', owner = '11111111-1111-4111-8111-111111111111';
async function fixture(page: Page, lang: 'en' | 'cs') {
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  const project = { ...fixtures.find(row => row.slug === 'dneskai')!, id, user_id: owner };
  const seed = dneskaiRegistrySourceList();
  let list = { ...seed, editable: true, items: [...seed.items.filter(item => item.row.kind === 'instagram').slice(0, 2), ...seed.items.filter(item => item.row.kind !== 'instagram').slice(0, 2)] };
  let calls = 0, reads = 0, fail = false, hold = false, unavailable = false, release: (() => void) | undefined;
  await page.route('**/rest/v1/rpc/read_owned_collection', route => route.fulfill({ json: route.request().postDataJSON().p_entity === 'projects' ? [project] : [] }));
  await page.route(/\/api\/marketing\/dneskai\/source-list(?:\?.*)?$/, async route => {
    if (route.request().method() === 'GET') { reads++; return route.fulfill(unavailable ? { status: 503, json: { error: 'sources-unavailable' } } : { json: list }); }
    calls++; const action = route.request().postDataJSON();
    if (hold) await new Promise<void>(resolve => { release = resolve; }); release = undefined;
    if (fail) return route.fulfill({ status: 503, json: { error: 'sources-unavailable' } });
    const sourceId = action.action === 'save' ? action.source.sourceId : action.sourceId, current = list.items.find(item => item.row.sourceId === sourceId)?.row ?? null;
    if (!sameDneskaiSourceRow(current, action.expected) && !(action.action === 'save' ? sameDneskaiSourceRow(current, action.source) : current === null)) return route.fulfill({ status: 409, json: { kind: 'conflict', ownerId: owner, projectId: id, sourceId, source: current } });
    if (action.action === 'remove') { list = { ...list, items: list.items.filter(item => item.row.sourceId !== sourceId) }; return route.fulfill({ json: { kind: 'removed', ownerId: owner, projectId: id, sourceId, source: null } }); }
    const item = { row: action.source, lastReadAt: null, lastItems: null, lastErrorCode: null };
    list = { ...list, items: current ? list.items.map(old => old.row.sourceId === sourceId ? { ...old, row: action.source } : old) : [...list.items, item] };
    return route.fulfill({ json: { kind: 'saved', ownerId: owner, projectId: id, sourceId, source: action.source } });
  });
  await page.goto('/dev-preview?tab=projects&projectRecords=live');
  await page.locator('#main-content').getByRole('link', { name: 'DNESKAi', exact: true }).first().click();
  await page.getByRole('tab', { name: lang === 'cs' ? 'Zdroje (DNESKAi)' : 'Sources (DNESKAi)', exact: true }).click();
  const panel = page.getByTestId('dneskai-source-list'); await expect(panel.getByRole('textbox', { name: copy[lang].add.field, exact: true })).toBeVisible();
  return { panel, calls: () => calls, reads: () => reads, fail: (value: boolean) => { fail = value; }, hold: (value: boolean) => { hold = value; },
    release: async () => { await expect.poll(() => typeof release).toBe('function'); release!(); },
    external: () => { list = { ...list, items: list.items.map((item, i) => i === 0 ? { ...item, row: { ...item.row, name: 'Changed elsewhere', maxItems: 7 } } : item) }; },
    unavailable: (value: boolean) => { unavailable = value; }, row: () => list.items[0]!.row };
}
for (const lang of ['en', 'cs'] as const) {
  test(`${lang}: source adds retain failures, block repeated submissions and protect pending exits`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang), t = copy[lang], guardCopy = common[lang].unsaved;
    const form = f.panel.locator('form'), input = form.getByRole('textbox', { name: t.add.field, exact: true }); await input.fill('@newsource');
    f.fail(true); f.hold(true); await form.getByRole('button', { name: t.add.submit, exact: true }).click(); await expect.poll(f.calls).toBe(1);
    await form.dispatchEvent('submit'); expect(f.calls()).toBe(1); await expect(input).toHaveValue('@newsource'); await expect(input).toHaveAttribute('readonly', '');
    await page.getByRole('tab', { name: dneskaiAudio[lang].title, exact: true }).click();
    const guard = page.getByRole('dialog'); await expect(guard.getByRole('heading')).toHaveText(guardCopy.pendingTitle); await expect(guard.getByRole('button', { name: guardCopy.discard, exact: true })).toBeDisabled();
    await f.release(); await guard.getByRole('button', { name: guardCopy.stay, exact: true }).click();
    await expect(form.getByRole('alert')).toHaveText(t.errors['sources-unavailable']!); await expect(input).toHaveValue('@newsource');
    const reads = f.reads(); f.fail(false); f.hold(false); await form.getByRole('button', { name: t.add.submit, exact: true }).click();
    await expect(form.getByRole('status').filter({ hasText: t.saved })).toBeVisible(); await expect(input).toHaveValue(''); expect(f.calls()).toBe(2); expect(f.reads()).toBe(reads);
    await page.getByRole('tab', { name: dneskaiAudio[lang].title, exact: true }).click(); await expect(f.panel).toHaveCount(0); await expect(guard).toHaveCount(0);
    expect(errors.filter(error => !error.includes('/api/marketing/dneskai/source-list') || !error.includes('503'))).toEqual([]);
  });
  test(`${lang}: source edits validate raw values, preserve conflicts and reload explicitly`, async ({ page }, info) => {
    const errors = watchConsole(page), f = await fixture(page, lang), t = copy[lang];
    await f.panel.getByRole('button', { name: t.editName('@' + f.row().handleOrUrl), exact: true }).click();
    const dialog = page.getByTestId('dneskai-source-edit'), name = dialog.getByRole('textbox', { name: t.form.name, exact: true }), count = dialog.getByRole('spinbutton');
    await name.fill(''); await count.fill('2.5'); await dialog.getByRole('button', { name: t.form.save, exact: true }).click();
    await expect(dialog.getByText(t.form.nameMissing, { exact: true })).toBeVisible(); await expect(dialog.getByText(t.form.itemsInvalid, { exact: true })).toBeVisible(); await expect(count).toHaveValue('2.5'); expect(f.calls()).toBe(0);
    await name.fill('Local unsaved name'); await count.fill('3'); f.external(); await dialog.getByRole('button', { name: t.form.save, exact: true }).click();
    await expect(dialog.getByText(t.form.changed, { exact: true })).toBeVisible(); await expect(name).toHaveValue('Local unsaved name'); await expect(count).toHaveValue('3'); await expect(dialog.getByRole('button', { name: t.form.save, exact: true })).toBeDisabled();
    for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); for (const control of await dialog.locator('button,select,input:not([type="checkbox"])').all()) await expect.poll(async () => (await control.boundingBox())!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32); }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-source-edit"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1440, height: 1000 }); if (lang === 'cs') await dialog.screenshot({ path: `/tmp/app-audit-source-edit-conflict-cs-${info.project.name}.png` });
    f.unavailable(true); await dialog.getByRole('button', { name: t.form.reload, exact: true }).click(); await expect(dialog.getByText(t.form.reloadFailed, { exact: true })).toBeVisible(); await expect(name).toHaveValue('Local unsaved name');
    f.unavailable(false); await dialog.getByRole('button', { name: t.form.reload, exact: true }).click(); await expect(name).toHaveValue('Changed elsewhere'); await expect(count).toHaveValue('7'); await expect(dialog.getByText(t.form.changed, { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: t.cancel, exact: true }).focus(); await page.keyboard.press('Enter'); await expect(dialog).toHaveCount(0); expect(f.calls()).toBe(1);
    expect(errors.filter(error => !error.includes('/api/marketing/dneskai/source-list') || !/409|503/.test(error))).toEqual([]);
  });
  test(`${lang}: removal keeps its captured settings across confirmation and protects an unsaved add`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang), t = copy[lang], g = common[lang].unsaved, label = '@' + f.row().handleOrUrl;
    const input = f.panel.getByRole('textbox', { name: t.add.field, exact: true }); await input.fill('@unsavedsource');
    await f.panel.getByRole('button', { name: t.removeName(label), exact: true }).click();
    const guard = page.getByRole('dialog'); await expect(guard.getByRole('heading')).toHaveText(g.title);
    await guard.getByRole('button', { name: g.stay, exact: true }).click(); await expect(input).toHaveValue('@unsavedsource'); expect(f.calls()).toBe(0);
    await f.panel.getByRole('button', { name: t.add.discard, exact: true }).click();
    await f.panel.getByRole('button', { name: t.removeName(label), exact: true }).click(); await expect(guard.getByRole('heading')).toHaveText(t.removeTitle(label)); f.external();
    await guard.getByRole('button', { name: t.removeConfirm, exact: true }).click(); await expect(f.panel.getByRole('alert')).toHaveText(t.errors['source-changed']!);
    await expect(f.panel.getByText('Changed elsewhere', { exact: true })).toBeVisible(); await expect(f.panel.getByRole('button', { name: t.removeName(label), exact: true })).toBeVisible();
    const reads = f.reads(); await f.panel.getByRole('button', { name: t.removeName(label), exact: true }).click();
    await guard.getByRole('button', { name: t.removeConfirm, exact: true }).click(); await expect(f.panel.getByRole('status').filter({ hasText: t.removed })).toBeVisible();
    await expect(f.panel.getByRole('button', { name: t.removeName(label), exact: true })).toHaveCount(0); expect(f.calls()).toBe(2); expect(f.reads()).toBe(reads);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-source-list"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    expect(errors.filter(error => !error.includes('/api/marketing/dneskai/source-list') || !error.includes('409'))).toEqual([]);
  });

}
