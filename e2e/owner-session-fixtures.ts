import { build } from 'esbuild';
import type { Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stubBackend } from './helpers';
export const sessionOwner = '11111111-1111-4111-8111-111111111111';
export const sessionOther = '22222222-2222-4222-8222-222222222222';
const user = (id: string) => ({ id, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T12:00:00Z' });
function syntheticSession(id: string) {
 const expires_at = Math.floor(Date.now() / 1000) + 3600;
 const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
 return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, aud: 'authenticated', role: 'authenticated', exp: expires_at })}.TEST-ONLY-SIGNATURE`, refresh_token: 'TEST-ONLY-REFRESH', token_type: 'bearer', expires_in: 3600, expires_at, user: user(id) };
}
declare global { interface Window { syntheticOwnerAuth: SupabaseClient['auth']; syntheticOwnerSignOut: () => Promise<void> } }
let bundle: Promise<string> | undefined;
/** Real installed SSR/auth SDK, shared browser cookies and BroadcastChannel;
 * only these two synthetic identities and a nonexistent backend are accepted. */
export async function ownerSessionPeer(peer: Page) {
 await stubBackend(peer); let actor = sessionOwner, verifications = 0, sdkLogouts = 0;
 await peer.route('**/auth/v1/user', route => {
  verifications++;
  const part = route.request().headers().authorization?.split('.')[1];
  const id = part ? JSON.parse(Buffer.from(part, 'base64url').toString()).sub : null;
  if (id !== sessionOwner && id !== sessionOther) throw new Error('Non-synthetic identity refused');
  return route.fulfill({ json: user(id) });
 });
 await peer.route('**/auth/v1/token?grant_type=refresh_token', route => route.fulfill({ json: syntheticSession(actor) }));
 await peer.route('**/auth/v1/logout**', route => { sdkLogouts++; return route.fulfill({ status: 204 }); });
 await peer.goto('/robots.txt');
 bundle ??= build({ stdin: { contents: "import {requestSignOut} from './src/lib/auth-actions'; window.syntheticOwnerSignOut=requestSignOut; import {createBrowserClient} from '@supabase/ssr'; window.syntheticOwnerAuth=createBrowserClient('https://example.supabase.co','preview-anon-key',{isSingleton:false,auth:{autoRefreshToken:false,detectSessionInUrl:false}}).auth;", resolveDir: process.cwd(), sourcefile: 'synthetic-auth-peer.ts' }, bundle: true, platform: 'browser', format: 'iife', write: false }).then(result => result.outputFiles[0].text);
 await peer.addScriptTag({ content: await bundle });
 return {
  counts: () => ({ verifications, sdkLogouts }),
  signIn: async (id: typeof sessionOwner | typeof sessionOther = sessionOwner) => {
   actor = id;
   const verified = await peer.evaluate(async ({ session, id }) => {
    const result = await window.syntheticOwnerAuth.setSession(session); if (result.error) return false;
    const check = await window.syntheticOwnerAuth.getUser(); return !check.error && check.data.user?.id === id;
   }, { session: syntheticSession(id), id });
   if (!verified) throw new Error('Synthetic owner verification failed');
  },
  httpSignOut: () => peer.evaluate(() => window.syntheticOwnerSignOut()),
  refresh: async () => { if (!await peer.evaluate(async () => !(await window.syntheticOwnerAuth.refreshSession({ refresh_token: 'TEST-ONLY-REFRESH' })).error)) throw new Error('Synthetic refresh failed'); },
  signOut: async () => { if (!await peer.evaluate(async () => !(await window.syntheticOwnerAuth.signOut({ scope: 'local' })).error)) throw new Error('Synthetic sign-out failed'); },
 };
}
