import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiSources } from '../src/lib/i18n/sections/dneskai-sources';
import { dneskaiAccount } from '../src/lib/i18n/sections/dneskai-account';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';
import { dneskaiSourceList } from '../src/lib/i18n/sections/dneskai-source-list';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
for (const lang of ['en', 'cs'] as const) {
  test(`DNESKAi Sources lists Instagram profiles and websites, project-only and read-only in the preview (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page); const sourceRequests: string[] = [];
    // The existing project Overview requests traffic metadata before Sources
    // mounts. Keep that unrelated fixture request disconnected, not a live API.
    await page.route('**/api/vercel/analytics?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'unconfigured' }) }));
    page.on('request', request => { if (request.url().includes('/api/marketing/dneskai/') || request.url().includes('/api/marketing/accounts')) sourceRequests.push(request.url()); });
    if (info.project.name === 'mobile') await page.setViewportSize({ width: 360, height: 800 });
    await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
    const label = lang === 'cs' ? 'Zdroje (DNESKAi)' : 'Sources (DNESKAi)';
    const t = dneskaiSourceList[lang], w = dneskaiWorkspace[lang];
    await page.goto('/dev-preview?project=devshark'); expect(await page.getByRole('tab', { name: label, exact: true }).count()).toBe(0);
    await page.goto('/dev-preview?project=dneskai');
    await expect(page.getByRole('tab', { name: label, exact: true })).toBeVisible();
    await expect(page.getByTestId('dneskai-source-list')).toHaveCount(0);
    await page.getByRole('tab', { name: label, exact: true }).click();
    // #174: two lists; the account panel and the recovery records moved to the More menu.
    const list = page.getByTestId('dneskai-source-list'); await expect(list).toBeVisible();
    await expect(list.getByRole('heading', { level: 3, name: new RegExp(`^${t.instagram}`) })).toBeVisible();
    await expect(list.getByRole('heading', { level: 3, name: new RegExp(`^${t.web}`) })).toBeVisible();
    await expect(list.getByText(t.preview, { exact: true })).toBeVisible();
    await expect(page.getByTestId('dneskai-sources-instagram').getByTestId('dneskai-source-row').first()).toBeVisible();
    await expect(page.getByTestId('dneskai-sources-web').getByTestId('dneskai-source-row').first()).toBeVisible();
    await expect(list.getByRole('switch', { name: t.readSwitch('@aimanie') })).toHaveAttribute('aria-checked', 'false');
    await expect(list.getByRole('switch').first()).toBeDisabled();
    await expect(list.locator('form')).toHaveCount(0);
    await expect(page.getByTestId('dneskai-instagram-account')).toHaveCount(0);
    await expect(page.getByTestId('dneskai-sources')).toHaveCount(0);
    expect(sourceRequests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-source-list"]').withTags(AXE_TAGS).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`dneskai-source-list-${lang}.png`), fullPage: true });

    // The account panel opens from More, read-only in the preview.
    const more = page.getByTestId('dneskai-more');
    await more.click();
    await page.getByTestId('dneskai-more-menu').getByRole('button', { name: w.more.account, exact: true }).click();
    const account = page.getByTestId('dneskai-instagram-account'); await expect(account).toBeVisible();
    await expect(account.getByText(dneskaiAccount[lang].preview, { exact: true })).toBeVisible();
    await expect(account.getByRole('button', { name: dneskaiAccount[lang].verify, exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(more).toBeFocused();

    // Topic recovery opens from More too; its control switches to the review tab and focus follows to that tab.
    await more.click();
    await page.getByTestId('dneskai-more-menu').getByRole('button', { name: w.more.recovery, exact: true }).click();
    const panel = page.getByTestId('dneskai-sources'); await expect(panel).toBeVisible();
    await expect(panel.getByText(dneskaiSources[lang].preview, { exact: true })).toBeVisible();
    const recoveryAxe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[role="dialog"]').withTags(AXE_TAGS).analyze();
    expect(recoveryAxe.violations).toEqual([]);
    await panel.getByRole('button', { name: dneskaiSources[lang].openReview, exact: true }).click();
    const review = page.getByRole('tab', { name: w.tabs.review, exact: true });
    await expect(review).toHaveAttribute('aria-selected', 'true'); await expect(review).toBeFocused();
    await expect(page.getByTestId('dneskai-sources')).toHaveCount(0); await expect(page.getByTestId('dneskai-lab')).toBeVisible();
    expect(sourceRequests).toEqual([]);
    expect(errors).toEqual([]);
  });
}
