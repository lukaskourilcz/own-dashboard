import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { MARKETING_CALENDAR_SOURCES } from '../src/lib/marketing-calendars';
import { marketing } from '../src/lib/i18n/sections/marketing';
for (const lang of ['en', 'cs'] as const) for (const intervene of [false, true]) test(`Work recovers from an invalid complete calendar response (${lang}, ${intervene ? 'intervening focus' : 'retry focus'})`, async ({ page }) => {
  const errors = watchConsole(page), t = marketing[lang]; await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  let reads = 0, invalid = true, finishRecovery: (() => void) | undefined; await page.unroute('**/api/marketing/calendars'); await page.route('**/api/marketing/calendars', async route => {
    reads++; if (!invalid) await new Promise<void>(resolve => { finishRecovery = resolve; }); return route.fulfill({ json: invalid ? { checkedAt: 'TEST_ONLY_INVALID_CLOCK', sources: [{ id: 'TEST_ONLY_INVALID_SOURCE' }] } : { checkedAt: new Date().toISOString(), sources: MARKETING_CALENDAR_SOURCES.map(({ id, label, repo, path, calendarUrl }) => ({ id, label, repo, path, calendarUrl, status: 'ok', detail: null, calendar: { name: label, launch: null, periodStart: null, periodEnd: null, entries: [], prelaunch: [], skipped: 0 } })) } });
  });
  await page.goto('/dev-preview?tab=work&calendars=live'); const card = page.locator('[data-marketing-week]'); await expect(card.getByRole('alert')).toHaveText(t.loadError); await expect(card).not.toContainText('TEST_ONLY_INVALID');
  const initialReads = reads; invalid = false;
  const retry = card.getByRole('button'); await expect(retry).toHaveText(t.checkAgain); await expect(retry).toBeEnabled(); await retry.focus(); await retry.press('Enter'); await expect(retry).toBeDisabled(); await expect.poll(() => !!finishRecovery).toBe(true); const target = intervene ? card.getByRole('link').first() : retry; if (intervene) await target.focus(); finishRecovery!(); await expect(card.getByRole('alert')).toHaveCount(0); await expect(card).toContainText(t.noEntries); await expect(target).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-marketing-week]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(reads).toBe(initialReads + 1); expect(errors).toEqual([]);
});
