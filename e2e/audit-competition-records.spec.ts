import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview } from './helpers';
import { projects } from '../src/lib/demo/fixtures';
import { common } from '../src/lib/i18n/sections/common';
import { portfolio } from '../src/lib/i18n/sections/portfolio';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const project = { ...projects[0], id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner, name: 'Synthetic research project', slug: 'synthetic-research-project', engagement: 'client', is_active: true, parent_id: null, portfolio_key: null, repo_full_name: null, repo_id: null, previous_repo_full_names: [] };
const record = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: owner, project_id: project.id, name: 'Synthetic competitor', url: null, summary: 'Confirmed research', category: 'direct', useful_features: [], social_content: '', pricing_model: '', lessons: '', relevance_score: 3, score_rationale: '', social_links: [], source_urls: [], reviewed_at: null, sort_order: 0, created_at: '2026-10-25T11:00:00Z', updated_at: '2026-10-25T11:00:00Z' };
for (const lang of ['en', 'cs'] as const) test(`${lang}: Competition refuses failed or foreign reads and retries to confirmed data`, async ({ page }) => {
  let state: 'failed' | 'foreign' | 'ok' = 'failed', reads = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.route('**/rest/v1/rpc/read_owned_collection', route => {
    const input = route.request().postDataJSON();
    if (input.p_entity === 'projects') return route.fulfill({ json: [project] });
    expect(input.p_entity).toBe('competitors');
    expect(input.p_expected_owner).toBe(owner);
    reads++;
    return state === 'failed' ? route.fulfill({ status: 503, json: { message: 'PRIVATE TEST' } }) : route.fulfill({ json: [{ ...record, user_id: state === 'foreign' ? other : owner }] });
  });
  await page.goto('/dev-preview?tab=competition&competitors=live&projectRecords=live');
  const main = page.getByRole('main');
  await expect(main.getByRole('alert')).toHaveText(common[lang].dataUnavailableDescription);
  await expect(main.getByRole('button', { name: portfolio[lang].addCompetitor, exact: true })).toHaveCount(0);
  expect(reads).toBeGreaterThanOrEqual(1); expect(reads).toBeLessThanOrEqual(2);
  const initial = reads;
  state = 'foreign'; await main.getByRole('button', { name: common[lang].retry, exact: true }).click();
  await expect.poll(() => reads).toBe(initial + 1);
  await expect(main.getByRole('alert')).toHaveText(common[lang].dataUnavailableDescription);
  await expect(main).not.toContainText(record.name);
  state = 'ok'; await main.getByRole('button', { name: common[lang].retry, exact: true }).click();
  await expect(main.getByRole('button', { name: new RegExp(`^${record.name}`) })).toBeVisible();
  expect(reads).toBe(initial + 2);
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(main).not.toContainText('PRIVATE TEST');
  for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});
