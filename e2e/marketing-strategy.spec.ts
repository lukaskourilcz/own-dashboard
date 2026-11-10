import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';

for (const brand of ['devshark', 'dneskai'] as const) {
  test(`${brand} Strategy shares drafts/topics with production surfaces and preserves an unmeasured baseline`, async ({ page }) => {
    const errors = watchConsole(page);
    const requests: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/api/marketing/strategy')) requests.push(r.url()); });
    await gotoPreview(page);
    await page.goto(`/dev-preview?project=${brand}&projectTab=strategy`);
    const strategy = page.getByTestId('marketing-strategy');
    await expect(strategy).toBeVisible();
    await strategy.getByRole('button', { name: '25 ideas', exact: true }).click();
    await expect(strategy.locator('details')).toHaveCount(25);
    const create = strategy.getByRole('button', { name: brand === 'devshark' ? 'Add unapproved draft' : 'Add proposed topic', exact: true }).first();
    await create.click();
    const open = strategy.getByRole('button', { name: brand === 'devshark' ? 'Open draft' : 'Review topics', exact: true }).first();
    await expect(open).toBeEnabled();
    await strategy.getByRole('button', { name: 'Results', exact: true }).click();
    await expect(strategy).toContainText('No measured results yet');
    await strategy.getByRole('button', { name: '25 ideas', exact: true }).click();
    await open.click();
    if (brand === 'devshark') {
      await expect(page.getByTestId('devshark-studio')).toContainText('Which log runs first?');
      await expect(page.getByTestId('devshark-studio')).toContainText('Waiting for approval');
      await page.getByTestId('devshark-studio').getByRole('button', { name: 'Strategy', exact: true }).click();
      await expect(strategy).toBeVisible();
    } else {
      await expect(page.getByText('Z porady udělejte seznam úkolů', { exact: true }).first()).toBeVisible();
    }
    expect(requests).toEqual([]); expect(errors).toEqual([]);
  });
}

test('Strategy reflows in both languages and themes, with accessible names and keyboard controls', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'The desktop project exercises the complete six-width matrix.');
  await gotoPreview(page, { lang: 'cs', theme: 'dark' });
  await page.goto('/dev-preview?project=dneskai&projectTab=strategy');
  const strategy = page.getByTestId('marketing-strategy');
  await expect(strategy).toBeVisible();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(strategy).toContainText('Strategie růstu bez tváře');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await strategy.getByRole('button', { name: 'Apify', exact: true }).click();
  const apify = page.getByTestId('strategy-apify');
  await expect(apify).toContainText('26 / 241');
  await expect(apify).toContainText('neobsahuje analyzovanou skupinu českých AI konkurentů');
  await apify.locator('summary').filter({ hasText: 'Pokrytí účtů v tomto vzorku' }).click();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[data-testid="strategy-apify"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/strategy-apify-cs-dark.png' });
  await strategy.getByRole('button', { name: '25 námětů', exact: true }).click();
  const summary = strategy.locator('summary').first(); await summary.focus(); await page.keyboard.press('Enter');
  await expect(strategy.locator('details').first()).toHaveAttribute('open', '');
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[data-testid="marketing-strategy"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'test-results/strategy-cs-dark.png' });
  await gotoPreview(page, { lang: 'en', theme: 'light' });
  await page.goto('/dev-preview?project=devshark&projectTab=strategy');
  await expect(strategy).toContainText('Faceless growth strategy');
  await strategy.getByRole('button', { name: 'Apify', exact: true }).click();
  await expect(apify).toContainText('No new runs have been started');
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[data-testid="marketing-strategy"]').analyze()).violations).toEqual([]);
});
