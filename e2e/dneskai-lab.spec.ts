import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';

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
  await expect(page.getByTestId('dneskai-kit-bold').getByRole('radio')).toBeEnabled();
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
  // #172: Refresh is an icon button with a name; the shortcut list moved to the workspace More menu.
  await expect(lab.getByTestId('dneskai-lab-refresh')).toHaveAccessibleName(dneskaiWorkspace[lang].refresh);
  await expect(lab.getByRole('button', { name: t.shortcuts.title, exact: true })).toHaveCount(0);
  await page.getByTestId('dneskai-more').click();
  await page.getByTestId('dneskai-more-menu').getByRole('button', { name: dneskaiWorkspace[lang].more.shortcuts, exact: true }).click();
  const shortcuts = page.getByRole('dialog', { name: dneskaiWorkspace[lang].more.shortcuts });
  await expect(shortcuts.locator('dt')).toHaveCount(t.shortcuts.rows.length);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dneskai-more')).toBeFocused();
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
  await expect(page.getByRole('button',{name:'List',exact:true})).toHaveCount(0);
  await expect(page.getByTestId('dneskai-channels').getByRole('button',{name:/^Threads/})).toHaveAttribute('aria-disabled','true');
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
  // The cover shows only its headline (owner's post rules): no kicker or body field is offered on it.
  await expect(inspector.getByRole('textbox', { name: t.slide.fields.headline, exact: true })).toBeVisible();
  await expect(inspector.getByRole('textbox', { name: t.slide.fields.kicker, exact: true })).toHaveCount(0);
  await expect(inspector.getByRole('textbox', { name: t.slide.fields.body, exact: true })).toHaveCount(0);
  // The cover's picture also fits a frame, so it may become a picture slide; with only a headline nothing is dropped,
  // and the picture slide offers a body.
  const shape = inspector.getByTestId('dneskai-slide-shape');
  await expect(shape.locator('option')).toHaveText([t.slide.shapes['cover-photo'], t.slide.shapes.figure, t.slide.shapes.split]);
  await shape.selectOption('figure');
  await expect(inspector.getByTestId('dneskai-inspector-notice')).toHaveText('');
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
  // Four written slides (no sources slide) plus the inserted one, between the previous and next buttons.
  await expect(page.getByTestId('dneskai-deck-strip').getByRole('button')).toHaveCount(7);
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
  await expect(page.getByTestId('dneskai-deck-strip').getByRole('button')).toHaveCount(7);
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

test('Lab switches a post to another kit, previews it unsaved, then saves a version that needs its own approval', async ({ page }) => {
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const t = dneskaiLab.en, lab = page.getByTestId('dneskai-lab');
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  await page.getByTestId('dneskai-kit-ticker').click();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
  await expect(lab.getByText(t.savedPreview, { exact: false })).toBeVisible();
  await expect(page.getByTestId('dneskai-kit-ticker')).toContainText(t.kits.onStage);
  await lab.getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(lab.getByText(t.actions.saved)).toBeVisible();
  await expect(page.getByTestId('dneskai-lab-approve')).toBeEnabled();
  await expect(page.getByTestId('dneskai-kit-ticker').getByRole('radio')).toBeChecked();
});

