import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview } from './helpers';
import { projects } from '../src/lib/demo/fixtures';
import { common } from '../src/lib/i18n/sections/common';
import { portfolio } from '../src/lib/i18n/sections/portfolio';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const project = { ...projects[0], id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner, name: 'Synthetic research project', slug: 'synthetic-research-project', engagement: 'client', is_active: true, parent_id: null, portfolio_key: null };
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
