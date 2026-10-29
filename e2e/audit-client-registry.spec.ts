import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { professional } from '../src/lib/i18n/sections/professional';
for (const lang of ['en','cs'] as const) test(`${lang}: client draft retains unavailable lookup input and controls fit all widths`, async ({ page }) => {
 const p = professional[lang], errors = watchConsole(page), requests: string[] = [];
 page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/registry/')) requests.push(request.url()); });
 await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.goto('/dev-preview?tab=clients');
 await page.getByRole('button', { name: p.newClient, exact: true }).click();
 const form = page.locator('form').filter({ has: page.locator('#org-ico') });
 await form.getByLabel(p.name, { exact: true }).fill('Synthetic billing draft'); await form.locator('#org-ico').fill('27074358');
 await form.locator('#org-ico').focus(); await page.keyboard.press('Tab'); await expect(form.getByRole('button', { name: p.fillFromAres, exact: true })).toBeFocused(); await page.keyboard.press('Enter');
 await expect(form.getByRole('alert')).toHaveText(p.aresUnavailable);
 await expect(form.getByLabel(p.name, { exact: true })).toHaveValue('Synthetic billing draft'); await expect(form.locator('#org-ico')).toHaveValue('27074358');
 for (const width of [360,430,768,1024,1440,1728]) {
  await page.setViewportSize({ width, height: 1000 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect.poll(async () => {
   const field = await form.locator('#org-ico').boundingBox(), control = await form.getByRole('button', { name: p.fillFromAres, exact: true }).boundingBox();
   return !!field && !!control && field.width >= 96 && Math.abs(field.y - control.y) < 1 && Math.abs(field.height - control.height) < 1 && (width >= 768 || control.height >= 44);
  }).toBe(true);
 }
 const card = form.locator('..').locator('..'), cardBox = await card.boundingBox(), parentBox = await card.locator('..').boundingBox(), submitBox = await form.locator('button[type="submit"]').boundingBox();
 expect(cardBox!.width).toBeLessThanOrEqual(896); expect(Math.abs(cardBox!.x + cardBox!.width / 2 - parentBox!.x - parentBox!.width / 2)).toBeLessThan(1); expect(submitBox!.width).toBeLessThan(cardBox!.width / 2);
 expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
 await page.getByRole('button', { name: p.newClient, exact: true }).click(); await page.getByRole('button', { name: p.newClient, exact: true }).click();
 await expect(form.getByLabel(p.name, { exact: true })).toHaveValue('Synthetic billing draft'); expect(requests).toEqual([]); expect(errors).toEqual([]);
});
