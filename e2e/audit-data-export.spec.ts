import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { gotoPreview } from './helpers';
import { settings } from '../src/lib/i18n/sections/settings';
import { nav } from '../src/lib/i18n/sections/nav';
import { guest } from '../src/lib/i18n/sections/guest';
const owner = '11111111-1111-4111-8111-111111111111';
for (const lang of ['en', 'cs'] as const) test(`${lang}: Settings downloads the captured dataset with recovery and equal responsive actions`, async ({ page }) => {
 const t = settings[lang], errors: string[] = [], reads: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
 let mode: 'failed' | 'held' | 'ok' = 'failed', release!: () => void;
 await page.route('**/api/export/**', async route => {
  const request = route.request(); expect(request.headers()['x-export-owner']).toBe(owner); reads.push(new URL(request.url()).pathname + new URL(request.url()).search);
  if (mode === 'failed') return route.fulfill({ status: 503, json: { error: 'PRIVATE TEST diagnostic' } });
  if (mode === 'held') await new Promise<void>(resolve => { release = resolve; });
  const csv = request.url().includes('format=csv');
  return route.fulfill({ status: 200, contentType: csv ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8', headers: { 'content-disposition': `attachment; filename="owndashboard-${csv ? 'transactions' : 'notes'}-2026-10-25.${csv ? 'csv' : 'json'}"` }, body: csv ? '"amount","label"\r\n"-12.5","\t=synthetic"' : '{"synthetic":"raw =JSON"}' });
 });
 await page.goto('/dev-preview?tab=settings&exports=live'); const card = page.locator('#settings-export');
 const combo = card.getByRole('combobox', { name: t.exportDataset, exact: true }); await combo.click(); await page.getByRole('option', { name: t.exportNotes, exact: true }).click();
 const json = card.getByRole('button', { name: t.exportJson, exact: true }), csv = card.getByRole('button', { name: t.exportTransactionsCsv, exact: true });
 await json.click(); await expect(card.getByRole('alert')).toHaveText(t.exportFailed); await expect(combo).toHaveText(t.exportNotes); await expect(card).not.toContainText('PRIVATE TEST'); expect(reads).toEqual(['/api/export/notes']);
 mode = 'held'; const downloaded = page.waitForEvent('download'); await json.click(); await expect(card.getByRole('status')).toHaveText(t.exportPending); await expect(combo).toBeDisabled(); await expect(json).toBeDisabled(); await expect(csv).toBeDisabled();
 await json.evaluate((element: HTMLButtonElement) => element.click()); expect(reads).toEqual(['/api/export/notes', '/api/export/notes']); mode = 'ok'; release();
 const file = await downloaded; expect(file.suggestedFilename()).toBe('owndashboard-notes-2026-10-25.json'); expect(await readFile((await file.path())!, 'utf8')).toBe('{"synthetic":"raw =JSON"}'); await expect(card.getByRole('status')).toHaveText(t.exportStarted); await expect(json).toBeEnabled();
 const csvDownloaded = page.waitForEvent('download'); await csv.click(); const csvFile = await csvDownloaded; expect(csvFile.suggestedFilename()).toBe('owndashboard-transactions-2026-10-25.csv'); expect(await readFile((await csvFile.path())!, 'utf8')).toBe('"amount","label"\r\n"-12.5","\t=synthetic"'); expect(reads.at(-1)).toBe('/api/export/financial?format=csv&table=transactions');
 await combo.focus(); await combo.press('Space'); await page.keyboard.press('End'); await expect(page.getByRole('option', { name: t.exportLegacy, exact: true })).toBeFocused(); await page.keyboard.press('Enter'); await expect(combo).toHaveText(t.exportLegacy); await expect(combo).toBeFocused();
 for (const width of [360, 430, 640, 767, 768, 1024, 1440, 1728]) {
  await page.setViewportSize({ width, height: 1000 }); await card.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect.poll(async () => { const a = await json.boundingBox(), b = await csv.boundingBox(); return !!a && !!b && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1 && a.height >= (width < 768 ? 44 : 32); }).toBe(true);
  const rect = await card.boundingBox(), actions = await json.boundingBox(); expect(actions!.x).toBeGreaterThanOrEqual(rect!.x); expect(actions!.x + actions!.width).toBeLessThanOrEqual(rect!.x + rect!.width);
 }
 expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('#settings-export').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]); expect(errors).toEqual([]);
});
for (const lang of ['en', 'cs'] as const) test(`${lang}: public Settings never requests an owner export`, async ({ page }) => {
 const t = settings[lang]; let exports = 0; await gotoPreview(page, { lang }); await page.route('**/api/export/**', route => { exports++; return route.fulfill({ status: 500 }); }); await page.goto(`/guest?lang=${lang}`);
 await expect.poll(() => page.evaluate(() => document.documentElement.dataset.guestTour)).toBe('true'); if ((page.viewportSize()?.width ?? 1440) < 768) { await page.getByTestId('mobile-nav').getByRole('button', { name: nav[lang].more, exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: t.title, exact: true }).click(); } else await page.locator('aside').getByRole('button', { name: t.title, exact: true }).click();
 const card = page.locator('#settings-export'); await card.getByRole('button', { name: t.exportJson, exact: true }).click(); await expect(page.getByText(guest[lang].readOnlyAction, { exact: true })).toBeVisible(); expect(exports).toBe(0); await expect(card.getByRole('alert')).toHaveCount(0);
});
