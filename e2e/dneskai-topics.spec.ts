import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';
import { nav } from '../src/lib/i18n/sections/nav';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];

/** Náměty as its own section (owner request, 9 November 2026) on the /dev-preview fixture: no API call. */
for (const lang of ['en', 'cs'] as const) test(`Náměty section: groups, series, keyword, archive and decisions (${lang})`, async ({ page }, info) => {
  const errors = watchConsole(page), t = dneskaiLab[lang].topics;
  const calls: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/marketing/')) calls.push(request.url()); });
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.goto('/dev-preview?tab=topics');
  const panel = page.getByTestId('dneskai-topics-panel');
  await expect(page.getByRole('heading', { level: 1, name: nav[lang].sections.topics }).first()).toBeVisible();
  const topics = panel.getByTestId('dneskai-topics');
  await expect(topics.getByText(t.intro)).toBeVisible();
  await expect(topics.getByRole('list', { name: t.listLabel(t.groups.news) })).toBeVisible();
  await expect(topics.getByRole('list', { name: t.listLabel(t.groups.education) })).toBeVisible();
  await expect(topics.getByText(t.series.explainer)).toBeVisible();
  await expect(topics.getByRole('button', { name: t.keyword.edit('PRIKAZY') })).toBeVisible();
  await expect(topics.getByTestId('dneskai-topics-paused')).toHaveText(t.paused);

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  const scan = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-topics-panel"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
  await page.screenshot({ path: `test-results/dneskai-topics-${lang}-${info.project.name}.png`, fullPage: true });

  // Approve one, reject one, then restore one from the rejected and expired list.
  await topics.getByTestId('dneskai-topic-approve').first().click();
  await expect(topics.getByRole('status')).toHaveText(t.done.approve(1));
  await expect(topics).toHaveAttribute('aria-busy', 'false');
  await topics.getByTestId('dneskai-topic-reject').first().click();
  await expect(topics.getByRole('status')).toHaveText(t.done.reject(1));
  await expect(topics).toHaveAttribute('aria-busy', 'false');
  const archive = topics.getByTestId('dneskai-topics-archive');
  await archive.locator('summary').click();
  await archive.getByRole('button', { name: t.restore }).first().click();
  await expect(topics.getByRole('status')).toHaveText(t.done.restore(1));

  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('Náměty opens from the command palette and the sidebar', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'The sidebar and the palette shortcut are desktop surfaces.');
  await gotoPreview(page);
  await page.goto('/dev-preview');
  await page.keyboard.press('Control+k');
  const input = page.getByPlaceholder('Type a command or search…');
  await input.fill('náměty');
  await page.getByRole('dialog').getByRole('button', { name: nav.en.sections.topics, exact: true }).click();
  await expect(page.getByTestId('dneskai-topics-panel').getByTestId('dneskai-topics')).toBeVisible();
  await page.goto('/dev-preview');
  await page.locator('aside').getByRole('button', { name: nav.en.sections.topics, exact: true }).click();
  await expect(page.getByTestId('dneskai-topics-panel').getByTestId('dneskai-topics')).toBeVisible();
});
