import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { MARKETING_CALENDAR_SOURCES, MAX_CALENDAR_ENTRIES, parseMarketingCalendar } from '../src/lib/marketing-calendars';
import { marketing } from '../src/lib/i18n/sections/marketing';
for (const width of [360, 430, 768, 1024, 1440, 1728]) for (const lang of ['en', 'cs'] as const) test(`Work calendar discloses all omitted rows: ${width} ${lang}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); const errors = watchConsole(page);
  const entries = Array.from({ length: MAX_CALENDAR_ENTRIES + 3 }, (_, i) => ({ id: `e${i}`, title: `Calendar entry ${i}`, date: '2026-10-28' }));
  entries[0]!.id = ''; entries[2]!.id = 'e1';
  const result = parseMarketingCalendar(JSON.stringify({ schemaVersion: 'marketing-calendar/1', project: 'devshark', entries }), 'devshark'); expect(result.ok).toBe(true); if (!result.ok) throw Error('TEST_ONLY_INVALID_CALENDAR'); expect(result.calendar.skipped).toBe(5);
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  let reads = 0; await page.unroute('**/api/marketing/calendars'); await page.route('**/api/marketing/calendars', route => { reads++; return route.fulfill({ json: { checkedAt: new Date().toISOString(), sources: [{ ...MARKETING_CALENDAR_SOURCES[0], status: 'ok', detail: null, calendar: result.calendar }, { ...MARKETING_CALENDAR_SOURCES[1], status: 'disconnected', detail: null, calendar: null }] } }); });
  await page.goto('/dev-preview?tab=work&calendars=live'); const card = page.locator('[data-marketing-week]'), note = card.getByText(marketing[lang].skipped('devShark', 5), { exact: true }); await expect(note).toBeVisible();
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-marketing-week]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(reads).toBe(1); expect(errors).toEqual([]);
});