test('ordinary Competition preview sends no private complete-read request', async ({ page }) => {
  let reads = 0;
  page.on('request', request => { if (request.url().includes('/rpc/read_owned_collection')) reads++; });
  await gotoPreview(page, { lang: 'en' });
  await page.goto('/dev-preview?tab=competition');
  await expect(page.getByRole('button', { name: portfolio.en.addCompetitor, exact: true }).first()).toBeVisible();
  expect(reads).toBe(0);
});
for (const lang of ['en', 'cs'] as const) {
 test(`${lang}: Competition retains cached data through a failed refresh on both surfaces`, async ({ page }) => {
  const p = portfolio[lang], errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); let failed = false, reads = 0, current = record;
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.route('**/rest/v1/rpc/read_owned_collection', route => { const input = route.request().postDataJSON(); if (input.p_entity === 'projects') return route.fulfill({ json: [project] }); if (input.p_entity !== 'competitors') return route.fulfill({ json: [] }); reads++; return failed ? route.fulfill({ status: 503, json: { message: 'PRIVATE TEST' } }) : route.fulfill({ json: [current] }); });
  await page.route('**/rest/v1/competitors?*', route => route.fulfill({ json: [] }));
  await page.goto('/dev-preview?tab=competition&competitors=live&projectRecords=live'); const main = page.getByRole('main');
  await main.getByRole('button', { name: `${p.deleteCompetitor}: ${record.name}`, exact: true }).click(); await page.getByRole('dialog', { name: p.deleteCompetitor, exact: true }).getByRole('button', { name: common[lang].delete, exact: true }).click(); await expect(main.getByRole('alert')).toContainText(p.competitorChanged);
  failed = true; await main.getByRole('button', { name: p.competitorReload, exact: true }).click(); await expect(main.getByRole('alert')).toContainText(p.competitorReadUnavailable); await expect(main.getByRole('button', { name: new RegExp(`^${record.name}`) })).toBeVisible(); await expect(main.getByRole('button', { name: p.competitorReload, exact: true })).toHaveCount(1);
  await page.route('**/rest/v1/competitors?*', route => { expect(route.request().method()).toBe('PATCH'); current = { ...current, ...route.request().postDataJSON(), updated_at: '2026-10-25T11:00:01Z' }; return route.fulfill({ json: [current] }); });
  await main.getByRole('button', { name: `${p.editCompetitor}: ${record.name}`, exact: true }).click(); const edit = page.getByRole('dialog', { name: p.editCompetitor, exact: true }); await edit.getByLabel(p.competitorSummary, { exact: true }).fill('Confirmed local edit while the full list is stale'); await edit.getByRole('button', { name: common[lang].save, exact: true }).click(); await expect(edit).toHaveCount(0);
  await main.getByRole('button', { name: project.name, exact: true }).click(); await expect(main.getByRole('tab', { name: p.projectCompetitionTab, exact: true })).toBeVisible(); await main.getByRole('tab', { name: p.projectCompetitionTab, exact: true }).click(); await expect(main.getByRole('alert')).toContainText(p.competitorReadUnavailable); await expect(main.getByRole('button', { name: new RegExp(`^${record.name}`) })).toBeVisible();
  for (const width of [360, 430, 640, 767, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); if (width < 768) { const notice = main.getByRole('alert'), button = main.getByRole('button', { name: p.competitorReload, exact: true }); await expect.poll(async () => { const n = await notice.boundingBox(), b = await button.boundingBox(); return !!n && !!b && b.height >= 44 && b.width >= n.width - 28; }).toBe(true); } }
  const before = reads; failed = false; await main.getByRole('button', { name: p.competitorReload, exact: true }).click(); await expect(main.getByRole('alert')).toHaveCount(0); expect(reads).toBe(before + 1); expect(errors).toEqual([]);
 });
 test(`${lang}: Competition long details, standalone profiles, dates and mobile controls stay usable`, async ({ page }) => {
  const p = portfolio[lang], errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const long = { ...record, name: 'Synthetic long competitor', url: 'https://example.test/' + 'path'.repeat(120), useful_features: ['Feature'.repeat(150)], score_rationale: 'Rationale'.repeat(160), social_links: ['https://example.test/' + 'profile'.repeat(100)], reviewed_at: '2099-01-01' };
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.route('**/rest/v1/rpc/read_owned_collection', route => route.fulfill({ json: route.request().postDataJSON().p_entity === 'projects' ? [project] : route.request().postDataJSON().p_entity === 'competitors' ? [long] : [] }));
  await page.goto('/dev-preview?tab=competition&competitors=live&projectRecords=live'); const main = page.getByRole('main'), disclosure = main.getByRole('button', { name: new RegExp(`^${long.name}`) }); await disclosure.click(); await expect(main.getByRole('link', { name: long.social_links[0], exact: true })).toBeVisible(); await expect(main.locator('time[datetime="2099-01-01"]')).not.toHaveText('2099-01-01');
  for (const width of [360, 430, 640, 767, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); if (width < 768) for (const control of [disclosure, main.getByRole('button', { name: `${p.editCompetitor}: ${long.name}`, exact: true }), main.getByRole('button', { name: `${p.deleteCompetitor}: ${long.name}`, exact: true })]) await expect.poll(async () => (await control.boundingBox())!.height).toBeGreaterThanOrEqual(44); }
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  await page.route('**/rest/v1/competitors?*', route => route.fulfill({ json: [long] })); await page.route('**/rest/v1/rpc/read_owned_collection', route => route.fulfill({ json: route.request().postDataJSON().p_entity === 'projects' ? [project] : [] }));
  await main.getByRole('button', { name: `${p.deleteCompetitor}: ${long.name}`, exact: true }).click(); await page.getByRole('dialog', { name: p.deleteCompetitor, exact: true }).getByRole('button', { name: common[lang].delete, exact: true }).click(); await expect(disclosure).toHaveCount(0); await expect(main.getByRole('button', { name: p.addCompetitor, exact: true }).first()).toBeFocused(); expect(errors).toEqual([]);
 });
}
