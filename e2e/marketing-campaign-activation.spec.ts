import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { marketingStateFixture, stateOwner } from '../tests/lib/marketing-state-fixture';
import { marketingWorkspace } from '../src/lib/i18n/sections/marketing-workspace';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
for (const lang of ['en', 'cs'] as const) for (const theme of ['light', 'dark'] as const) {
 test(`${lang}/${theme}: unconfirmed activation needs a checked read and pending activation guards exits`, async ({ page }, info) => {
  const errors = watchConsole(page), t = marketingWorkspace[lang], posts: Array<{ owner?: string; body: unknown }> = [], otherWrites: string[] = []; let gets = 0, confirmed = false;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00Z')); await page.emulateMedia({ reducedMotion: 'reduce' });
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 430, height: 900 });
  const value = marketingStateFixture();
  await page.route('**/api/marketing/state', route => { gets++; const next = structuredClone(value); if (confirmed) next.campaigns[0].status = 'active'; return route.fulfill({ json: next }); });
  await page.route('**/api/marketing/campaigns', async route => {
   posts.push({ owner: route.request().headers()['x-own-dashboard-owner'], body: route.request().postDataJSON() });
   if (posts.length === 1) { await gate; return route.fulfill({ json: { ok: true } }); }
   confirmed = true; return route.fulfill({ json: { ownerId: stateOwner, campaignId: value.campaigns[0].id, sourceHash: value.campaigns[0].source_hash, status: 'active' } });
  });
  page.on('request', request => { if (request.url().includes('/api/marketing/') && request.method() !== 'GET' && !request.url().endsWith('/campaigns')) otherWrites.push(request.url()); });
  await gotoPreview(page, { lang, theme }); await page.goto('/dev-preview?tab=marketing&marketingState=live&campaignActivation=live');
  const workspace = page.getByTestId('marketing-workspace'); await expect(workspace.getByRole('heading', { name: 'Reviewed draft', exact: true })).toBeVisible();
  await workspace.locator('#marketing-tab-calendar').click(); const activate = workspace.getByRole('button', { name: lang === 'cs' ? 'Použít tento plán' : 'Use this plan', exact: true });
  await activate.focus(); await activate.press('Enter'); await expect.poll(() => posts.length).toBe(1); await expect(activate).toBeDisabled(); await expect(workspace.getByRole('button', { name: t.refresh, exact: true })).toBeDisabled();
  await workspace.locator('#marketing-tab-review').click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('heading', { name: lang === 'cs' ? 'Akce probíhá' : 'Action in progress' })).toBeVisible();
  await expect(workspace.locator('#marketing-tab-calendar')).toHaveAttribute('aria-selected', 'true'); await expect(dialog.getByRole('button', { name: lang === 'cs' ? 'Zahodit a odejít' : 'Discard and leave' })).toBeDisabled();
  await dialog.getByRole('button', { name: lang === 'cs' ? 'Zůstat zde' : 'Stay here' }).click(); await expect(dialog).toHaveCount(0);
  release(); const notice = workspace.getByRole('alert'); await expect(notice).toHaveText(t.activationUnconfirmed); await expect(activate).toBeDisabled();
  expect(gets).toBe(1); expect(posts).toEqual([{ owner: stateOwner, body: { id: value.campaigns[0].id, expectedHash: value.campaigns[0].source_hash } }]);
  const refresh = workspace.getByRole('button', { name: t.refresh, exact: true }); await refresh.focus(); await refresh.press('Enter'); await expect(notice).toHaveCount(0); await expect(activate).toBeEnabled(); expect(gets).toBe(2); expect(posts).toHaveLength(1);
  await activate.focus(); await activate.press('Enter'); await expect(workspace.getByRole('status')).toHaveText(t.activationSaved); await expect(activate).toHaveCount(0);
  expect(posts).toHaveLength(2); expect(gets).toBe(3); expect(otherWrites).toEqual([]);
  expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); expect(errors).toEqual([]);
 });
}
