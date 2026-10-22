import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The DNESKAi workspace (#119) in the deterministic preview: in-memory demo posts, nothing reaches a server. */
async function openWorkspace(page: Page, lang: 'en' | 'cs', tab: keyof typeof dneskaiWorkspace.en.tabs, theme: 'light' | 'dark' = 'light') {
  const requests: string[] = [];
  page.on('request', (request) => { if (/\/api\/marketing\/(dneskai|revisions|accounts)/.test(request.url())) requests.push(request.url()); });
  await gotoPreview(page, { lang, theme });
  await page.goto('/dev-preview?project=dneskai');
  await openTab(page, lang, tab);
  if (tab === 'review') await page.getByRole('button', { name: lang === 'cs' ? 'Seznam' : 'List', exact: true }).click();
  return requests;
}
/** Errors and costs left the tab strip (#169): it opens as a dialog from the More menu. */
async function openTab(page: Page, lang: 'en' | 'cs', tab: keyof typeof dneskaiWorkspace.en.tabs) {
  if (tab !== 'costs') return page.getByRole('tab', { name: dneskaiWorkspace[lang].tabs[tab], exact: true }).click();
  // The mobile navigation has its own „Více“; the workspace button is the one in the tab row.
  const more = page.getByTestId('dneskai-more');
  await expect(more).toHaveAccessibleName(dneskaiWorkspace[lang].more.button);
  await more.click();
  await page.getByTestId('dneskai-more-menu').getByRole('button', { name: dneskaiWorkspace[lang].more.costs, exact: true }).click();
}
// Project Overview asks for traffic metadata as soon as any project opens. Stub it before the first navigation of
// every test: the review test opens devShark first, and an unstubbed request answers 401 into the console watcher.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/vercel/analytics?**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'unconfigured' }) }));
});
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const firstPost = (page: Page) => page.getByTestId('dneskai-post').first();

