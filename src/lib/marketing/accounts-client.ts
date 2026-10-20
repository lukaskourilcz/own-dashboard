import { z } from 'zod';

/** Browser-safe view of a connected marketing account. It never carries a token. */
const timestamp = z.string().min(1).max(64);
export const MarketingAccountStatusSchema = z.strictObject({
  id: z.uuid(), brand: z.enum(['dneskai', 'devshark']), platform: z.enum(['instagram', 'threads']), handle: z.string().min(1).max(100),
  verifiedAt: timestamp.nullable(), enabled: z.boolean(),
  token: z.strictObject({ expiresAt: timestamp, refreshedAt: timestamp, scopes: z.array(z.string().max(64)).max(20), loginMode: z.enum(['instagram', 'facebook', 'threads']) }).nullable(),
});
export type MarketingAccountStatus = z.infer<typeof MarketingAccountStatusSchema>;
export const MarketingAccountsResponseSchema = z.strictObject({ accounts: z.array(MarketingAccountStatusSchema).max(4) });
export const MarketingAccountVerifyResponseSchema = z.strictObject({ account: MarketingAccountStatusSchema, accountType: z.string().max(40), tokenStored: z.boolean() });
export type MarketingAccountVerifyResponse = z.infer<typeof MarketingAccountVerifyResponseSchema>;

/** The UI warns ten days before expiry, the same window in which the #120 scheduler refreshes. */
export const TOKEN_WARNING_MS = 10 * 24 * 60 * 60 * 1000;
export type TokenState = 'missing' | 'expired' | 'expiring' | 'valid';
export function marketingTokenState(token: MarketingAccountStatus['token'], now: Date): TokenState {
  if (!token) return 'missing';
  const expires = Date.parse(token.expiresAt);
  if (!Number.isFinite(expires) || expires <= now.getTime()) return 'expired';
  return expires - now.getTime() < TOKEN_WARNING_MS ? 'expiring' : 'valid';
}

export class MarketingAccountRequestError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'MarketingAccountRequestError'; }
}
async function errorCode(response: Response): Promise<string> {
  try { const body = await response.json() as { error?: unknown }; return typeof body.error === 'string' && /^[a-z0-9-]{1,80}$/.test(body.error) ? body.error : 'account-request-failed'; }
  catch { return 'account-request-failed'; }
}
export async function loadMarketingAccounts(signal?: AbortSignal) {
  const response = await fetch('/api/marketing/accounts', { cache: 'no-store', signal });
  if (!response.ok) throw new MarketingAccountRequestError(await errorCode(response));
  return MarketingAccountsResponseSchema.parse(await response.json()).accounts;
}
export async function verifyMarketingAccount(brand: 'dneskai', platform: 'instagram'): Promise<MarketingAccountVerifyResponse> {
  const response = await fetch('/api/marketing/accounts/verify', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brand, platform }) });
  if (!response.ok) throw new MarketingAccountRequestError(response.status === 429 ? 'rate-limited' : await errorCode(response));
  return MarketingAccountVerifyResponseSchema.parse(await response.json());
}