test('Spotlight takes a round inset picture on the cover from the pool, previews it, saves and approves the new hash', async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiLab.en;
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const lab = page.getByTestId('dneskai-lab'), stage = page.getByTestId('dneskai-lab-stage');
  const inspector = page.getByTestId('dneskai-slide-inspector'), approve = page.getByTestId('dneskai-lab-approve');
  await expect(approve).toBeEnabled();
  const version = await approve.textContent();
  // The post's own kit draws no inset, so its cover offers none.
  await expect(inspector).toContainText('Slide 1');
  await expect(page.getByTestId('dneskai-kit-spotlight').getByRole('radio')).not.toBeChecked();
  await expect(inspector.getByTestId('dneskai-lab-inset')).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: t.slide.insetAdd })).toHaveCount(0);
  // Key 6 puts the post on the Spotlight kit; its cover can now take a second, round picture.
  await page.getByTestId('dneskai-lab-session').focus();
  await page.keyboard.press('6');
  await expect(page.getByTestId('dneskai-kit-spotlight').getByRole('radio')).toBeChecked();
  const inset = inspector.getByTestId('dneskai-lab-inset');
  await expect(inset).toContainText(t.slide.insetHelp);
  const draftImage = stage.getByTestId('dneskai-stage-draft-image');
  await expect(draftImage).toHaveAttribute('src', /^data:image\/webp;base64,/, { timeout: 20_000 });
  const withoutInset = await draftImage.getAttribute('src');
  await inset.getByRole('button', { name: t.slide.insetAdd, exact: true }).click();
  const tray = inset.getByTestId('dneskai-media-tray');
  await expect(tray).toBeVisible();
  await tray.getByRole('button', { name: new RegExp(`^${dneskaiWorkspace.en.editor.choose}: `) }).first().click();
  // The inset is now the cover's second picture, with its own crop controls and a way to remove it.
  await expect(inspector.getByTestId('dneskai-lab-picture-image-2')).toBeVisible();
  await expect(inspector.getByRole('button', { name: t.slide.insetRemove, exact: true })).toBeVisible();
  await expect(inspector.getByTestId('dneskai-lab-inset')).toHaveCount(0);
  await expect.poll(() => draftImage.getAttribute('src'), { timeout: 20_000 }).not.toBe(withoutInset);
  await expect(draftImage).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await expect(approve).toBeDisabled();
  await stage.screenshot({ path: info.outputPath('lab-spotlight-inset.png') });
  await lab.getByRole('button', { name: t.actions.save, exact: true }).click();
  await expect(approve).toBeEnabled({ timeout: 20_000 });
  await expect(approve).not.toHaveText(version!);
  await expect(page.getByTestId('dneskai-draft-badge')).toHaveCount(0);
  await expect(page.getByTestId('dneskai-kit-spotlight').getByRole('radio')).toBeChecked();
  await expect(inspector.getByTestId('dneskai-lab-picture-image-2')).toBeVisible();
  await approve.click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText('Approved. Scheduled');
  expect(errors).toEqual([]);
});

test('a kit without a cover inset drops the Spotlight inset and offers no inset controls', async ({ page }) => {
  const t = dneskaiLab.en;
  await gotoPreview(page); await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const inspector = page.getByTestId('dneskai-slide-inspector');
  await page.getByTestId('dneskai-kit-spotlight').click();
  const inset = inspector.getByTestId('dneskai-lab-inset');
  await inset.getByRole('button', { name: t.slide.insetAdd, exact: true }).click();
  await inset.getByTestId('dneskai-media-tray').getByRole('button', { name: new RegExp(`^${dneskaiWorkspace.en.editor.choose}: `) }).first().click();
  await expect(inspector.getByTestId('dneskai-lab-picture-image-2')).toBeVisible();
  for (const kit of ['editorial', 'bold', 'explainer', 'magazine', 'ticker'] as const) {
    await page.getByTestId(`dneskai-kit-${kit}`).click();
    await expect(page.getByTestId(`dneskai-kit-${kit}`).getByRole('radio')).toBeChecked();
    await expect(inspector.getByTestId('dneskai-lab-picture-image-2'), kit).toHaveCount(0);
    await expect(inspector.getByTestId('dneskai-lab-inset'), kit).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: t.slide.insetAdd }), kit).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: t.slide.insetRemove }), kit).toHaveCount(0);
  }
});

