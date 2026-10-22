import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';
import { dneskaiLab } from '../src/lib/i18n/sections/dneskai-lab';

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The DNESKAi workspace (#119) in the deterministic preview: in-memory demo posts, nothing reaches a server. */
async function openWorkspace(page: Page, lang: 'en' | 'cs', tab: keyof typeof dneskaiWorkspace.en.tabs, theme: 'light' | 'dark' = 'light') {
  const requests: string[] = [];
  page.on('request', (request) => { if (/\/api\/marketing\/(dneskai|revisions|accounts)/.test(request.url())) requests.push(request.url()); });
  await gotoPreview(page, { lang, theme });
  await page.goto('/dev-preview?project=dneskai');
  await openTab(page, lang, tab);
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

for (const lang of ['cs', 'en'] as const) {
  test(`For review today opens the Instagram Lab behind a channel control, read-only and accessible (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page);
    const t = dneskaiWorkspace[lang];
    const c = dneskaiLab[lang].channels;
    await page.goto('/dev-preview?project=devshark');
    expect(await page.getByRole('tab', { name: t.tabs.review, exact: true }).count()).toBe(0);
    const requests = await openWorkspace(page, lang, 'review', lang === 'cs' ? 'dark' : 'light');
    const review = page.getByTestId('dneskai-review');
    // #170: Instagram is the one channel with an account; Threads and LinkedIn are announced as disabled, with why.
    const channels = review.getByRole('group', { name: c.label });
    await expect(channels.getByRole('button', { name: c.instagram })).toHaveAttribute('aria-pressed', 'true');
    for (const name of [c.threads, c.linkedin]) {
      const channel = channels.getByRole('button', { name: new RegExp(`^${name}`) });
      await expect(channel).toHaveAttribute('aria-disabled', 'true');
      await expect(channel).toHaveAccessibleDescription(c.notConnected);
    }
    await channels.getByRole('button', { name: new RegExp(`^${c.threads}`) }).focus();
    await expect(page.getByRole('tooltip')).toContainText(c.notConnected);
    await expect(review.getByTestId('dneskai-lab')).toBeVisible();
    await expect(review.getByRole('button', { name: lang === 'cs' ? 'Seznam' : 'List', exact: true })).toHaveCount(0);
    await expect(review.getByText(t.preview)).toBeVisible();
    expect(requests).toEqual([]);
    expect(await noOverflow(page)).toBe(true);
    const axe = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-review"]').withTags(AXE_TAGS).analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`dneskai-review-${lang}.png`), fullPage: true });
    // #173: Posts cards carry their state as a tint, named in the card; axe checks text contrast on every tint.
    await page.getByRole('tab', { name: t.tabs.published, exact: true }).click();
    const cards = page.getByTestId('dneskai-post-row');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByTestId('dneskai-published').locator('.rounded-full')).toHaveCount(0);
    await expect(page.locator('[data-testid="dneskai-post-row"][data-state="published"]')).toHaveAttribute('aria-label', new RegExp(`: ${t.states.published}$`));
    const posts = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="dneskai-published"]').withTags(AXE_TAGS).analyze();
    expect(posts.violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`dneskai-posts-${lang}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

/** The title of the post open in the Lab, read from its current queue card. */
async function openTitle(page: Page) {
  return (await page.locator('[data-testid="dneskai-lab-queue-post"][aria-current="true"] .font-medium').textContent())!;
}

test('approving in the Lab schedules the exact version, and Calendar and Posts show it as scheduled', async ({ page }) => {
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.cs;
  await openWorkspace(page, 'cs', 'review');
  const title = await openTitle(page);
  const approve = page.getByTestId('dneskai-lab-approve');
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText('Schváleno. Naplánováno');
  await page.getByRole('tab', { name: t.tabs.calendar, exact: true }).click();
  const entry = page.getByTestId('dneskai-calendar').locator('li', { hasText: title });
  await expect(entry.getByText(t.states.scheduled, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: t.tabs.published, exact: true }).click();
  await expect(page.getByTestId('dneskai-post-row').filter({ hasText: title })).toHaveAttribute('data-state', 'scheduled');
  expect(errors).toEqual([]);
});

test('returning a post from the Lab needs a note, and Posts shows it as returned', async ({ page }) => {
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.cs, l = dneskaiLab.cs;
  await openWorkspace(page, 'cs', 'review');
  const title = await openTitle(page);
  await page.getByTestId('dneskai-lab').getByRole('button', { name: l.actions.return, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const send = dialog.getByRole('button', { name: l.actions.sendReturn, exact: true });
  await expect(send).toBeDisabled();
  await dialog.getByLabel(l.actions.note, { exact: true }).fill('Zkraťte titulek na jednu větu.');
  await send.click();
  await expect(page.getByTestId('dneskai-lab-session')).toContainText(l.actions.returned);
  await page.getByRole('tab', { name: t.tabs.published, exact: true }).click();
  await expect(page.getByTestId('dneskai-post-row').filter({ hasText: title })).toHaveAttribute('data-state', 'returned');
  expect(errors).toEqual([]);
});

test('a version whose slides never attached reads as an error in Errors and costs and in Posts', async ({ page }) => {
  const errors = watchConsole(page);
  const t = dneskaiWorkspace.cs;
  await openWorkspace(page, 'cs', 'costs');
  // Errors and costs lists every post for review that cannot be approved, with what happened.
  const blocked = page.getByTestId('dneskai-blocked-posts');
  await expect(blocked.locator('li', { hasText: 'Co stojí jeden dotaz' }).getByText(/slidy se k ní nepřipojily/)).toBeVisible();
  await expect(blocked.locator('li', { hasText: 'Proč verzovat prompty' })).toBeVisible();
  await expect(blocked.locator('li', { hasText: 'Lokální model na notebooku' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: t.tabs.published, exact: true }).click();
  const posts = page.getByTestId('dneskai-published');
  await posts.getByTestId('dneskai-post-filters').getByRole('button', { name: new RegExp(`^${t.published.filters.problems}`) }).click();
  const stuck = posts.getByTestId('dneskai-post-row').filter({ hasText: 'Co stojí jeden dotaz' });
  await expect(stuck).toHaveAttribute('data-state', 'problem');
  await expect(stuck.getByText(/slidy se k ní nepřipojily/)).toBeVisible();
  // A version saved moments ago is still on its way.
  await posts.getByTestId('dneskai-post-filters').getByRole('button', { name: new RegExp(`^${t.published.filters.all}`) }).click();
  await expect(posts.getByTestId('dneskai-post-row').filter({ hasText: 'Lokální model na notebooku' })).toHaveAttribute('data-state', 'preparing');
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
