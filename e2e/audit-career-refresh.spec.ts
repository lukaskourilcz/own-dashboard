import { test, expect, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview } from './helpers';
import { jobs } from '../src/lib/i18n/sections/jobs';
import { sessionOwner } from './owner-session-fixtures';
for (const lang of ['en', 'cs'] as const) test(`${lang}: Career refresh confirms its captured owner, keeps failures and admits only an explicit retry`, async ({ page }, info) => {
 await page.setViewportSize({ width: info.project.name === 'mobile' ? 430 : 1440, height: 1000 });
 await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 let calls = 0, held: Route | undefined;
 await page.route('**/api/jobs/refresh', route => {
  calls++; expect(route.request().headers()['x-own-dashboard-owner']).toBe(sessionOwner);
  if (calls === 1) { held = route; return; }
  if (calls === 2) return route.fulfill({ status: 429, json: { error: 'PRIVATE TEST provider text' } });
  const now = new Date().toISOString(); return route.fulfill({ json: { ownerId: sessionOwner, startedAt: now, finishedAt: now, ok: true, inserted: 0, refreshed: 1, pruned: 0, sources: { curated: { count: 1 } } } });
 });
 await page.route('**/api/jobs/available', route => route.fulfill({ json: { ownerId: sessionOwner, candidateVersion: 'a'.repeat(64), previouslyChecked: 0, versions: {}, states: {}, checkedAt: new Date().toISOString(), candidates: 0, remaining: 0 } }));
 await page.goto('/dev-preview?tab=career&career=live');
 const check = () => page.getByRole('button', { name: jobs[lang].checkOffers, exact: true }).first();
 await check().click(); await expect.poll(() => calls).toBe(1); await expect(page.getByRole('button', { name: jobs[lang].checking, exact: true })).toBeDisabled(); expect(calls).toBe(1);
 await held!.fulfill({ json: {} }); await expect(page.getByRole('main').getByRole('alert')).toHaveText(jobs[lang].refreshErr); await expect(check()).toBeEnabled();
 const recovery = page.getByRole('main').getByRole('alert').locator('..'), card = await recovery.boundingBox(), frame = await recovery.locator('..').boundingBox();
 expect(card!.width).toBeLessThanOrEqual(768); expect(Math.abs(card!.x + card!.width / 2 - frame!.x - frame!.width / 2)).toBeLessThan(2);
 const message = await recovery.getByRole('alert').boundingBox(), reload = await recovery.getByRole('button').boundingBox();
 if (info.project.name === 'desktop') expect(Math.abs(message!.y + message!.height / 2 - reload!.y - reload!.height / 2)).toBeLessThan(2);
 else expect(Math.abs(reload!.width - message!.width)).toBeLessThan(2);

 expect(await page.getByText('PRIVATE TEST provider text').count()).toBe(0); expect(calls).toBe(1);
 await check().click(); await expect(page.getByRole('main').getByRole('alert')).toHaveText(jobs[lang].refreshRateLimited); expect(calls).toBe(2);
 await check().click(); await expect(page.getByText(jobs[lang].refreshOk, { exact: true })).toBeVisible(); await expect(page.getByText(jobs[lang].refreshRateLimited, { exact: true })).toHaveCount(0); expect(calls).toBe(3);
 for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
 expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]); expect(errors).toEqual([]);
});
