import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiKeywordLine } from '../src/lib/marketing/dneskai-caption';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';
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
  // The approve button names the exact version it approves.
  const version = page.getByTestId('dneskai-lab-approve').locator('.font-mono');
  const versionBefore = await version.textContent();
  const message = block.getByRole('textbox', { name: t.engagement.message, exact: true });
  await message.fill('New message text for the test.');
  await expect(block.getByTestId('dneskai-engagement-preview')).toContainText('New message text for the test.');
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
  await page.getByTestId('dneskai-lab').getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  await expect.poll(() => version.textContent()).not.toBe(versionBefore);
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

for (const lang of ['en', 'cs'] as const) test(`${lang}: caption and message counters match their save limits`, async ({ page }) => {
  const errors = watchConsole(page), t = dneskaiLab[lang];
  const block = await openEducationPost(page, lang);
  const message = block.getByRole('textbox', { name: t.engagement.message, exact: true });
  await message.fill('😀'.repeat(501));
  await expect(message).toHaveAttribute('aria-invalid', 'true');
  await expect(block.getByText('1002 / 1000', { exact: false })).toBeVisible();
  const reply = block.getByRole('textbox', { name: t.engagement.publicReply, exact: true });
  await reply.fill('😀'.repeat(101));
  await expect(reply).toHaveAttribute('aria-invalid', 'true');
  await expect(block.getByText('202 / 200', { exact: false })).toBeVisible();
  const caption = page.getByTestId('dneskai-lab-session').getByRole('textbox', { name: t.post.caption, exact: true });
  await caption.fill('a'.repeat(2200) + ' ');
  await expect(caption).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(`${2201 + 2 + dneskaiKeywordLine('KONTEXT').length} / 2200`, { exact: false })).toBeVisible();
  await caption.fill('😀'.repeat(1101));
  await expect(caption).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(`${2202 + 2 + dneskaiKeywordLine('KONTEXT').length} / 2200`, { exact: false })).toBeVisible();
  const inspector = page.getByTestId('dneskai-slide-inspector');
  await inspector.locator('summary').filter({ hasText: dneskaiWorkspace[lang].fields.alt }).click();
  const alt = inspector.getByRole('textbox', { name: dneskaiWorkspace[lang].fields.alt, exact: true });
  await alt.fill('😀'.repeat(501));
  await expect(alt).toHaveAttribute('aria-invalid', 'true');
  await expect(inspector.getByText('1002 / 1000', { exact: false })).toBeVisible();
  const preview = block.getByRole('region', { name: t.engagement.preview, exact: true });
  await preview.focus();
  await preview.press('ArrowDown');
  await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect((await axe(page)).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});
