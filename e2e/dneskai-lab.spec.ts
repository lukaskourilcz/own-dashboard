import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/vercel/analytics?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"kind":"unconfigured"}' }));
});
for (const lang of ['en', 'cs'] as const) test(`Lab queue, saved pixels, fit, dirty guard and keyboard (${lang})`, async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiLab[lang];
  const writes: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/marketing/')) writes.push(request.url()); });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab');
  await expect(lab).toBeVisible();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  await expect(page.getByTestId('dneskai-kit-bold').getByRole('radio')).toBeDisabled();
  const inspector = page.getByTestId('dneskai-slide-inspector');
  const headline = inspector.getByRole('textbox', { name: t.slide.fields.headline, exact: true });
  await headline.fill(lang === 'cs' ? 'Krátký ověřený titulek' : 'Short checked headline');
  await expect(page.getByTestId('dneskai-fit-summary')).toContainText(t.slide.fitSummaryOk(1));
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
  await expect(lab.getByText(t.savedPreview, { exact: false })).toBeVisible();
  await page.locator('[data-testid="dneskai-lab-queue-post"]:not([aria-current="true"])').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: t.actions.cancel, exact: true }).click();
  await lab.getByRole('button', { name: t.actions.discard, exact: true }).click();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  const session = page.getByTestId('dneskai-lab-session'); await session.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page).toHaveURL(/labSlide=1/);
  await page.keyboard.press('g'); await expect(page.getByTestId('dneskai-profile-grid')).toBeVisible();
  await page.keyboard.press('?'); await expect(page.getByRole('dialog')).toContainText(t.shortcuts.title);
  await page.keyboard.press('Escape'); await expect(session).toBeFocused();
  await page.keyboard.press('g');
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-lab"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]); expect(writes).toEqual([]);
  await page.screenshot({ path: info.outputPath(`lab-${lang}.png`), fullPage: true });
});

test('Lab saves a new version, shows new pixels, then approves only its hash', async ({ page }) => {
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const t = dneskaiLab.en, lab = page.getByTestId('dneskai-lab');
  const oldImage = await page.getByTestId('dneskai-lab-stage').locator('figure img').first().getAttribute('src');
  await page.getByTestId('dneskai-slide-inspector').getByRole('textbox', { name: t.slide.fields.headline, exact: true }).fill('A newly rendered test headline');
  await lab.getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(page).toHaveURL(/labPost=/);
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  await expect.poll(() => page.getByTestId('dneskai-lab-stage').locator('figure img').first().getAttribute('src')).not.toBe(oldImage);
  await page.getByTestId('dneskai-lab-approve').click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText('Approved. Scheduled');
});

test('Approve the day shows exact versions and per-item results', async ({ page }) => {
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  await page.getByTestId('dneskai-lab-queue').getByRole('button', { name: /Approve the day/ }).last().click();
  const dialog = page.getByTestId('dneskai-approve-day');
  await expect(dialog).toContainText('Each post below');
  const approve = dialog.getByRole('button', { name: /^Approve \d/ });
  await expect(approve).toBeEnabled(); await approve.click();
  await expect(dialog.getByRole('status')).toContainText('approved.');
});

for (const width of [360, 430, 768, 1024, 1440, 1728]) test(`Lab reflows at ${width}px and preserves a deep-linked slide`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  await gotoPreview(page, { lang: 'cs', theme: width % 3 === 0 ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review&labPost=d0e5ca10-0000-4000-8000-000000000001&labSlide=1');
  const lab=page.getByTestId('dneskai-lab');await expect(lab).toBeVisible();
  await expect(page.getByTestId('dneskai-slide-inspector')).toContainText('Slide 2');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByTestId('dneskai-stage-views').getByText('1:1',{exact:true}).click();await expect(page.getByTestId('dneskai-pixels')).toBeVisible();
  await page.reload();await expect(page.getByTestId('dneskai-slide-inspector')).toContainText('Slide 2');
  await page.screenshot({path:info.outputPath(`lab-${width}.png`),fullPage:true});
});
