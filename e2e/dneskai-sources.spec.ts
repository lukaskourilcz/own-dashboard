import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiSources } from '../src/lib/i18n/sections/dneskai-sources';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
for (const lang of ['en', 'cs'] as const) {
  test(`DNESKAi Sources is project-only, lazy and read-only in authentic preview (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page); const sourceRequests: string[] = [];
    // The existing project Overview requests traffic metadata before Sources
    // mounts. Keep that unrelated fixture request disconnected, not a live API.
    await page.route('**/api/vercel/analytics?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'unconfigured' }) }));
    page.on('request', request => { if (request.url().includes('/api/marketing/dneskai/')) sourceRequests.push(request.url()); });
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 360, height: 800 });
    await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
    const label = lang === 'cs' ? 'Zdroje (DNESKAi)' : 'Sources (DNESKAi)';
    await page.goto('/dev-preview?project=devshark'); expect(await page.getByRole('tab', { name: label, exact: true }).count()).toBe(0);
    await page.goto('/dev-preview?project=dneskai');
    await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible();
    await expect(page.getByTestId('dneskai-sources')).toHaveCount(0);
    await page.getByRole('tab', { name: label, exact: true }).click();
    const panel = page.getByTestId('dneskai-sources'); await expect(panel).toBeVisible();
    await expect(panel.getByText(dneskaiSources[lang].preview, { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: dneskaiSources[lang].refresh, exact: true })).toBeDisabled();
    await expect(panel.getByRole('link', { name: dneskaiSources[lang].openMarketing })).toHaveAttribute('href', '/marketing');
    await expect(panel.locator('img,input,textarea,select')).toHaveCount(0);
    expect(sourceRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-sources"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations).toEqual([]); expect(errors).toEqual([]);
    await page.screenshot({ path: `/tmp/marketing-dneskai-sources-${lang}-${info.project.name}.png`, fullPage: true });
  });
}
