import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview } from './helpers';
import { projects } from '../src/lib/demo/fixtures';
import { portfolio } from '../src/lib/i18n/sections/portfolio';
import { common } from '../src/lib/i18n/sections/common';
const owner = '11111111-1111-4111-8111-111111111111';
const project = { ...projects[0], id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner, name: 'Synthetic research project', slug: 'synthetic-research-project', engagement: 'client', is_active: true, parent_id: null, portfolio_key: null };
const record = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: owner, project_id: project.id, name: 'Synthetic competitor', url: null, summary: 'Confirmed research', category: 'direct', useful_features: [], social_content: '', pricing_model: '', lessons: '', relevance_score: 3, score_rationale: '', social_links: [], source_urls: [], reviewed_at: null, sort_order: 0, created_at: '2026-10-25T11:00:00Z', updated_at: '2026-10-25T11:00:00Z' };
async function reads(page: Page, rows: () => unknown[]) {
 let count = 0;
 await page.route('**/rest/v1/rpc/read_owned_collection', route => { const input = route.request().postDataJSON(); if (input.p_entity !== 'projects') { expect(input.p_expected_owner).toBe(owner); count++; } return route.fulfill({ json: input.p_entity === 'projects' ? [project] : rows() }); });
 return () => count;
}
for (const lang of ['en', 'cs'] as const) {
 test(`${lang}: Competition preserves failed drafts, validates URLs and locks a pending creation`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); const p = portfolio[lang], c = common[lang];
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); let rows: unknown[] = []; const readCount = await reads(page, () => rows);
  const calls: Record<string, unknown>[] = []; let held: Route | undefined;
  await page.route('**/rest/v1/competitors?*', async route => { expect(route.request().method()).toBe('POST'); const body = route.request().postDataJSON(); calls.push(body); expect(body.user_id).toBe(owner); expect(body.id).toMatch(/^[0-9a-f-]{36}$/); if (calls.length === 1) await route.fulfill({ status: 503, json: { message: 'PRIVATE TEST' } }); else held = route; });
  await page.goto('/dev-preview?tab=competition&competitors=live&projectRecords=live');
  await page.getByRole('button', { name: p.addCompetitor, exact: true }).first().click(); let dialog = page.getByRole('dialog', { name: p.addCompetitor, exact: true });
  await dialog.getByLabel(p.competitorName, { exact: true }).fill('Kept synthetic draft'); await dialog.getByLabel(p.sourceUrls, { exact: true }).fill('https://example.test/good\ninvalid-address'); await dialog.getByLabel(p.sourceUrls, { exact: true }).blur();
  await expect(dialog.getByRole('alert')).toHaveText(p.competitorUrlInvalid); await expect(dialog.getByRole('button', { name: c.add, exact: true })).toBeDisabled(); expect(calls).toHaveLength(0);
  await dialog.getByLabel(p.sourceUrls, { exact: true }).fill('https://example.test/good\nHTTPS://EXAMPLE.TEST/corrected'); await dialog.getByRole('button', { name: c.add, exact: true }).click(); await expect(dialog.getByRole('alert')).toHaveText(p.competitorSaveUnconfirmed); await expect(dialog.getByLabel(p.competitorName, { exact: true })).toHaveValue('Kept synthetic draft');
  await dialog.getByRole('button', { name: c.cancel, exact: true }).click(); const guard = page.getByRole('dialog', { name: c.unsaved.title, exact: true }); await expect(guard).toBeVisible(); await guard.getByRole('button', { name: c.unsaved.stay, exact: true }).click();
  dialog = page.getByRole('dialog', { name: p.addCompetitor, exact: true }); await dialog.getByRole('button', { name: c.add, exact: true }).click(); await expect.poll(() => calls.length).toBe(2); expect(calls[1]!.id).toBe(calls[0]!.id); await expect(dialog.locator('fieldset')).toHaveAttribute('disabled', ''); await expect(dialog.getByLabel(p.competitorName, { exact: true })).toBeDisabled(); await expect(dialog.getByRole('button', { name: c.cancel, exact: true })).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  const beforeReadCount = readCount(); rows = [{ ...record, ...calls[1] }]; await held!.fulfill({ json: rows }); await expect(dialog).toHaveCount(0); await expect(page.getByRole('button', { name: /^Kept synthetic draft/ })).toBeVisible(); expect(readCount()).toBe(beforeReadCount); expect(calls).toHaveLength(2); expect(calls[1]!.source_urls).toEqual(['https://example.test/good', 'HTTPS://EXAMPLE.TEST/corrected']); expect(errors).toEqual([]);
 });
 test(`${lang}: Competition rejects stale edits and zero-row deletion, then explicitly reloads`, async ({ page }) => {
  const p = portfolio[lang], c = common[lang], errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); let rows = [record], readsCount = 0;
  await page.route('**/rest/v1/rpc/read_owned_collection', route => { const input = route.request().postDataJSON(); if (input.p_entity === 'projects') return route.fulfill({ json: [project] }); readsCount++; return route.fulfill({ json: rows }); });
  const writes: { method: string; url: URL }[] = [];
  await page.route('**/rest/v1/competitors?*', route => { const url = new URL(route.request().url()); expect(url.searchParams.get('id')).toBe(`eq.${record.id}`); expect(url.searchParams.get('user_id')).toBe(`eq.${owner}`); expect(url.searchParams.get('updated_at')).toBe(`eq.${record.updated_at}`); expect(url.searchParams.get('select')).not.toContain('*'); writes.push({ method: route.request().method(), url }); return route.fulfill({ json: [] }); });
  await page.goto('/dev-preview?tab=competition&competitors=live&projectRecords=live'); await page.getByRole('button', { name: `${p.editCompetitor}: ${record.name}`, exact: true }).click(); const dialog = page.getByRole('dialog', { name: p.editCompetitor, exact: true }); await dialog.getByLabel(p.competitorName, { exact: true }).fill('Conflict draft'); await dialog.getByRole('button', { name: c.save, exact: true }).click(); await expect(dialog.getByRole('alert')).toHaveText(p.competitorDraftChanged); await expect(dialog.getByLabel(p.competitorName, { exact: true })).toHaveValue('Conflict draft');
  await dialog.getByRole('button', { name: c.cancel, exact: true }).click(); await page.getByRole('dialog', { name: c.unsaved.title, exact: true }).getByRole('button', { name: c.unsaved.discard, exact: true }).click();
  const main = page.getByRole('main'); await main.getByRole('button', { name: `${p.deleteCompetitor}: ${record.name}`, exact: true }).click(); await page.getByRole('dialog', { name: p.deleteCompetitor, exact: true }).getByRole('button', { name: c.delete, exact: true }).click(); await expect(main.getByRole('alert')).toContainText(p.competitorChanged); await expect(main.getByRole('button', { name: new RegExp(`^${record.name}`) })).toBeVisible(); expect(writes.map(write => write.method)).toEqual(['PATCH', 'DELETE']);
  rows = [{ ...record, name: 'Confirmed newer research', updated_at: '2026-10-25T11:00:02Z' }]; const before = readsCount; await main.getByRole('button', { name: p.competitorReload, exact: true }).click(); await expect(main.getByRole('button', { name: /^Confirmed newer research/ })).toBeVisible(); expect(readsCount).toBe(before + 1); await expect(main.getByRole('alert')).toHaveCount(0);
  for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]); expect(errors).toEqual([]);
 });
}
