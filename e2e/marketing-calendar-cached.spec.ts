import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { MARKETING_CALENDAR_SOURCES } from '../src/lib/marketing-calendars';
import { marketing } from '../src/lib/i18n/sections/marketing';
const oldReadAt = '2026-10-28T08:00:00.000Z', newReadAt = '2026-10-28T09:00:00.000Z';
const tip = 'Plan a month of posts around two topics';
for (const width of [360, 430, 768, 1024, 1440, 1728]) for (const lang of ['en', 'cs'] as const) for (const tab of ['work', 'ig-tips'] as const) test(`${tab} retains confirmed calendar data on failed refresh: ${width} ${lang}`, async ({ page }, info) => {
  const t = marketing[lang], errors = watchConsole(page); await page.setViewportSize({ width, height: 1000 }); await page.clock.install({ time: new Date(newReadAt) }); await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  let phase: 'first' | 'failed' | 'recovered' = 'first', reads = 0;
  await page.unroute('**/api/marketing/calendars'); await page.route('**/api/marketing/calendars', route => {
    reads++; const sources = MARKETING_CALENDAR_SOURCES.map(source => ({ ...source, status: 'ok', detail: null, calendar: { name: source.label, launch: null, periodStart: null, periodEnd: null, entries: source.id === 'marketingshark' ? Array.from({ length: phase === 'recovered' ? 3 : 2 }, (_, index) => ({ id: `entry-${index}`, date: '2026-10-28', time: '12:30', platform: 'instagram', kind: 'carousel', title: `${phase === 'recovered' ? 'Newly loaded' : 'Retained'} plan ${index}`, status: 'planned', tipRefs: [tip] })) : [], prelaunch: [], skipped: 0 } }));
    if (phase === 'failed') return route.fulfill({ json: { checkedAt: newReadAt, sources: [{ ...sources[0], status: 'error', detail: '502', calendar: null }, sources[1]] } });
    return route.fulfill({ json: { checkedAt: phase === 'first' ? oldReadAt : newReadAt, sources } });
  });
  await page.goto(`/dev-preview?tab=${tab}&calendars=live`); const scope = tab === 'work' ? page.locator('[data-marketing-week]') : page.locator('[data-plans-status]');
  const retained = tab === 'work' ? scope.locator('[data-marketing-entry]') : page.locator('[data-tip-card="tip1"] [data-tip-usage]');
  if (tab === 'work') await expect(retained).toHaveCount(2); else await expect(retained).toContainText('devShark ×2');
  const readLabel = tab === 'work' ? t.checkedAt(await page.evaluate(({ at, lang }) => new Date(at).toLocaleTimeString(lang === 'cs' ? 'cs-CZ' : 'en-GB', { hour: '2-digit', minute: '2-digit' }), { at: oldReadAt, lang })) : null;
  const retry = scope.getByRole('button'); phase = 'failed'; await retry.focus(); await retry.press('Enter'); await expect(scope.getByRole('alert')).toHaveText(t.cachedUnavailable);
  if (tab === 'work') { await expect(retained).toHaveCount(2); await expect(scope).toContainText('Retained plan 0'); await expect(scope).toContainText(readLabel!); } else await expect(retained).toContainText('devShark ×2'); await expect(retry).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include(tab === 'work' ? '[data-marketing-week]' : '[data-plans-status]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (lang === 'cs' && [430, 1440].includes(width)) {
    await scope.scrollIntoViewIfNeeded(); const box = (await scope.boundingBox())!, marks = [];
    for (const [index, target] of [scope.getByRole('alert'), tab === 'work' ? retained.first() : scope.locator('p').filter({ hasText: /devShark/ }).first(), retry].entries()) { const value = (await target.boundingBox())!; marks.push({ n: index + 1, x: 100 * (value.x - box.x) / box.width, y: 100 * (value.y - box.y) / box.height, w: 100 * value.width / box.width, h: 100 * value.height / box.height }); }
    await scope.screenshot({ path: info.outputPath(`calendar-cached-${tab}-cs-${width}.png`) }); writeFileSync(info.outputPath(`calendar-cached-${tab}-cs-${width}.json`), JSON.stringify({ box, marks }, null, 2) + '\n');
  }
  phase = 'recovered'; await retry.press('Enter'); await expect(scope.getByRole('alert')).toHaveCount(0); if (tab === 'work') await expect(retained).toHaveCount(3); else await expect(retained).toContainText('devShark ×3'); await expect(retry).toBeFocused(); expect(reads).toBe(3); expect(errors).toEqual([]);
});
