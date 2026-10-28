import { test, expect } from '@playwright/test';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';
for (const lang of ['en', 'cs'] as const) test(`Lab keeps matching fit feedback for crop and alternative text: ${lang}`, async ({ page }) => {
  const errors = watchConsole(page), fits: string[] = [], privateCalls: string[] = [], t = dneskaiLab[lang], w = dneskaiWorkspace[lang];
  page.on('request', request => { const url = request.url(); if (url.includes('/api/dev-preview/dneskai-fit')) fits.push(request.postData() ?? ''); if (url.includes('/api/marketing/')) privateCalls.push(url); });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab'), inspector = lab.getByTestId('dneskai-slide-inspector'), summary = inspector.getByTestId('dneskai-fit-summary');
  await expect(lab.getByTestId('dneskai-lab-approve')).toBeEnabled(); await expect(summary).toHaveText(t.slide.fitSummaryOk(1)); expect(fits).toHaveLength(1);
  await page.clock.install();
  const focal = inspector.getByTestId('dneskai-focal-picker').first(); await focal.focus(); await focal.press('ArrowRight'); await page.clock.fastForward(600);
  await expect(summary).toHaveText(t.slide.fitSummaryOk(1)); expect(fits).toHaveLength(1); await expect(lab.getByTestId('dneskai-lab-approve')).toBeDisabled();
  await inspector.locator('summary').filter({ hasText: w.fields.alt }).click(); await inspector.getByRole('textbox', { name: w.fields.alt, exact: true }).fill(lang === 'cs' ? 'Upravený popis obrázku' : 'Updated picture description'); await page.clock.fastForward(600);
  await expect(summary).toHaveText(t.slide.fitSummaryOk(1)); expect(fits).toHaveLength(1);
  await inspector.getByRole('textbox', { name: t.slide.fields.headline, exact: true }).fill(lang === 'cs' ? 'Nový krátký titulek' : 'New short headline'); await page.clock.fastForward(300);
  await expect(summary).toHaveText(t.slide.fitSummaryOk(1)); expect(fits).toHaveLength(2); expect(fits[1]).not.toBe(fits[0]); expect(privateCalls).toEqual([]); expect(errors).toEqual([]);
});
