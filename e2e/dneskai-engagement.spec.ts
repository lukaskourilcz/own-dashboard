import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';

/** #159: the comment keyword, DM message and public reply in the Design Lab, on the `/dev-preview` fixtures. */
test.beforeEach(async ({ page }) => {
  await page.route('**/api/vercel/analytics?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"kind":"unconfigured"}' }));
});
const axe = (page: Page) => new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] })
  .include('[data-testid="dneskai-lab"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
async function openEducationPost(page: Page, lang: 'en' | 'cs' = 'en') {
  await gotoPreview(page, { lang });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  await expect(page.getByTestId('dneskai-lab')).toBeVisible();
  await page.getByTestId('dneskai-lab-queue-post').filter({ hasText: 'Tip dne: kontext místo proseb' }).first().click();
  const block = page.getByTestId('dneskai-engagement');
  await expect(block.getByTestId('dneskai-engagement-chip')).toContainText('KONTEXT');
  return block;
}

test('editing the DM message saves a new version whose own hash is approved', async ({ page }) => {
  const errors = watchConsole(page), t = dneskaiLab.en;
  const block = await openEducationPost(page);
  const session = page.getByTestId('dneskai-lab-session');
  const versionBefore = await session.getByText(/^v\. /).first().textContent();
  const message = block.getByRole('textbox', { name: t.engagement.message, exact: true });
  await message.fill('New message text for the test.');
  await expect(block.getByTestId('dneskai-engagement-preview')).toContainText('New message text for the test.');
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
  await page.getByTestId('dneskai-lab').getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  await expect.poll(() => session.getByText(/^v\. /).first().textContent()).not.toBe(versionBefore);
  await expect(page.getByTestId('dneskai-engagement').getByRole('textbox', { name: t.engagement.message, exact: true })).toHaveValue('New message text for the test.');
  await page.getByTestId('dneskai-lab-approve').click();
  await expect(session).toContainText('Approved. Scheduled');
  expect(errors).toEqual([]);
});

test('a keyword with diacritics is refused in place and blocks the save', async ({ page }) => {
  const t = dneskaiLab.en;
  const block = await openEducationPost(page);
  const keyword = block.getByTestId('dneskai-engagement-keyword');
  await keyword.fill('návod');
  await expect(keyword).toHaveValue('NÁVOD');
  await expect(keyword).toHaveAttribute('aria-invalid', 'true');
  await expect(block.getByText(t.engagement.keywordInvalid)).toBeVisible();
  await page.getByTestId('dneskai-lab').getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(page.getByTestId('dneskai-lab-session').getByRole('alert')).toBeVisible();
});

for (const width of [1280, 360]) test(`the engagement block passes axe and fits at ${width} px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  for (const lang of ['en', 'cs'] as const) {
    const block = await openEducationPost(page, lang);
    await block.scrollIntoViewIfNeeded();
    expect((await axe(page)).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await block.screenshot({ path: info.outputPath(`engagement-${lang}-${width}.png`) });
  }
  // A news post has no keyword and offers to add one.
  await page.getByTestId('dneskai-lab-queue-post').filter({ hasText: 'Benchmark není žebříček' }).first().click();
  await expect(page.getByTestId('dneskai-engagement-add')).toBeVisible();
});
