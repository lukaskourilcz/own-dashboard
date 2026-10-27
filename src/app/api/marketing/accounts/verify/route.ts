import { z } from 'zod';
import { readVerifiedServerOwner } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { MarketingAccountVerificationError, verifyInstagramAccount } from '@/lib/marketing/meta-account';
import type { MarketingAccountVerifyResponse } from '@/lib/marketing/accounts-client';

/**
 * POST /api/marketing/accounts/verify (#121): the owner checks the Instagram
 * account with the valid token that expires later (stored or bootstrap) and
 * records it; a new account starts with enabled=false. Only
 * the configured marketing owner may bind the deployment's token. Responses
 * carry codes and non-secret metadata, never the token or Meta's error text.
 */
export const runtime = 'nodejs';
export const maxDuration = 30;
const Input = z.strictObject({ brand: z.literal('dneskai'), platform: z.literal('instagram') });
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
  let ownerId: string | null;
  try { ownerId = await readVerifiedServerOwner(signal); }
  catch { return Response.json({error:'account-verification-unavailable'},{status:503}); }
  if (!ownerId) return Response.json({error:'unauthorized'},{status:401});
  let limited: Awaited<ReturnType<typeof rateLimit>>;
  try { limited = await awaitWithSignal(rateLimit(ownerId, { key: 'marketing-account-verify', limit: 5, windowSec: 600 }),signal); signal.throwIfAborted(); }
  catch { return Response.json({error:'account-verification-unavailable'},{status:503}); }
  if (!limited.ok) return Response.json({error:'rate-limited'},{status:429,headers:{'Retry-After':String(limited.retryAfter)}});
  if (!process.env.MARKETING_OWNER_ID || process.env.MARKETING_OWNER_ID !== ownerId) return Response.json({ error: 'marketing-owner-required' }, { status: 403 });
  let input: z.infer<typeof Input>;
  try { const raw = await request.text(); if (raw.length > 1000) throw new Error('too-large'); input = Input.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  if (signal.aborted) return Response.json({error:'account-verification-unavailable'},{status:503});
  try {
    const verified = await verifyInstagramAccount(createAdminClient(signal), ownerId, input.brand, { signal });
    const body: MarketingAccountVerifyResponse = { accountType: verified.accountType, tokenStored: verified.tokenStored, ...(verified.page ? { page: verified.page } : {}),
      account: { id: verified.accountId, brand: verified.brand, platform: verified.platform, handle: verified.handle, verifiedAt: verified.verifiedAt, enabled: verified.enabled, token: verified.token } };
    return Response.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof MarketingAccountVerificationError) return Response.json({ error: error.code }, { status: error.status, headers: { 'Cache-Control': 'private, no-store' } });
    return Response.json({ error: 'account-verification-unavailable' }, { status: 503 });
  }
}
