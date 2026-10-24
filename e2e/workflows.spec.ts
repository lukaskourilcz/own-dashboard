import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { workflows } from '../src/lib/i18n/sections/workflows';
import { nav } from '../src/lib/i18n/sections/nav';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];

for (const lang of ['en', 'cs'] as const) {
  test(`Workflows explains actual areas, keeps holds and supports navigation (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page); const marketingCalls: string[] = [];
    page.on('request', request => { if (request.url().includes('/api/marketing/')) marketingCalls.push(request.url()); });
    await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
    await page.goto('/dev-preview?tab=workflows');
    const panel = page.getByTestId('workflows-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true }).first()).toBeVisible();
    await expect(panel.getByText(workflows[lang].marketingHold)).toBeVisible();
    await expect(panel.locator('figure')).toHaveCount(7);
    // An already-active destination is intentionally a no-op. Enter through
    // another destination so Back tests an actual canonical history entry.
    if (info.project.name === 'mobile') {
      await page.getByTestId('mobile-nav').getByRole('button', { name: nav[lang].sections.home, exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await page.getByRole('button', { name: nav[lang].more, exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Workflows', exact: true }).click();
    } else {
      await page.locator('aside').getByRole('button', { name: nav[lang].sections.home, exact: true }).click();
      await expect(page).toHaveURL(/\/$/);
      await page.locator('aside').getByRole('button', { name: 'Workflows', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/workflows$/);
    await expect(panel).toBeVisible();
    for (const width of info.project.name === 'mobile' ? [360, 430, 768] : [1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1440, height: 900 });
    const axe = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: `/tmp/own-workflows-${lang}-${info.project.name}.png`, fullPage: false });
    await panel.getByRole('heading', { name: workflows[lang].marketingTitle }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/own-workflows-marketing-${lang}-${info.project.name}.png`, fullPage: false });
    const projectLink = panel.getByRole('link', { name: nav[lang].sections.projects, exact: true });
    await projectLink.focus(); await expect(projectLink).toBeFocused(); await projectLink.press('Enter');
    await expect(page).toHaveURL(/\/projects$/); await expect(panel).toHaveCount(0);
    await page.goBack(); await expect(panel).toBeVisible();
    await page.goForward(); await expect(page).toHaveURL(/\/projects$/);
    expect(marketingCalls).toEqual([]); expect(errors).toEqual([]);
  });
}

test('direct Workflows route preserves the authenticated catch-all boundary', async ({ request }) => {
  const response = await request.get('/workflows', { maxRedirects: 0 });
  expect(response.status()).toBe(307); expect(response.headers().location).toContain('/login');
});
