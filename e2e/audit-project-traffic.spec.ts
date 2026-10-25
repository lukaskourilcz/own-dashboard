import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { professional } from '../src/lib/i18n/sections/professional';
for (const lang of ['en', 'cs'] as const) test(`${lang}: public project Overview avoids private traffic reads and an indefinite loading card`, async ({ page }) => {
 const errors = watchConsole(page), requests: string[] = [];
 page.on('request', request => { if (new URL(request.url()).pathname === '/api/vercel/analytics') requests.push(request.url()); });
 await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
 await page.goto('/dev-preview?project=dneskai&projectTab=overview');
 await expect(page.getByRole('tab', { name: lang === 'cs' ? 'Přehled' : 'Overview', exact: true })).toHaveAttribute('aria-selected', 'true');
 for (const width of [360, 430, 768, 1024, 1440, 1728]) {
  await page.setViewportSize({ width, height: 1000 });
  await expect(page.getByRole('heading', { name: professional[lang].projectTraffic, exact: true })).toHaveCount(0);
  await expect(page.getByText(professional[lang].trafficLoading, { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
 }
 expect(requests).toEqual([]); expect(errors).toEqual([]);
 expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});
