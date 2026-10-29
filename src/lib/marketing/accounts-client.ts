import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';
import { databaseTimestamp,databaseVersion } from '@/lib/database-version';
import {confirmMarketingAccountControl,MarketingAccountControlSchema,MarketingAccountSwitchSchema,type MarketingAccountControl,type MarketingAccountSwitch} from './account-control-contracts';

/** Browser-safe view of a connected marketing account. It never carries a token. */
const timestamp = databaseTimestamp;
export const MarketingAccountStatusSchema = z.strictObject({
  id: z.uuid(), brand: z.enum(['dneskai', 'devshark']), platform: z.enum(['instagram', 'threads']), handle: z.string().min(1).max(100),
  verifiedAt: timestamp.nullable(), enabled: z.boolean(), updatedAt:timestamp.optional(),
  token: z.strictObject({ expiresAt: timestamp, refreshedAt: timestamp, scopes: z.array(z.string().min(1).max(64)).max(20).refine(values=>new Set(values).size===values.length), loginMode: z.enum(['instagram', 'facebook', 'threads']) }).nullable(),
  /**
   * #160: replies to keyword comments for this account. Present only while the server runs the comment watcher
   * (DNESKAI_ENGAGEMENT_ENABLED); `blockedCode` says why replies stopped, such as messaging switched off.
   */
  engagement: z.strictObject({ enabled: z.boolean(), blockedCode: z.string().regex(/^[a-z0-9-]{1,100}$/).nullable(), blockedAt: timestamp.nullable(),
    /** #161: the comment webhook is configured on the server, so the panel offers the subscription. Absent: not. */
    webhook: z.boolean().optional() }).optional(),
});
export type MarketingAccountStatus = z.infer<typeof MarketingAccountStatusSchema>;
export const MarketingAccountsResponseSchema = z.strictObject({ accounts: z.array(MarketingAccountStatusSchema).max(4).refine(rows=>new Set(rows.map(row=>row.id)).size===rows.length && new Set(rows.map(row=>`${row.brand}/${row.platform}`)).size===rows.length) });
/** `page` (#166): the Facebook Page @dneskai is linked to, under Facebook Login only. */
export const MarketingAccountVerifyResponseSchema = z.strictObject({ account: MarketingAccountStatusSchema, accountType: z.string().max(40), tokenStored: z.boolean(),
  page: z.strictObject({ id: z.string().regex(/^\d{1,100}$/), name: z.string().max(200) }).optional() });
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
/** One observed consumer scope, bounded JSON and no automatic request replay. */
async function accountRequest<T>(path: string, body: unknown | undefined, parent: AbortSignal | undefined, milliseconds: number, validate: (value: unknown) => T): Promise<T> {
  const signal = AbortSignal.any([AbortSignal.timeout(milliseconds), ...(parent ? [parent] : [])]);
  const discard = (response: Response) => { if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
  let response: Response | undefined;
  try {
    signal.throwIfAborted();
    const pending = fetch(path, {cache:'no-store',redirect:'error',signal,...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    void pending.then(result=>{if(signal.aborted)discard(result);},()=>undefined);
    response = await awaitWithSignal(pending,signal);
    signal.throwIfAborted();
    if (response.status === 429) { discard(response); throw new MarketingAccountRequestError('rate-limited'); }
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new Error();
    const value: unknown = JSON.parse(await boundedResponseText(response,response.status===200?16384:4096,signal));
    if (response.status !== 200) {
      const refusal = z.strictObject({error:z.string().regex(/^[a-z0-9-]{1,80}$/)}).safeParse(value);
      throw new MarketingAccountRequestError(refusal.success?refusal.data.error:'account-request-failed');
    }
    const result = validate(value);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (response) discard(response);
    if (parent?.aborted) throw new DOMException('Request aborted','AbortError');
    throw error instanceof MarketingAccountRequestError ? error : new MarketingAccountRequestError('account-request-failed');
  }
}
function accountSelector(accountId: string) {
  if (!z.uuid().safeParse(accountId).success) throw new MarketingAccountRequestError('invalid-request');
}
export async function loadMarketingAccounts(signal?: AbortSignal) {
  return accountRequest('/api/marketing/accounts',undefined,signal,20000,value=>{const rows=MarketingAccountsResponseSchema.parse(value).accounts;if(rows.some(row=>!row.updatedAt))throw new Error();return rows;});
}
export async function verifyMarketingAccount(brand: 'dneskai', platform: 'instagram', signal?: AbortSignal): Promise<MarketingAccountVerifyResponse> {
  if (brand !== 'dneskai' || platform !== 'instagram') throw new MarketingAccountRequestError('invalid-request');
  return accountRequest('/api/marketing/accounts/verify',{brand,platform},signal,35000,value=>{
    const result = MarketingAccountVerifyResponseSchema.parse(value);
    if (result.account.brand !== brand || result.account.platform !== platform) throw new Error();
    return result;
  });
}
/** Whether Meta sends the account's comments, or the result of an explicit subscription request. */
export async function marketingCommentSubscription(accountId: string, action: 'status' | 'subscribe', signal?: AbortSignal): Promise<boolean> {
  accountSelector(accountId);
  if (!['status','subscribe'].includes(action)) throw new MarketingAccountRequestError('invalid-request');
  return accountRequest('/api/marketing/accounts/webhook',{accountId,action},signal,35000,value=>{
    const result = z.strictObject({subscribed:z.boolean()}).parse(value);
    if (action === 'subscribe' && !result.subscribed) throw new Error();
    return result.subscribed;
  });
}
/** Submit one captured account change without automatic replay. */
export async function submitMarketingAccountControl(input:MarketingAccountControl,kind:MarketingAccountSwitch,parent?:AbortSignal){
 const intent=MarketingAccountControlSchema.safeParse(input),control=MarketingAccountSwitchSchema.safeParse(kind);
 if(!intent.success||!control.success)throw new MarketingAccountRequestError('invalid-request');
 return accountRequest(control.data==='publishing'?'/api/marketing/accounts/enable':'/api/marketing/accounts/engagement',intent.data,parent,35000,value=>{
  const body=z.strictObject({receipt:z.unknown()}).parse(value);
  return confirmMarketingAccountControl(body.receipt,intent.data,control.data);
 });
}

/** Patch only the captured cached row after an exact saved receipt. */
export function applyMarketingAccountControlReceipt(
  rows: readonly MarketingAccountStatus[] | undefined,
  input: MarketingAccountControl,
  kind: MarketingAccountSwitch,
  value: unknown,
) {
  const receipt = confirmMarketingAccountControl(value, input, kind);
  if (receipt.kind !== 'saved' || !rows) return { accounts: rows, reconcile: true };
  const index = rows.findIndex(row => row.id === input.accountId);
  const current = rows[index];
  if (!current?.updatedAt || databaseVersion(current.updatedAt) !== databaseVersion(input.expectedVersion)) {
    return { accounts: rows, reconcile: true };
  }
  if (kind === 'engagement' && !current.engagement) return { accounts: rows, reconcile: true };
  const updated = MarketingAccountStatusSchema.parse({
    ...current,
    updatedAt: receipt.updatedAt,
    ...(kind === 'publishing' ? { enabled: input.enabled } : {
      engagement: { ...current.engagement, enabled: input.enabled,
        ...(input.enabled ? { blockedCode: null, blockedAt: null } : {}),
      },
    }),
  });
  const accounts = [...rows];
  accounts[index] = updated;
  return { accounts, reconcile: false };
}
