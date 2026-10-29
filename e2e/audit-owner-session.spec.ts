import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview } from './helpers';
import { ownerSessionPeer, sessionOwner, sessionOther } from './owner-session-fixtures';
import { common } from '../src/lib/i18n/sections/common';
import { portfolio } from '../src/lib/i18n/sections/portfolio';
const stamp = '2026-10-25T12:00:00Z';
const project = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: sessionOwner, name: 'Synthetic owner project', summary: '', slug: 'synthetic-owner-project', previous_slugs: [], repo_full_name: null, repo_id: null, previous_repo_full_names: [], engagement: 'client', portfolio_key: null, url: null, notes: '', color: null, sort_order: 0, is_active: true, created_at: stamp, updated_at: stamp, parent_id: null };
const record = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: sessionOwner, project_id: project.id, name: 'Synthetic private research', url: null, summary: 'Synthetic private cache', category: 'direct', useful_features: [], social_content: '', pricing_model: '', lessons: '', relevance_score: null, score_rationale: '', social_links: [], source_urls: [], reviewed_at: null, sort_order: 0, created_at: stamp, updated_at: stamp };
for (const lang of ['en', 'cs'] as const) for (const change of ['replacement', 'sign-out', 'http-sign-out', 'http-storage'] as const) test(`${lang}: actual SDK ${change} retires the private workspace and its dirty dialog`, async ({ page, context }) => {
 if (change === 'http-storage') await context.addInitScript(() => { Object.defineProperty(window, 'BroadcastChannel', { configurable: true, value: undefined }); });
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); let reads = 0, writes = 0, blockedRequests = 0, dialogs = 0;
 page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
 await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); const peer = await context.newPage(), auth = await ownerSessionPeer(peer); await auth.signIn();
 await page.route('**/rest/v1/rpc/read_owned_collection', route => { reads++; return route.fulfill({ json: route.request().postDataJSON().p_entity === 'projects' ? [project] : [record] }); });
 await page.route('**/rest/v1/competitors?*', route => { writes++; return route.fulfill({ status: 500 }); });
 await page.route('**/api/synthetic-owner-check', route => { blockedRequests++; return route.fulfill({ json: {} }); });
 await page.goto('/dev-preview?tab=competition&competitors=live&projectRecords=live&session=live');
 await page.getByRole('button', { name: `${portfolio[lang].editCompetitor}: ${record.name}`, exact: true }).click(); const editor = page.getByRole('dialog', { name: portfolio[lang].editCompetitor, exact: true }); await editor.locator('#competitor-name').fill('Retained same-owner draft'); const initialReads = reads;
 await auth.signIn(); await auth.refresh(); await expect(editor.locator('#competitor-name')).toHaveValue('Retained same-owner draft'); expect(reads).toBe(initialReads); expect(writes).toBe(0);
 if (change.startsWith('http-')) {
  const initialAuth = auth.counts();
  let receipts = 0;
  await peer.route('**/auth/signout', route => ++receipts === 1 ? route.fulfill({ status: 503, json: { ok: false } }) : route.fulfill({ json: { ok: true }, headers: { 'set-cookie': 'sb-example-auth-token=; Path=/; Max-Age=0; SameSite=Lax' } }));
  await expect(auth.httpSignOut()).rejects.toThrow('Sign-out unconfirmed'); await expect(editor.locator('#competitor-name')).toHaveValue('Retained same-owner draft');
  expect((await context.cookies()).some(cookie => cookie.name === 'sb-example-auth-token')).toBe(true);
  await auth.httpSignOut(); expect(receipts).toBe(2); expect(auth.counts()).toEqual(initialAuth); expect((await context.cookies()).some(cookie => cookie.name === 'sb-example-auth-token')).toBe(false);
 } else if (change === 'replacement') await auth.signIn(sessionOther); else await auth.signOut();
 await expect(page.getByRole('heading', { name: common[lang].sessionChanged, exact: true })).toBeVisible(); await expect(page.getByRole('main').getByRole('alert')).toHaveText(common[lang].sessionChangedDescription); await expect(editor).toHaveCount(0); await expect(page.getByText(record.name, { exact: true })).toHaveCount(0); await expect(page.locator('aside')).toHaveCount(0);
 const blocked = await page.evaluate(async () => { try { await fetch('/api/synthetic-owner-check'); return false; } catch (error) { return error instanceof DOMException && error.name === 'AbortError'; } }); expect(blocked).toBe(true); expect(blockedRequests).toBe(0); expect(writes).toBe(0); expect(dialogs).toBe(0);
 // A later same-owner client event cannot reopen or repopulate this retired scope.
 await auth.signIn(); await expect(page.getByRole('heading', { name: common[lang].sessionChanged, exact: true })).toBeVisible(); expect(reads).toBe(initialReads);
 for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
 expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
 const reloaded = page.waitForEvent('request', request => request.isNavigationRequest() && new URL(request.url()).pathname === '/dev-preview'); await page.getByRole('button', { name: common[lang].sessionReload, exact: true }).click(); await reloaded; await expect(page.getByRole('button', { name: /^Synthetic private research/ })).toBeVisible(); await expect(page.getByRole('heading', { name: common[lang].sessionChanged, exact: true })).toHaveCount(0); expect(reads).toBeGreaterThan(initialReads); expect(dialogs).toBe(0); expect(errors).toEqual([]); await peer.close();
});
