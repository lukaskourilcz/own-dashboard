import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { importOwner, importPreview, importSaved } from '../tests/lib/calendar-import-fixture';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const copy = { en: { calendar: 'Calendar', preview: 'Preview plan', apply: 'Import plan', brand: 'Brand', first: 'First day', success: 'Import confirmed. Review the plan in the calendar.' }, cs: { calendar: 'Kalendář', preview: 'Zkontrolovat plán', apply: 'Importovat plán', brand: 'Značka', first: 'První den', success: 'Import potvrzen. Plán najdeš v kalendáři.' } };
for (const lang of ['en', 'cs'] as const) {
 test(`${lang}: invalid source and out-of-range dates recover without a save`, async ({ page }) => {
  const errors = watchConsole(page), c = copy[lang];
  let requests = 0;
  await page.clock.install({ time: new Date('2026-10-29T10:00:00Z') });
  await page.route('**/api/marketing/import', route => {
   requests++; expect(route.request().postDataJSON().apply).toBe(false);
   return route.fulfill({ status: 400, json: { error: 'calendar-import-plan-invalid' } });
  });
  await gotoPreview(page, { lang, theme: 'dark' }); await page.goto('/dev-preview?tab=marketing&imports=live');
  await page.locator('#marketing-tab-calendar').click();
  const section = page.getByRole('region', { name: lang === 'cs' ? 'Převzít plán z BoardlessAI' : 'Import the BoardlessAI plan' });
  const date = section.getByLabel(c.first), preview = section.getByRole('button', { name: c.preview, exact: true });
  await date.fill('9999-12-26');
  await expect(date).toHaveAttribute('aria-invalid', 'true'); await expect(preview).toBeDisabled();
  await expect(date).toHaveAccessibleDescription(lang === 'cs' ? 'Vyber první den, od kterého lze naplánovat celých sedm dní.' : 'Choose a start date that leaves room for all seven days.');
  expect(requests).toBe(0);
  await date.fill('2026-10-29'); await preview.click();
  await expect(section.getByRole('alert')).toHaveText(lang === 'cs' ? 'Zdrojový plán potřebuje opravu. Před další kontrolou ověř jeho data, časy a položky.' : 'The source plan needs correction. Review its dates, times and entries before previewing again.');
  await expect(preview).toBeFocused();
  const source = section.getByRole('link', { name: lang === 'cs' ? 'Otevřít zdrojový plán' : 'Open source plan' });
  await expect(source).toHaveAttribute('href', 'https://boardless-ai.vercel.app/admin/calendar?venture=caught-up');
  await expect(source).toHaveAttribute('target', '_blank'); await expect(source).toHaveAttribute('rel', 'noreferrer');
  await expect(section.getByRole('button', { name: c.apply, exact: true })).toHaveCount(0);
  expect(requests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  expect(errors).toEqual([`Failed to load resource: the server responded with a status of 400 (Bad Request) (${new URL('/api/marketing/import', page.url()).href})`]);
 });
 test(`${lang}: captured import, pending exit and uncertainty recover without publishing`, async ({ page }, info) => {
  const errors = watchConsole(page), c = copy[lang];
  await page.clock.install({ time: new Date('2026-10-28T23:15:00Z') });
  const posts: Array<{ body: Record<string, unknown>; owner: string | undefined }> = [];
  let uncertain = true, release!: () => void, waiting = false;
  await page.route('**/api/marketing/import', async route => {
   const body = route.request().postDataJSON(); posts.push({ body, owner: route.request().headers()['x-own-dashboard-owner'] });
   if (!body.apply) return route.fulfill({ json: importPreview() });
   waiting = true; await new Promise<void>(resolve => { release = resolve; });
   return route.fulfill(uncertain ? { status: 503, json: { error: 'TEST_ONLY_PRIVATE' } } : { json: importSaved() });
  });
  await gotoPreview(page, { lang, theme: 'dark' }); await page.goto('/dev-preview?tab=marketing&imports=live');
  await page.locator('#marketing-tab-calendar').click();
  const section = page.getByRole('region', { name: lang === 'cs' ? 'Převzít plán z BoardlessAI' : 'Import the BoardlessAI plan' });
  await expect(section.getByLabel(c.first)).toHaveValue('2026-10-29');
  await section.getByRole('button', { name: c.preview, exact: true }).click();
  const apply = section.getByRole('button', { name: c.apply, exact: true }); await expect(apply).toBeFocused();
  await page.clock.fastForward(86400000); await expect(section.getByLabel(c.first)).toHaveValue('2026-10-29');
  await apply.press('Enter'); await expect.poll(() => waiting).toBe(true);
  await expect(section.getByLabel(c.brand)).toBeDisabled(); await page.locator('#marketing-tab-results').click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: lang === 'cs' ? 'Zůstat zde' : 'Stay here', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: lang === 'cs' ? 'Zůstat zde' : 'Stay here', exact: true }).click();
  release(); await expect(section.getByRole('alert')).toContainText(lang === 'cs' ? 'není potvrzené' : 'unconfirmed');
  await expect(section.getByRole('button', { name: c.apply, exact: true })).toHaveCount(0); await expect(section.getByRole('button', { name: c.preview, exact: true })).toBeFocused();
  await section.getByRole('button', { name: c.preview, exact: true }).click(); await expect(apply).toBeFocused();
  uncertain = false; waiting = false; await apply.press('Enter'); await expect.poll(() => waiting).toBe(true); release();
  await expect(section.getByRole('status')).toHaveText(c.success); await expect(section.getByRole('button', { name: c.preview, exact: true })).toBeFocused();
  expect(posts).toHaveLength(4); expect(posts.every(post => post.owner === importOwner)).toBe(true);
  expect(posts.filter(post => post.body.apply).every(post => post.body.expectedImportHash === 'b'.repeat(64) && post.body.startsOn === '2026-10-29')).toBe(true);
  await expect(section).not.toContainText(/publishing remains paused|publikování zůstává pozastavené/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
  if (info.project.name === 'desktop') await expect(section.getByLabel(c.first)).toBeEnabled();
  expect(errors).toEqual([`Failed to load resource: the server responded with a status of 503 (Service Unavailable) (${new URL('/api/marketing/import', page.url()).href})`]);
 });
 for (const theme of ['light', 'dark'] as const) {
  test(`${lang}/${theme}: centered import controls reflow at six widths`, async ({ page }, info) => {
   if (info.project.name !== 'desktop') test.skip();
   const errors = watchConsole(page), c = copy[lang]; await page.clock.install({ time: new Date('2026-10-29T10:00:00Z') });
   await page.route('**/api/marketing/import', route => route.fulfill({ json: importPreview() }));
   await gotoPreview(page, { lang, theme }); await page.goto('/dev-preview?tab=marketing&imports=live'); await page.locator('#marketing-tab-calendar').click();
   const section = page.getByRole('region', { name: lang === 'cs' ? 'Převzít plán z BoardlessAI' : 'Import the BoardlessAI plan' });
   for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 }); await section.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const select = await section.getByLabel(c.brand).boundingBox(), input = await section.getByLabel(c.first).boundingBox(), preview = await section.getByRole('button', { name: c.preview, exact: true }).boundingBox(), box = await section.boundingBox();
    expect(select).not.toBeNull(); expect(input).not.toBeNull(); expect(preview).not.toBeNull();
    expect(Math.abs(select!.height - input!.height)).toBeLessThan(1); expect(Math.abs(input!.height - preview!.height)).toBeLessThan(1);
    if (width < 768) expect(preview!.height).toBeGreaterThanOrEqual(44);
    if (width >= 1024) { expect(Math.abs(input!.y - preview!.y)).toBeLessThan(1); expect(box!.width).toBeLessThanOrEqual(768); }
    expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    if (lang === 'cs' && theme === 'dark' && [430, 1440].includes(width)) await section.screenshot({ path: info.outputPath(`calendar-import-396-cs-${width}.png`) });
   }
   expect(errors).toEqual([]);
  });
 }
}
