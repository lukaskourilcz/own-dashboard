import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { MARKETING_CALENDAR_SOURCES } from '../src/lib/marketing-calendars';
import { marketing } from '../src/lib/i18n/sections/marketing';
const tip = 'Plan a month of posts around two topics';
for (const lang of ['en', 'cs'] as const) for (const tab of ['work', 'ig-tips'] as const) test(`${lang}/${tab}: loaded evidence stays scoped through partial and stale plans`, async ({ page }, info) => {
 const errors = watchConsole(page), t = marketing[lang];
 await page.clock.install({ time: new Date('2026-10-28T09:00:00Z') }); await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
 let phase: 'partial' | 'failed' | 'complete' | 'stale' = 'partial', reads = 0;
 await page.unroute('**/api/marketing/calendars'); await page.route('**/api/marketing/calendars', route => {
  reads++;
  const sources = MARKETING_CALENDAR_SOURCES.map((source, index) => {
   const failed = (index === 1 && ['partial', 'failed'].includes(phase)) || (index === 0 && ['failed', 'stale'].includes(phase));
   return { ...source, status: failed ? index === 1 ? 'not-found' : 'error' : 'ok', detail: failed && index === 0 ? '502' : null, calendar: failed ? null : { name: source.label, launch: null, periodStart: null, periodEnd: null, entries: index === 0 && tab === 'ig-tips' ? [{ id: 'one', date: '2026-10-28', time: null, kind: 'post', platform: 'instagram', title: 'Loaded plan entry', status: 'planned', tipRefs: [tip] }] : [], prelaunch: [], skipped: phase === 'partial' ? 1001 : 0 } };
  });
  return route.fulfill({ json: { checkedAt: '2026-10-28T08:00:00Z', sources } });
 });
 await page.goto(`/dev-preview?tab=${tab}&calendars=live`);
 const scope = page.locator(tab === 'work' ? '[data-marketing-week]' : '[data-plans-status]'); await expect(scope).toContainText('devShark');
 const verify = async () => {
  if (tab === 'work') {
   await expect(scope).toContainText(lang === 'cs' ? 'V načtených plánech nejsou záznamy na příštích sedm dní.' : 'No entries found in the loaded plans for the next seven days.');
   await expect(scope).not.toContainText(lang === 'cs' ? 'Na příštích sedm dní není nic naplánováno.' : 'Nothing is planned in the next seven days.');
  } else {
   const chip = page.getByRole('button', { name: lang === 'cs' ? /^Bez odkazu v načtených plánech/ : /^Not referenced in loaded plans/ });
   await expect(chip).toContainText('4'); await chip.click(); await expect(page.locator('[data-tip-card]')).toHaveCount(4); await expect(page.locator('[data-tip-card="tip1"]')).toHaveCount(0); await chip.click();
   await expect(page.locator('[data-tip-card="tip1"] [data-tip-usage]')).toContainText(lang === 'cs' ? 'Odkazy v' : 'Referenced in');
  }
 };
 await verify(); await expect(scope).toContainText('1001');
 phase = 'failed'; const retry = scope.getByRole('button', { name: t.checkAgain, exact: true }); await retry.click(); await expect(scope.getByRole('alert')).toHaveText(t.cachedUnavailable); await verify();
 phase = 'complete'; await retry.click(); await expect(scope.getByRole('alert')).toHaveCount(0); await expect(scope).not.toContainText('1001');
 phase = 'stale'; await retry.click(); await expect(scope.getByRole('alert')).toHaveText(t.cachedUnavailable); await verify();
 const widths = info.project.name === 'mobile' ? [360, 430] : [360, 430, 768, 1024, 1440, 1728];
 for (const width of widths) {
  await page.setViewportSize({ width, height: 1000 }); await scope.scrollIntoViewIfNeeded(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (tab === 'ig-tips' && width >= 1440) {
   const warning = (await scope.getByRole('alert').boundingBox())!, counts = (await scope.locator('p').filter({ hasText: /devShark/ }).boundingBox())!, button = (await retry.boundingBox())!;
   expect(Math.abs(warning.y + warning.height / 2 - counts.y - counts.height / 2)).toBeLessThan(1); expect(Math.abs(button.y + button.height / 2 - counts.y - counts.height / 2)).toBeLessThan(1);
  }
  if (width < 768) expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include(tab === 'work' ? '[data-marketing-week]' : '#main-content').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (lang === 'cs' && info.project.name === 'desktop' && [430, 1440].includes(width)) await scope.screenshot({ path: `docs/reports/app-wide-audit-2026-10-23/assets/calendar-evidence-${tab}-398-cs-${width}.png` });
 }
 expect(reads).toBe(4); expect(errors).toEqual([]);
});
