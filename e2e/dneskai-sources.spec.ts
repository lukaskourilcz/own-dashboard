import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiSources } from '../src/lib/i18n/sections/dneskai-sources';
import { dneskaiAccount } from '../src/lib/i18n/sections/dneskai-account';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
for (const lang of ['en', 'cs'] as const) {
  test(`DNESKAi Sources is project-only, lazy and read-only in authentic preview (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page); const sourceRequests: string[] = [];
    // The existing project Overview requests traffic metadata before Sources
    // mounts. Keep that unrelated fixture request disconnected, not a live API.
    await page.route('**/api/vercel/analytics?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'unconfigured' }) }));
    page.on('request', request => { if (request.url().includes('/api/marketing/dneskai/') || request.url().includes('/api/marketing/accounts')) sourceRequests.push(request.url()); });
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
    await expect(panel.getByRole('link')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: dneskaiSources[lang].openReview, exact: true })).toBeEnabled();
    await expect(panel.locator('img,input,textarea,select')).toHaveCount(0);
    const account = page.getByTestId('dneskai-instagram-account'); await expect(account).toBeVisible();
    await expect(account.getByText(dneskaiAccount[lang].preview, { exact: true })).toBeVisible();
    await expect(account.getByRole('button', { name: dneskaiAccount[lang].verify, exact: true })).toBeDisabled();
    expect(sourceRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-sources"]').include('[data-testid="dneskai-instagram-account"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations).toEqual([]); expect(errors).toEqual([]);
    await page.screenshot({ path: `/tmp/marketing-dneskai-sources-${lang}-${info.project.name}.png`, fullPage: true });
    // Final review is the workspace tab „Dnes ke schválení“; the control switches to it and focus follows to its tab.
    await panel.getByRole('button', { name: dneskaiSources[lang].openReview, exact: true }).click();
    const review = page.getByRole('tab', { name: dneskaiWorkspace[lang].tabs.review, exact: true });
    await expect(review).toHaveAttribute('aria-selected', 'true'); await expect(review).toBeFocused();
    await expect(page.getByTestId('dneskai-sources')).toHaveCount(0); await expect(page.getByTestId('dneskai-review')).toBeVisible();
  });
}