// Owner decisions 6, 8 and 9. The clock is fixed at 10:00 in Prague, so the fixture's missed post (09:40) moves to
// today's 12:30: 17:00 and 20:00 are held by the two topics waiting for the scheduler.
// The server renders Home with the real date, so a browser clock days away from it fails Home's hydration (React #418)
// before the Lab is even opened. The clock is therefore fixed only once Home is unloaded; the DNESKAi review renders its
// fixture in the browser, so the Lab itself sees the fixed time.
const DECISIONS_NOW = new Date('2026-10-20T08:00:00.000Z');
async function atDecisionsNow(page: Page, options: Parameters<typeof gotoPreview>[1] = {}) {
  await gotoPreview(page, options);
  await page.goto('about:blank');
  await page.clock.setFixedTime(DECISIONS_NOW);
}
for (const lang of ['en', 'cs'] as const) test(`a missed post moves to the next free slot and is approved by its new hash (${lang})`, async ({ page }) => {
  const errors = watchConsole(page), t = dneskaiLab[lang];
  await atDecisionsNow(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  // The Lab opens on a post that can still be approved, not on the missed one.
  await expect(page.getByTestId('dneskai-lab-moved')).toHaveCount(0);
  await page.getByTestId('dneskai-lab-queue-post').filter({ hasText: t.queue.moved }).click();
  const moved = page.getByTestId('dneskai-lab-moved');
  await expect(moved).toContainText(t.actions.moved.title);
  const button = moved.getByRole('button', { name: t.actions.moved.button('12:30') });
  await expect(button).toBeEnabled();
  await button.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(t.actions.moved.dialogTitle('12:30'));
  await expect(page.getByTestId('dneskai-move-summary')).toContainText('Malý model bez připojení');
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByTestId('dneskai-move-confirm').click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText(t.actions.moved.done('12:30'));
  await expect(page.getByTestId('dneskai-lab-moved')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a returned post is regenerated with the owner’s note; it never approves anything', async ({ page }) => {
  const t = dneskaiLab.en;
  await atDecisionsNow(page);
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review&labPost=d0e5ca10-0000-4000-8000-000000000004');
  const regenerate = page.getByTestId('dneskai-lab-regenerate');
  await expect(regenerate).toBeEnabled();
  await regenerate.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(t.actions.regenerateDescription);
  const note = page.getByTestId('dneskai-regenerate-note');
  // The return feedback is filled in; an empty note cannot be sent.
  await expect(note).toHaveValue('Titulek je moc dlouhý, zkraťte ho na jednu krátkou větu.');
  await note.fill('   ');
  await expect(page.getByTestId('dneskai-regenerate-confirm')).toBeDisabled();
  await note.fill('Kratší titulek, bez otázky.');
  await page.getByTestId('dneskai-regenerate-confirm').click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText(t.actions.regenerateQueued);
  await expect(page.getByTestId('dneskai-lab-approve')).toBeDisabled();
});

for (const lang of ['en', 'cs'] as const) test(`a waiting topic is generated now, and the next one is refused at the daily limit (${lang})`, async ({ page }) => {
  const errors = watchConsole(page), t = dneskaiLab[lang];
  await atDecisionsNow(page, { lang });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const waiting = page.getByTestId('dneskai-lab-waiting');
  await expect(waiting.getByText(t.queue.waiting)).toHaveCount(2);
  const first = waiting.getByRole('button', { name: t.queue.generateNowName('Jak číst kartu modelu') });
  await first.focus(); await page.keyboard.press('Enter');
  await expect(waiting.getByRole('status')).toContainText(t.queue.generateNowQueued);
  await expect(waiting.getByText(t.queue.waiting)).toHaveCount(1);
  await expect(page.getByTestId('dneskai-lab-queue').getByText(`17:00 · ${t.queue.preparing}`)).toBeVisible();
  await waiting.getByRole('button', { name: t.queue.generateNowName('Kdy pomůže vyhledávání v dokumentech') }).click();
  await expect(waiting.getByRole('status')).toContainText(lang === 'cs' ? 'Denní limit generování DNESKAi je vyčerpaný.' : 'The DNESKAi daily generation limit is reached.');
  await expect(waiting.getByText(t.queue.waiting)).toHaveCount(1);
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-lab-queue"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

for (const [lang, width] of [['en', 1280], ['cs', 1280], ['en', 360], ['cs', 360]] as const) test(`Topics: approve, reject, restore and keyboard at ${width} px (${lang})`, async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiLab[lang].topics;
  const writes: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/marketing/')) writes.push(request.url()); });
  await page.setViewportSize({ width, height: 900 });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const topics = page.getByTestId('dneskai-topics');
  await expect(topics).toBeVisible();
  await expect(topics.getByRole('list', { name: t.listLabel(t.groups.news) })).toBeVisible();
  await expect(topics.getByRole('list', { name: t.listLabel(t.groups.education) })).toBeVisible();
  // #210: an approved topic with no link says why it waits.
  await expect(topics.getByTestId('dneskai-topic-code')).toHaveText(t.codes['topic-source-missing']);
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-topics"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await topics.screenshot({ path: info.outputPath(`topics-${lang}-${width}.png`) });
  // Keyboard: the first row holds the tab stop; ↓ moves, A approves, Z rejects.
  const rows = topics.locator('[data-topic-row]');
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('a');
  await expect(topics.getByRole('status')).toHaveText(t.done.approve(1));
  await expect(topics).toHaveAttribute('aria-busy', 'false');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('z');
  await expect(topics.getByRole('status')).toHaveText(t.done.reject(1));
  // Bulk approve, then restore from the disclosure.
  const checkboxes = topics.getByRole('checkbox');
  await checkboxes.first().click(); await checkboxes.nth(1).click();
  await topics.getByTestId('dneskai-topics-approve-selected').click();
  await expect(topics.getByRole('status')).toHaveText(t.done.approve(2));
  await expect(topics).toHaveAttribute('aria-busy', 'false');
  await topics.getByTestId('dneskai-topics-archive').locator('summary').click();
  await topics.getByTestId('dneskai-topics-archive').getByRole('button', { name: t.restore }).first().click();
  await expect(topics.getByRole('status')).toHaveText(t.done.restore(1));
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});
