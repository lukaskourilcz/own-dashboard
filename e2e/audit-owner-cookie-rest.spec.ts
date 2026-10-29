import { build } from 'esbuild';
import { test, expect } from '@playwright/test';
import { gotoPreview } from './helpers';
import { ownerSessionPeer, sessionOwner, sessionOther } from './owner-session-fixtures';
import { common } from '../src/lib/i18n/sections/common';
import { portfolio } from '../src/lib/i18n/sections/portfolio';
declare global { interface Window { syntheticReadNotes: () => Promise<boolean> } }
const stamp = '2026-10-25T12:00:00Z';
const project = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: sessionOwner, name: 'Synthetic owner project', summary: '', slug: 'synthetic-owner-project', previous_slugs: [], repo_full_name: null, repo_id: null, previous_repo_full_names: [], engagement: 'client', portfolio_key: null, url: null, notes: '', color: null, sort_order: 0, is_active: true, created_at: stamp, updated_at: stamp, parent_id: null };
const record = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: sessionOwner, project_id: project.id, name: 'Synthetic private research', url: null, summary: 'Synthetic private cache', category: 'direct', useful_features: [], social_content: '', pricing_model: '', lessons: '', relevance_score: null, score_rationale: '', social_links: [], source_urls: [], reviewed_at: null, sort_order: 0, created_at: stamp, updated_at: stamp };
let bundle: Promise<string> | undefined;
for (const lang of ['en', 'cs'] as const) test(`${lang}: an HTTP cookie replacement cannot send a foreign SDK read from an older workspace`, async ({ page, context }) => {
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); let reads = 0, dialogs = 0;
 page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
 await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' }); const peer = await context.newPage(), auth = await ownerSessionPeer(peer); await auth.signIn();
 await page.route('**/rest/v1/rpc/read_owned_collection', route => route.fulfill({ json: route.request().postDataJSON().p_entity === 'projects' ? [project] : [record] }));
 await page.route('**/rest/v1/notes?*', route => { reads++; return route.fulfill({ json: [] }); });
 await page.goto('/dev-preview?tab=competition&competitors=live&projectRecords=live&session=live');
 await page.getByRole('button', { name: `${portfolio[lang].editCompetitor}: ${record.name}`, exact: true }).click(); const editor = page.getByRole('dialog', { name: portfolio[lang].editCompetitor, exact: true }); await editor.locator('#competitor-name').fill('Retained HTTP draft');
 bundle ??= build({ stdin: { contents: "import {createBrowserClient} from '@supabase/ssr'; const db=createBrowserClient('https://example.supabase.co','preview-anon-key',{isSingleton:false,auth:{autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(...args)=>window.fetch(...args)}}); window.syntheticReadNotes=async()=>{const result=await db.from('notes').select('id,title');return !result.error;};", resolveDir: process.cwd(), sourcefile: 'synthetic-rest-peer.ts' }, bundle: true, platform: 'browser', format: 'iife', write: false }).then(result => result.outputFiles[0].text);
 await page.addScriptTag({ content: await bundle }); const baselineAuth = auth.counts();
 await auth.httpSignIn(sessionOwner); expect(await page.evaluate(() => window.syntheticReadNotes())).toBe(true); expect(reads).toBe(1); await expect(editor.locator('#competitor-name')).toHaveValue('Retained HTTP draft');
 await auth.httpSignIn(sessionOther); await expect(editor.locator('#competitor-name')).toHaveValue('Retained HTTP draft');
 expect(await page.evaluate(() => window.syntheticReadNotes())).toBe(false);
 await expect(page.getByRole('heading', { name: common[lang].sessionChanged, exact: true })).toBeVisible(); await expect(editor).toHaveCount(0); expect(reads).toBe(1); expect(auth.counts()).toEqual(baselineAuth); expect(dialogs).toBe(0);
 await auth.signIn(); await expect(page.getByRole('heading', { name: common[lang].sessionChanged, exact: true })).toBeVisible(); expect(errors).toEqual([]); await peer.close();
});
