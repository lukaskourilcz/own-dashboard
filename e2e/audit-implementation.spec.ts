import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { common } from '../src/lib/i18n/sections/common';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
import { dneskaiSourceList } from '../src/lib/i18n/sections/dneskai-source-list';
import { dneskaiDailyMix } from '../src/lib/i18n/sections/dneskai-daily-mix';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
import { nav } from '../src/lib/i18n/sections/nav';

async function open(page: Page, name: string) {
  const mobile = await page.getByTestId('mobile-nav').isVisible();
  if (!mobile) { await page.locator('aside').getByRole('button', { name, exact: true }).click(); return; }
  const primary = page.getByTestId('mobile-nav').getByRole('button', { name, exact: true });
  if (await primary.count()) { await primary.click(); return; }
  await page.getByTestId('mobile-nav').getByRole('button', { name: /^(More|Více)$/ }).click();
  await page.getByRole('dialog').getByRole('button', { name, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000);
  await page.route('**/api/vercel/analytics?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"kind":"unconfigured"}' }));
});

for (const lang of ['en', 'cs'] as const) test(`dirty draft survives tab cancellation and saves before leaving (${lang})`, async ({ page }) => {
  const t = dneskaiLab[lang], guard = common[lang].unsaved;
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const headline = page.getByTestId('dneskai-slide-inspector').getByRole('textbox', { name: t.slide.fields.headline, exact: true });
  await headline.fill('Krátký ověřený titulek');
  await expect(page.getByTestId('dneskai-fit-summary')).toContainText(t.slide.fitSummaryOk(1));
  const sources = page.getByRole('tab', { name: lang === 'cs' ? 'Zdroje (DNESKAi)' : 'Sources (DNESKAi)', exact: true });
  await sources.click();
  const dialog = page.getByRole('dialog', { name: guard.title });
  await dialog.getByRole('button', { name: guard.stay, exact: true }).click();
  await expect(headline).toHaveValue('Krátký ověřený titulek');
  await sources.click();
  await expect(dialog.getByRole('button', { name: guard.save, exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: guard.save, exact: true }).click();
  await expect(page.getByTestId('dneskai-source-list')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('command palette traps focus, includes Competition and restores its opener', async ({ page }, info) => {
  await gotoPreview(page);
  const opener = info.project.name === 'mobile' ? page.getByTestId('mobile-nav').getByRole('button', { name: 'More', exact: true }) : page.locator('.mac-toolbar button[aria-label]').last();
  await opener.focus();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Competition', exact: true })).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  if (info.project.name === 'mobile') {
    await opener.click(); await page.keyboard.press('Escape'); await expect(opener).toBeFocused();
  }
});

test('source settings navigate directly without mounting the other libraries', async ({ page }) => {
  await gotoPreview(page);
  await page.goto('/dev-preview?project=dneskai&projectTab=sources');
  await expect(page.getByTestId('dneskai-source-list')).toBeVisible();
  await expect(page.getByTestId('dneskai-daily-mix')).toHaveCount(0);
  await expect(page.getByTestId('dneskai-audio-library')).toHaveCount(0);
  await page.getByRole('tab', { name: dneskaiAudio.en.title, exact: true }).click();
  await expect(page.getByTestId('dneskai-audio-library')).toBeVisible();
  await expect(page.getByTestId('dneskai-source-list')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('tab', { name: dneskaiAudio.en.title, exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: dneskaiDailyMix.en.title, exact: true }).click();
  await expect(page.getByTestId('dneskai-daily-mix')).toBeVisible();
  await page.getByRole('tab', { name: dneskaiSourceList.en.title, exact: true }).click();
  await page.getByRole('searchbox', { name: dneskaiSourceList.en.search }).fill('mosseri');
  await expect(page.getByTestId('dneskai-source-row')).toHaveCount(1);
});

for (const width of [360, 430, 768, 1024, 1440, 1728]) test(`implemented destinations reflow and retain one title at ${width}px`, async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Run the width matrix once.');
  const lang = width === 430 || width === 1024 || width === 1440 || width === 1728 ? 'cs' : 'en';
  const theme = width === 430 || width === 1440 ? 'dark' : 'light';
  await page.setViewportSize({ width, height: 1000 });
  await gotoPreview(page, { lang, theme });
  const errors = watchConsole(page);
  for (const tab of ['home', 'work', 'marketing', 'workflows', 'projects', 'competition', 'opportunities', 'clients', 'career', 'invoices', 'money', 'settings', 'accounts', 'transactions', 'categories', 'subscriptions', 'tasks', 'calendar', 'goals', 'dates', 'notes', 'prompts', 'tools', 'links', 'ig-tips'] as const) {
    await open(page, nav[lang].sections[tab]);
    await expect(page.locator('.mac-toolbar h1')).toHaveText(nav[lang].sections[tab]);
    await expect(page.locator('h1:visible')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tab} at ${width}`).toBe(true);
    if (tab === 'settings') {
      const box = await page.locator('.settings-frame').boundingBox();
      expect(box!.width).toBeLessThanOrEqual(897);
    }
    if (tab === 'work') {
      const card = page.locator('[data-section="work"] .border-l-warning').first();
      expect((await card.boundingBox())!.height).toBeLessThan(600);
    }
    if (['work', 'settings', 'transactions', 'subscriptions', 'tasks', 'notes', 'prompts'].includes(tab)) await page.screenshot({ path: info.outputPath(`${tab}-${lang}-${theme}-${width}.png`) });
  }
  await open(page, nav[lang].sections.settings);
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('#main-content').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(errors).toEqual([]);
});

test('focused finance routes and on-demand creation preserve keyboard continuity', async ({ page }) => {
  await gotoPreview(page);
  await open(page, 'Transactions');
  await expect(page.getByTestId('finance-transactions').getByRole('searchbox')).toBeVisible();
  await expect(page.getByText('Net worth', { exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search transactions' }).fill('no-matching-synthetic-transaction');
  await expect(page.getByText('No transactions match these filters.')).toBeVisible();
  for (const [destination, action] of [['Accounts', 'Add account'], ['Subscriptions', 'Add subscription'], ['Goals', 'New plan'], ['Dates', 'Add a date'], ['Calendar', 'New calendar event']] as const) {
    await open(page, destination);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const button = page.getByRole('button', { name: action, exact: true });
    await button.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(button).toBeFocused();
  }
});

test('browser Back restores the dirty entry without adding history, then resumes the requested step', async ({ page }) => {
  await gotoPreview(page);
  await open(page, 'Projects');
  await page.locator('a[href="/projects/dneskai"]:visible').first().click();
  const field = page.getByTestId('dneskai-slide-inspector').getByRole('textbox', { name: dneskaiLab.en.slide.fields.headline, exact: true });
  await field.fill('Krátký ověřený titulek');
  await expect(page.getByTestId('dneskai-fit-summary')).toContainText(dneskaiLab.en.slide.fitSummaryOk(1));
  const length = await page.evaluate(() => history.length);
  await page.goBack();
  const dialog = page.getByRole('dialog', { name: common.en.unsaved.title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: common.en.unsaved.stay, exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/dneskai/);
  await expect(field).toHaveValue('Krátký ověřený titulek');
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack();
  await dialog.getByRole('button', { name: common.en.unsaved.discard, exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByTestId('dneskai-lab')).toHaveCount(0);
  await page.goForward();
  await expect(page.getByTestId('dneskai-lab')).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test('Notes keeps a failed document available for an unchanged retry', async ({ page }, info) => {
  await gotoPreview(page);
  const writes: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/notes?**', async route => {
    if (route.request().method() !== 'PATCH') { await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); return; }
    const doc = route.request().postDataJSON() as Record<string, unknown>;
    writes.push(doc);
    await route.fulfill(writes.length === 1 ? { status: 503, contentType: 'application/json', body: '{"message":"Synthetic transient save failure"}' }
      : { status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'n1', user_id: 'u1', title: 'Project ideas', content: [], plain_text: '', is_pinned: true, tags: ['work', 'ideas'], created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T10:00:00Z', ...doc }) });
  });
  await open(page, 'Notes');
  if (info.project.name === 'mobile') await page.getByRole('button', { name: /Project ideas/ }).click();
  const editor = page.locator('[contenteditable="true"]').first();
  await expect(editor).toBeVisible();
  await editor.fill('Retry this unchanged document');
  const retry = page.getByRole('button', { name: 'Retry save', exact: true });
  await expect(retry).toBeVisible();
  await expect(page.getByText('Could not save note.', { exact: true })).toBeVisible();
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toEqual(writes[0]);
});

for (const lang of ['en', 'cs'] as const) test(`DNESKAi implementation evidence (${lang})`, async ({ page }, info) => {
  const width = info.project.name === 'mobile' ? 360 : 1440;
  const theme = lang === 'cs' ? 'dark' : 'light';
  await page.setViewportSize({ width, height: 900 });
  await page.clock.setFixedTime(new Date('2026-10-23T12:00:00Z'));
  await gotoPreview(page, { lang, theme });
  await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
  const session = page.getByTestId('dneskai-lab-session'), topics = page.getByTestId('dneskai-topics');
  await expect(session).toBeVisible(); await expect(topics).toBeVisible();
  expect((await session.boundingBox())!.y).toBeLessThan((await topics.boundingBox())!.y);
  await page.screenshot({ path: info.outputPath(`dneskai-review-${lang}-${theme}-${width}.png`) });
  await page.getByRole('tab', { name: lang === 'cs' ? 'Zdroje (DNESKAi)' : 'Sources (DNESKAi)', exact: true }).click();
  for (const [name, panel, slug] of [[dneskaiSourceList[lang].title, 'dneskai-source-list', 'sources'], [dneskaiDailyMix[lang].title, 'dneskai-daily-mix', 'mix'], [dneskaiAudio[lang].title, 'dneskai-audio-library', 'music']] as const) {
    await page.getByRole('tab', { name, exact: true }).click();
    await expect(page.getByTestId(panel)).toBeVisible();
    if (width < 768) {
      for (const tab of await page.getByTestId('dneskai-source-settings').getByRole('tab').all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      if (slug === 'mix') for (const field of await page.getByTestId(panel).getByRole('combobox').all()) expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`dneskai-${slug}-${lang}-${theme}-${width}.png`) });
  }
});