for (const lang of ['cs', 'en'] as const) {
  test(`For review today lists posts with rendered slides, states and one approval button, read-only and accessible (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page);
    const t = dneskaiWorkspace[lang];
    await page.goto('/dev-preview?project=devshark');
    expect(await page.getByRole('tab', { name: t.tabs.review, exact: true }).count()).toBe(0);
    const requests = await openWorkspace(page, lang, 'review', lang === 'cs' ? 'dark' : 'light');
    const review = page.getByTestId('dneskai-review');
    await expect(review.getByRole('heading', { level: 2, name: t.review.title })).toBeVisible();
    await expect(review.getByText(t.preview)).toBeVisible();
    const post = firstPost(page);
    // Four written slides; a deck has no sources slide.
    await expect(post.locator('img')).toHaveCount(4);
    await expect(post.getByText(t.states.review, { exact: true })).toBeVisible();
    const approve = post.getByTestId('dneskai-approve');
    await expect(approve).toContainText(t.card.approve);
    await expect(approve).toBeEnabled();
    // Every state the issue names is visible somewhere with its text: review, problem, returned, preparing.
    for (const state of [t.states.problem, t.states.returned, t.states.preparing]) await expect(review.getByText(state, { exact: true }).first()).toBeVisible();
    const blocked = page.getByTestId('dneskai-post').filter({ hasText: t.states.problem }).first();
    await expect(blocked.getByTestId('dneskai-approve')).toBeDisabled();
    await expect(blocked.getByText(t.card.blockedRender)).toBeVisible();
    // Technical identifiers stay inside a collapsed Details element.
    await expect(post.getByText(t.detailHash)).toBeHidden();
    expect(requests).toEqual([]);
    expect(await noOverflow(page)).toBe(true);
    const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-review"]').withTags(AXE_TAGS).analyze();
    expect(axe.violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`dneskai-review-${lang}.png`), fullPage: true });
  });
}

test('approving schedules the exact version and the calendar shows it as scheduled', async ({ page }) => {
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.cs;
  await openWorkspace(page, 'cs', 'review');
  const post = firstPost(page);
  const title = (await post.getByRole('heading', { level: 3 }).textContent())!;
  const approve = post.getByTestId('dneskai-approve');
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole('status').filter({ hasText: /Schváleno a zařazeno/ })).toBeVisible();
  await expect(page.getByTestId('dneskai-post').filter({ hasText: title })).toHaveCount(0);
  const decided = page.getByRole('region', { name: t.review.decided });
  await expect(decided.getByText(title)).toBeVisible();
  await expect(decided.locator('li', { hasText: title }).getByText(t.states.scheduled, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: t.tabs.calendar, exact: true }).click();
  const entry = page.getByTestId('dneskai-calendar').locator('li', { hasText: title });
  await expect(entry.getByText(t.states.scheduled, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('editing a slide renders a new version and the main button carries the new hash', async ({ page }) => {
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.cs;
  await openWorkspace(page, 'cs', 'review');
  const post = firstPost(page);
  const oldVersion = (await post.getByTestId('dneskai-approve').textContent())!.match(/verze ([a-f0-9]{7})/)![1];
  const edit = post.getByRole('button', { name: t.card.edit, exact: true });
  await edit.click();
  const dialog = page.getByRole('dialog', { name: t.editor.title });
  await expect(dialog).toBeVisible();
  // Escape closes the editor and returns focus to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();
  await edit.click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('dneskai-editor-main')).toContainText(t.card.approve);
  // The cover draws only its headline: no label, credit or body is offered.
  const editor = dialog.getByTestId('dneskai-slide-editor');
  await expect(editor.getByLabel(t.fields.headline, { exact: true })).toBeVisible();
  await expect(editor.getByLabel(t.fields.kicker, { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel(t.fields.credit, { exact: true })).toHaveCount(0);
  await expect(editor.getByLabel(t.fields.body, { exact: true })).toHaveCount(0);
  const headline = editor.getByLabel(t.fields.headline, { exact: true });
  await headline.fill('x'.repeat(120));
  await expect(editor.getByText(/120 \/ 110 · o 10 znaků víc/)).toBeVisible();
  await dialog.getByTestId('dneskai-editor-main').click();
  await expect(dialog.getByRole('alert')).toContainText(t.editor.fix);
  await headline.fill('Benchmark čtěte s metodikou');
  await expect(dialog.getByTestId('dneskai-editor-main')).toHaveText(t.editor.save);
  await dialog.getByTestId('dneskai-editor-main').click();
  await expect(dialog.getByText(t.editor.saving).first()).toBeVisible();
  await expect(dialog.getByText(t.editor.saved)).toBeVisible({ timeout: 15_000 });
  const main = dialog.getByTestId('dneskai-editor-main');
  await expect(main).toContainText(t.card.approve);
  const newVersion = (await main.textContent())!.match(/verze ([a-f0-9]{7})/)![1];
  expect(newVersion).not.toBe(oldVersion);
  await expect(main).toBeEnabled();
  await main.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: /Schváleno a zařazeno/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('returning a post for changes needs a note, which stays on the card', async ({ page }) => {
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.cs;
  await openWorkspace(page, 'cs', 'review');
  const post = firstPost(page);
  const title = (await post.getByRole('heading', { level: 3 }).textContent())!;
  await post.getByRole('button', { name: t.card.return, exact: true }).click();
  const send = post.getByRole('button', { name: t.card.sendReturn, exact: true });
  await expect(send).toBeDisabled();
  await post.getByLabel(t.card.feedback, { exact: true }).fill('Zkraťte titulek na jednu větu.');
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByRole('status').filter({ hasText: t.card.returned })).toBeVisible();
  const returned = page.getByTestId('dneskai-post').filter({ hasText: title });
  await expect(returned.getByText(t.states.returned, { exact: true })).toBeVisible();
  await expect(returned.getByText('Zkraťte titulek na jednu větu.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a version whose slides never attached reads as an error with a next step and renders again from the editor', async ({ page }) => {
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.cs;
  await openWorkspace(page, 'cs', 'costs');
  // Errors and costs lists every post for review that cannot be approved, with what happened.
  const blocked = page.getByTestId('dneskai-blocked-posts');
  await expect(blocked.locator('li', { hasText: 'Co stojí jeden dotaz' }).getByText(/slidy se k ní nepřipojily/)).toBeVisible();
  await expect(blocked.locator('li', { hasText: 'Proč verzovat prompty' })).toBeVisible();
  await expect(blocked.locator('li', { hasText: 'Lokální model na notebooku' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: t.tabs.review, exact: true }).click();
  await page.getByRole('button', { name: 'Seznam', exact: true }).click();
  const stuck = page.getByTestId('dneskai-post').filter({ hasText: 'Co stojí jeden dotaz' });
  await expect(stuck.getByText(t.states.problem, { exact: true })).toBeVisible();
  await expect(stuck.getByText(/slidy se k ní nepřipojily/)).toBeVisible();
  await expect(stuck.getByTestId('dneskai-approve')).toBeDisabled();
  await expect(stuck.getByText(t.card.blockedAttach)).toBeVisible();
  // A version saved moments ago is still on its way.
  await expect(page.getByTestId('dneskai-post').filter({ hasText: 'Lokální model na notebooku' }).getByText(t.states.preparing, { exact: true })).toBeVisible();
  await stuck.getByRole('button', { name: t.card.edit, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t.editor.title });
  const main = dialog.getByTestId('dneskai-editor-main');
  await expect(main).toHaveText(t.editor.rerender);
  await main.click();
  await expect(dialog.getByText(t.editor.saved)).toBeVisible({ timeout: 15_000 });
  await expect(main).toContainText(t.card.approve);
  await expect(main).toBeEnabled();
  expect(errors).toEqual([]);
});

test('the focal point moves by keyboard and pictures, slides and order change without a pointer', async ({ page }) => {
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.en;
  await openWorkspace(page, 'en', 'review');
  await firstPost(page).getByRole('button', { name: t.card.edit, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: t.editor.title });
  const picker = dialog.getByTestId('dneskai-focal-picker');
  await picker.focus();
  await expect(dialog.getByText('Focal point: 42 % across, 55 % down')).toBeVisible();
  for (let index = 0; index < 3; index += 1) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');
  await expect(dialog.getByText('Focal point: 48 % across, 53 % down')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(dialog.getByText('Focal point: 50 % across, 50 % down')).toBeVisible();
  const zoom = dialog.getByLabel(t.editor.zoom, { exact: true });
  await zoom.focus();
  await page.keyboard.press('ArrowRight');
  await expect(zoom).toHaveValue('1.05');
  // Swap the cover picture from the topic's pool; a picture too small for a cover says so.
  await dialog.getByRole('button', { name: t.editor.swap }).click();
  const tray = dialog.getByTestId('dneskai-media-tray');
  await expect(tray.getByText(t.editor.notFitting).first()).toBeVisible();
  await tray.getByRole('button', { name: `${t.editor.choose}: ${t.editor.origin(2, 3)}` }).click();
  await expect(dialog.getByText(t.editor.chosen)).toBeVisible();
  // Move the second slide down with its keyboard button, then remove the last slide (four written slides, no sources slide).
  const rows = dialog.getByTestId('dneskai-editor-slide');
  await expect(rows).toHaveCount(4);
  await dialog.getByRole('button', { name: `${t.editor.moveDown}: ${t.card.problemSlide(2)}` }).click();
  await expect(dialog.getByText(t.editor.moved(3))).toBeVisible();
  await dialog.getByRole('button', { name: `${t.editor.remove}: ${t.card.problemSlide(4)}` }).click();
  await expect(rows).toHaveCount(3);
  await expect(dialog.getByTestId('dneskai-editor-main')).toHaveText(t.editor.save);
  const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-post-editor"]').withTags(AXE_TAGS).analyze();
  expect(axe.violations).toEqual([]);
  await dialog.getByTestId('dneskai-editor-main').click();
  await expect(dialog.getByText(t.editor.saved)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId('dneskai-editor-slide')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('every DNESKAi tab reflows at 360, 430, 768 and 1280 px and passes axe', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the widths are set explicitly');
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.cs;
  await openWorkspace(page, 'cs', 'review');
  for (const width of [360, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [tab, id] of [['review', 'dneskai-review'], ['calendar', 'dneskai-calendar'], ['published', 'dneskai-published'], ['costs', 'dneskai-costs']] as const) {
      await openTab(page, 'cs', tab);
      if (id === 'dneskai-review') await page.getByRole('button', { name: 'Seznam', exact: true }).click();
      await expect(page.getByTestId(id)).toBeVisible();
      expect(await noOverflow(page), `${id} at ${width}px`).toBe(true);
      if (width === 360) {
        const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include(`[data-testid="${id}"]`).withTags(AXE_TAGS).analyze();
        expect(axe.violations, `${id}`).toEqual([]);
      }
      if (id === 'dneskai-costs') { await page.keyboard.press('Escape'); await expect(page.getByTestId(id)).toBeHidden(); }
    }
  }
  await page.getByRole('tab', { name: t.tabs.calendar, exact: true }).click();
  await expect(page.getByTestId('dneskai-calendar-day')).toHaveCount(7);
  await page.getByRole('tab', { name: t.tabs.published, exact: true }).click();
  const posts = page.getByTestId('dneskai-published');
  await expect(posts.getByRole('link', { name: new RegExp(`^${t.published.open}`) })).toHaveAttribute('href', /^https:\/\//);
  // Příspěvky lists every post; the chips narrow it by state.
  const filters = posts.getByTestId('dneskai-post-filters');
  await expect(filters.getByRole('button')).toHaveCount(5);
  await filters.getByRole('button', { name: new RegExp(`^${t.published.filters.published}`) }).click();
  await expect(posts.getByTestId('dneskai-post-row')).toHaveCount(1);
  await filters.getByRole('button', { name: new RegExp(`^${t.published.filters.waiting}`) }).click();
  await expect(posts.getByTestId('dneskai-post-row').first()).toHaveAttribute('data-state', /preparing|review|returned/);
  await openTab(page, 'cs', 'costs');
  await expect(page.getByRole('dialog', { name: t.more.costs })).toBeVisible();
  await expect(page.getByTestId('dneskai-costs').getByText(t.costs.budget)).toBeVisible();
  await expect(page.getByTestId('dneskai-costs').getByText('Denní limit generování DNESKAi je vyčerpaný.').first()).toBeVisible();
  // cost-16: booked failed-job cost has its own column; unread provider balances say so instead of showing a number.
  await expect(page.getByTestId('dneskai-costs').getByRole('columnheader', { name: t.costs.booked, exact: true })).toBeVisible();
  await expect(page.getByTestId('dneskai-balances').getByText(t.costs.balanceUnknown, { exact: true })).toHaveCount(2);
  expect(errors).toEqual([]);
});
