import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, stubGithubRepositories, watchConsole } from './helpers';
import { owner, task } from './task-fixtures';
import { todos } from '../src/lib/i18n/sections/todos';
import { common } from '../src/lib/i18n/sections/common';
import { nav } from '../src/lib/i18n/sections/nav';
const repo = { id: 123, name: 'fixture', full_name: 'owner/fixture', owner: 'owner', description: null, private: true, fork: false, archived: false, html_url: 'https://github.com/owner/fixture', default_branch: 'main', language: null, stargazers_count: 0, pushed_at: null, updated_at: null };
for (const lang of ['en', 'cs'] as const) test(`${lang}: repository cleanup retains failures and confirmed conflicts, then refresh protects a pending exit`, async ({ page }) => {
 test.setTimeout(60_000);
 const errors = watchConsole(page), t = todos[lang], c = common[lang];
 await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
 const manual = task('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TEST_ONLY independent task');
 const done = { ...task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TEST_ONLY finished source'), done: true, source: 'github', repo_id: '123', repo_owner: 'owner', repo_name: 'fixture', repo_full_name: 'owner/fixture', needed_raw: '- [ ] TEST_ONLY finished source', generated_at: '2026-10-25T00:00:00Z' };
 let rows = [manual, done], source = done.needed_raw, commits = 0, consumptions = 0, focus = 0;
 await stubGithubRepositories(page, [repo]);
 const project = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', user_id: owner, name: 'TEST_ONLY fixture project', slug: 'test-fixture', repo_id: 123, repo_full_name: 'owner/fixture', previous_repo_full_names: [], sort_order: 0, is_active: true, engagement: 'own', parent_id: null, notes: '', url: null, dev_url: null, color: null, created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00.000001Z' };
 await page.route('**/rest/v1/rpc/read_owned_collection', route => { const entity = route.request().postDataJSON().p_entity; expect(['todos', 'projects']).toContain(entity); return route.fulfill({ json: entity === 'projects' ? [project] : rows }); });
 await page.route('**/api/github/needed', route => route.fulfill({ json: { kind: 'ok', files: [{ repoId: '123', result: { kind: 'ok', path: 'NEEDED.md', content: source, sha: 'a'.repeat(40), htmlUrl: 'https://github.com/owner/fixture/blob/main/NEEDED.md' } }] } }));
 await page.route('**/api/github/commit', route => {
  commits++; const input = route.request().postDataJSON(); expect(input.expectedRepositoryId).toBe(123); expect(input.expectedSha).toBe('a'.repeat(40)); expect(input.content).not.toContain(done.needed_raw);
  if (commits === 1) return route.fulfill({ status: 503, json: { error: 'TEST_ONLY_PRIVATE' } });
  source = input.content; return route.fulfill({ json: { path: 'NEEDED.md', updated: true, unchanged: false, commit: { sha: 'b'.repeat(40), html_url: 'https://github.com/owner/fixture/commit/' + 'b'.repeat(40) }, content: { sha: 'c'.repeat(40), html_url: 'https://github.com/owner/fixture/blob/main/NEEDED.md' } } });
 });
 await page.route('**/rest/v1/rpc/consume_repository_records', route => {
  consumptions++; expect(route.request().postDataJSON()).toEqual({ p_entity: 'todos', p_rows: [done] });
  if (consumptions === 1) return route.fulfill({ json: { deleted_ids: [], retained_ids: [done.id] } });
  rows = [manual]; return route.fulfill({ json: { deleted_ids: [done.id], retained_ids: [] } });
 });
 await page.route('**/api/daily-focus', route => { focus++; return route.fulfill({ status: 503, json: { error: 'TEST_ONLY_PRIVATE' } }); });
 await page.goto('/dev-preview?tab=tasks&tasks=live&projectRecords=live');
 await expect(page.getByRole('button', { name: new RegExp(t.finishedTitle) })).toBeVisible(); await page.getByRole('button', { name: new RegExp(t.finishedTitle) }).click(); await expect(page.getByText(done.title, { exact: true })).toBeVisible();
 const cleanup = page.getByRole('button', { name: t.clearFromNeeded, exact: true });
 await cleanup.click(); let confirmation = page.getByRole('dialog', { name: t.clearFromNeeded, exact: true });
 await expect(page.getByRole('button', { name: t.clearingFromNeeded, exact: true, includeHidden: true })).toBeDisabled();
 expect(commits).toBe(0); await confirmation.getByRole('button', { name: c.cancel, exact: true }).click(); expect(commits).toBe(0); await expect(cleanup).toBeEnabled();
 for (let attempt = 0; attempt < 2; attempt++) {
  await cleanup.click(); confirmation = page.getByRole('dialog', { name: t.clearFromNeeded, exact: true }); await confirmation.getByRole('button', { name: c.delete, exact: true }).click();
  await expect(cleanup).toBeEnabled(); await expect(page.getByText(done.title, { exact: true })).toBeVisible(); await expect(page.getByText(t.clearFromNeededIncomplete(1), { exact: true }).last()).toBeVisible();
 }
 expect(commits).toBe(2); expect(consumptions).toBe(1); await expect(page.getByText('TEST_ONLY_PRIVATE', { exact: true })).toHaveCount(0);
 await cleanup.click(); await page.getByRole('dialog', { name: t.clearFromNeeded, exact: true }).getByRole('button', { name: c.delete, exact: true }).click();
 await expect(page.getByText(done.title, { exact: true })).toHaveCount(0); expect(commits).toBe(2); expect(consumptions).toBe(2); await expect(page.getByRole('checkbox', { name: manual.title, exact: true })).toBeVisible();
 let release!: () => void, requested = false;
 await page.route('**/api/github/repos', async route => { requested = true; await new Promise<void>(resolve => { release = resolve; }); return route.fulfill({ json: { repos: [repo], hasMore: false } }); });
 const refresh = page.getByRole('button', { name: t.refresh, exact: true }); await refresh.click(); await expect.poll(() => requested).toBe(true); await page.getByRole('button', { name: t.refreshing, exact: true }).dispatchEvent('click');
 // The same shell guard handles destination exits while repository work is pending.
 await page.getByRole('button', { name: nav[lang].sections.home, exact: true }).first().click();
 const guard = page.getByRole('dialog', { name: c.unsaved.pendingTitle, exact: true }); await expect(guard).toBeVisible(); await expect(guard.getByRole('button', { name: c.unsaved.discard, exact: true })).toBeDisabled(); await guard.getByRole('button', { name: c.unsaved.stay, exact: true }).click();
 release(); await expect(refresh).toBeEnabled(); await expect(page.getByText(t.dailyFocusRefreshErr, { exact: true })).toBeVisible(); expect(focus).toBe(1); expect(owner).toBe(manual.user_id);
 for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
 expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
 expect(errors.filter(error => !/^Failed to load resource: the server responded with a status of 503 .*\(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api\/(?:github\/commit|daily-focus)\)$/.test(error))).toEqual([]);
});
