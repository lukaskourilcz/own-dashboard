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

test('public Lab tour is read-only and never calls a fixture renderer or marketing API', async ({ page }) => {
  await gotoPreview(page);
  const calls: string[]=[]; page.on('request',request=>{if (/\/api\/(dev-preview|marketing)\//.test(request.url())) calls.push(request.url());});
  await page.goto('/guest?project=dneskai&lang=en&projectTab=dneskai-review');
  const lab=page.getByTestId('dneskai-lab');await expect(lab).toBeVisible();
  await expect(lab.getByText(dneskaiLab.en.publicTour).first()).toBeVisible();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
  await expect(page.getByTestId('dneskai-slide-inspector').getByRole('textbox',{name:'Headline',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'List',exact:true})).toBeDisabled();
  const axe=await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('[data-testid="dneskai-lab"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);expect(calls).toEqual([]);
});

for (const lang of ['en', 'cs'] as const) test(`Lab shows a changed slide as a marked, unapprovable draft preview (${lang})`, async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiLab[lang];
  const owner: string[] = [], previews: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/marketing/')) owner.push(request.url());
    if (request.url().includes('/api/dev-preview/dneskai-preview')) previews.push(request.url());
  });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const stage = page.getByTestId('dneskai-lab-stage');
  await expect(stage.getByTestId('dneskai-stage-slide')).toBeVisible();
  const headline = page.getByTestId('dneskai-slide-inspector').getByRole('textbox', { name: t.slide.fields.headline, exact: true });
  await headline.fill(lang === 'cs' ? 'Krátký titulek návrhu' : 'Short draft headline');
  // Real pixels of the draft, marked as unsaved, in a dashed frame; the saved JPEG is no longer on show.
  await expect(stage.getByTestId('dneskai-draft-badge')).toHaveText(t.draft.badge);
  await expect(stage.getByTestId('dneskai-stage-draft-image')).toHaveAttribute('src', /^data:image\/webp;base64,/, { timeout: 20_000 });
  await expect(stage.getByTestId('dneskai-stage-slide')).toHaveCount(0);
  await expect(stage.getByTestId('dneskai-strip-draft')).toHaveCount(1);
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
  // One debounced render for the whole pause in typing.
  expect(previews.length).toBe(1);
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-lab"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath(`lab-draft-${lang}.png`), fullPage: true });
  await page.getByTestId('dneskai-lab').getByRole('button', { name: t.actions.discard, exact: true }).click();
  await expect(stage.getByTestId('dneskai-draft-badge')).toHaveCount(0);
  await expect(stage.getByTestId('dneskai-stage-slide')).toBeVisible();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  expect(owner).toEqual([]); expect(errors).toEqual([]);
});

test('Lab changes a slide type, inserts a slide from the pool, saves and approves the new hash', async ({ page }) => {
  const t = dneskaiLab.en;
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab'), inspector = page.getByTestId('dneskai-slide-inspector');
  const version = await page.getByTestId('dneskai-lab-approve').textContent();
  // The cover's picture also fits a frame, so it may become a picture slide; its kicker has no place there.
  const shape = inspector.getByTestId('dneskai-slide-shape');
  await expect(shape.locator('option')).toHaveText([t.slide.shapes['cover-photo'], t.slide.shapes.figure, t.slide.shapes.split]);
  await shape.selectOption('figure');
  await expect(inspector.getByTestId('dneskai-inspector-notice')).toContainText(t.slide.fields.kicker);
  await expect(inspector.getByRole('textbox', { name: t.slide.fields.body, exact: true })).toBeVisible();
  await expect(page.getByTestId('dneskai-stage-draft-image')).toBeVisible({ timeout: 20_000 });
  await shape.selectOption('cover-photo');
  // A statement switches colour only.
  await page.getByTestId('dneskai-deck-strip').getByRole('button').nth(4).click();
  await expect(inspector).toContainText('Slide 4');
  await expect(inspector.getByTestId('dneskai-slide-shape').locator('option')).toHaveText([t.slide.shapes['statement-accent'], t.slide.shapes['statement-ink']]);
  // Insert a picture slide after slide 2 from an unused picture of a cited source.
  await page.getByTestId('dneskai-deck-strip').getByRole('button').nth(2).click();
  await inspector.getByTestId('dneskai-insert-slide').locator('summary').click();
  await inspector.getByRole('radio').first().check();
  await inspector.getByTestId('dneskai-insert-add').click();
  await expect(page.getByTestId('dneskai-lab-session').getByRole('status').first()).toContainText(t.slide.insert.added(3));
  await expect(page.getByTestId('dneskai-slide-inspector')).toContainText('Slide 3');
  await expect(page.getByTestId('dneskai-deck-strip').getByRole('button')).toHaveCount(8);
  // Until the owner writes the new slide's words, the draft cannot be previewed or saved.
  await expect(page.getByTestId('dneskai-stage-draft')).toContainText(t.draft.unavailable);
  const fresh = page.getByTestId('dneskai-slide-inspector');
  await fresh.getByRole('textbox', { name: t.slide.fields.headline, exact: true }).fill('A slide the owner added');
  await fresh.locator('summary', { hasText: /^Alt text$/ }).click();
  await fresh.getByRole('textbox', { name: 'Alt text', exact: true }).fill('A test-only picture from the second source.');
  await expect(page.getByTestId('dneskai-stage-draft-image')).toBeVisible({ timeout: 20_000 });
  await lab.getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByTestId('dneskai-lab-approve')).not.toHaveText(version!);
  await expect(page.getByTestId('dneskai-deck-strip').getByRole('button')).toHaveCount(8);
  await expect(page.getByTestId('dneskai-draft-badge')).toHaveCount(0);
  await page.getByTestId('dneskai-lab-approve').click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText('Approved. Scheduled');
});

test('Publish now stays off while the account does not publish, and says why', async ({ page }) => {
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const publish = page.getByTestId('dneskai-lab-publish-now');
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveAttribute('title', dneskaiLab.en.actions.publishNowOff);
});
