import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiDailyMix } from '../src/lib/i18n/sections/dneskai-daily-mix';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/vercel/analytics?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"kind":"unconfigured"}' }));
});

for (const lang of ['en', 'cs'] as const) test(`Sources → Daily mix shows the default read-only in the preview (${lang})`, async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiDailyMix[lang];
  const calls: string[] = []; page.on('request', (request) => { if (request.url().includes('/api/marketing/')) calls.push(request.url()); });
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 360, height: 800 });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=sources&sourceSection=mix');
  const mix = page.getByTestId('dneskai-daily-mix');
  await expect(mix).toBeVisible();
  await expect(mix.getByRole('heading', { name: t.title, exact: true })).toBeVisible();
  await expect(mix.getByRole('combobox', { name: t.news, exact: true })).toHaveValue('1');
  await expect(mix.getByRole('combobox', { name: t.education, exact: true })).toHaveValue('1');
  await expect(mix.getByRole('checkbox')).toHaveCount(4);
  await expect(mix.getByRole('button', { name: t.save, exact: true })).toBeDisabled();
  expect(calls).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-daily-mix"]').withTags(tags).analyze();
  expect(axe.violations).toEqual([]); expect(errors).toEqual([]);
  await mix.screenshot({ path: info.outputPath(`daily-mix-${lang}.png`) });
});
