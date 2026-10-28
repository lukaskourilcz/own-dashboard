import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { awaitWithSignal } from '@/lib/abortable';
import { databaseTimestamp, databaseVersion } from '@/lib/database-version';
import { metaGraphResponse, MetaGraphRequestError } from './meta-graph-response';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { MarketingBrand } from './contracts';
import type { MetaPublisherConfig } from './publisher';

/**
 * Meta access-token resolution and refresh (#121).
 *
 * The stored token in `marketing_account_tokens` wins while it is unexpired.
 * `MARKETING_<BRAND>_<PLATFORM>_ACCESS_TOKEN` is only the bootstrap value the
 * owner installs once. Nothing here logs, returns or persists a token outside
 * the service-role functions, and no ambiguous request is retried.
 */
type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;
export type MetaPlatform = 'instagram' | 'threads';
export type MetaLoginMode = MetaPublisherConfig['loginMode'];
export type MetaCredentialAccount = { id: string; user_id: string; brand: MarketingBrand; platform: MetaPlatform };
export type StoredMetaToken = { accessToken: string; expiresAt: string; refreshedAt: string; scopes: string[]; loginMode: MetaLoginMode };
export type MetaTokenMetadata = { accountId: string; brand: MarketingBrand; platform: MetaPlatform; expiresAt: string; refreshedAt: string; scopes: string[]; loginMode: MetaLoginMode };
export type BootstrapMetaCredential = { accessToken: string; expiresAt: string; scopes: string[]; loginMode: MetaLoginMode | null };
export type ChosenMetaCredential =
  | { source: 'database' | 'environment'; accessToken: string; expiresAt: string; scopes: string[]; loginMode: MetaLoginMode; refreshedAt: string | null }
  | { hold: string };
export type InstagramTokenRefreshOutcome =
  | { status: 'refreshed'; accountId: string; expiresAt: string; refreshedAt: string }
  | { status: 'skipped' | 'held' | 'failed' | 'uncertain'; accountId: string; code: string };

export const INSTAGRAM_LOGIN_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'] as const;
/**
 * Facebook Login for Business (#166): what verification requires before it stores a token. The publisher needs the
 * first three; `pages_show_list` finds the Page linked to @dneskai. Comments and messages
 * (`instagram_manage_comments`, `instagram_manage_messages`) belong to the comment watcher and are not required here.
 */
export const FACEBOOK_LOGIN_SCOPES = ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement', 'pages_show_list'] as const;
/** Facebook Login's long-lived token exchange; it needs the Meta app's id and secret (server-only). */
export const FACEBOOK_TOKEN_ENDPOINT = 'https://graph.facebook.com';
/** Meta refreshes only a long-lived token that is at least 24 hours old and unexpired. */
export const INSTAGRAM_TOKEN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** The #120 scheduler refreshes a token once fewer than ten days remain. */
export const INSTAGRAM_TOKEN_REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
/** Long-lived Instagram User tokens last 60 days from issue or refresh. */
export const INSTAGRAM_LONG_LIVED_TOKEN_MS = 60 * 24 * 60 * 60 * 1000;
export const INSTAGRAM_REFRESH_ENDPOINT = 'https://graph.instagram.com/refresh_access_token';

const tokenValue = z.string().regex(/^\S{20,4096}$/);
const loginMode = z.enum(['instagram', 'facebook', 'threads']);
const scope = z.string().regex(/^[a-z_]{1,64}$/);
/** The token store accepts at most 20 scopes of this shape; checked before any write or refresh. */
export const META_SCOPE_LIMIT = 20;
export function metaScopesStorable(scopes: readonly string[]): boolean {
  return scopes.length <= META_SCOPE_LIMIT && new Set(scopes).size === scopes.length && scopes.every(value => scope.safeParse(value).success);
}
const storedScopes = z.array(scope).max(META_SCOPE_LIMIT).refine(values => new Set(values).size === values.length);
const StoredRowSchema = z.strictObject({ access_token: tokenValue, expires_at: databaseTimestamp, refreshed_at: databaseTimestamp, scopes: storedScopes, login_mode: loginMode });
const MetadataRowSchema = z.object({ account_id: z.uuid(), brand: z.enum(['dneskai', 'devshark']), platform: z.enum(['instagram', 'threads']), expires_at: databaseTimestamp, refreshed_at: databaseTimestamp, scopes: storedScopes, login_mode: loginMode });
const PrivateInstagramCapture = z.strictObject({ tokenHash: z.string().regex(/^[0-9a-f]{64}$/), expiresAt: databaseTimestamp,
  refreshedAt: databaseTimestamp, scopes: storedScopes, loginMode: z.enum(['instagram', 'facebook']) });
/** Server-private equality evidence; never include this value in a public receipt or diagnostic. */
export function captureStoredInstagramCredential(token: StoredMetaToken | null) {
  return token === null ? null : PrivateInstagramCapture.parse({ tokenHash: createHash('sha256').update(token.accessToken, 'utf8').digest('hex'),
    expiresAt: token.expiresAt, refreshedAt: token.refreshedAt, scopes: token.scopes, loginMode: token.loginMode });
}
const RefreshResponseSchema = z.object({ access_token: tokenValue, token_type: z.string().max(20).optional(), expires_in: z.number().int().positive().max(90 * 24 * 60 * 60) });

export class MetaCredentialError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'MetaCredentialError'; }
}

export function metaEnvironmentPrefix(brand: MarketingBrand, platform: MetaPlatform): string {
  return `MARKETING_${brand.toUpperCase()}_${platform.toUpperCase()}`;
}
const instant = (value: string | null | undefined): number => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : Number.NaN;
const envLoginMode = (platform: MetaPlatform, value: string | undefined): MetaLoginMode | null =>
  platform === 'threads' ? 'threads' : value === 'instagram' || value === 'facebook' ? value : null;

export function bootstrapMetaCredential(brand: MarketingBrand, platform: MetaPlatform, env: Environment = process.env): BootstrapMetaCredential {
  const prefix = metaEnvironmentPrefix(brand, platform);
  return { accessToken: env[`${prefix}_ACCESS_TOKEN`] ?? '', expiresAt: env[`${prefix}_TOKEN_EXPIRES_AT`] ?? '',
    scopes: (env[`${prefix}_VERIFIED_SCOPES`] ?? '').split(',').map(value => value.trim()).filter(Boolean),
    loginMode: envLoginMode(platform, env[`${prefix}_LOGIN_MODE`]) };
}

/** Environment-only publisher configuration: the bootstrap credential and the non-secret switches. */
export function metaConfiguration(brand: MarketingBrand, platform: MetaPlatform, env: Environment = process.env): MetaPublisherConfig {
  const prefix = metaEnvironmentPrefix(brand, platform);
  const bootstrap = bootstrapMetaCredential(brand, platform, env);
  if (!bootstrap.loginMode) throw new Error('meta-login-mode-required');
  return { enabled: env.MARKETING_PUBLISH_ENABLED === 'true' && env[`MARKETING_${brand.toUpperCase()}_PUBLISH_ENABLED`] === 'true',
    apiVersion: env[`${prefix}_API_VERSION`] ?? '', apiVersionVerifiedAt: env[`${prefix}_API_VERSION_VERIFIED_AT`] ?? '', loginMode: bootstrap.loginMode,
    accessToken: bootstrap.accessToken, tokenExpiresAt: bootstrap.expiresAt, scopes: bootstrap.scopes,
    approvedAssetHosts: (env.MARKETING_APPROVED_ASSET_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean), credentialSource: 'environment' };
}

/** Reads the stored token through the service-role function. A store error is never treated as "no token". */
export async function readStoredMetaToken(db: Database, owner: string, accountId: string, parent?: AbortSignal): Promise<StoredMetaToken | null> {
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
  if (!z.uuid().safeParse(owner).success || !z.uuid().safeParse(accountId).success) throw new MetaCredentialError('credential-store-unavailable');
  let response: { data: unknown; error: unknown };
  try { signal.throwIfAborted(); response = await awaitWithSignal(db.rpc('marketing_read_account_token', { p_owner: owner, p_account: accountId }).retry(false).abortSignal(signal), signal); signal.throwIfAborted(); }
  catch { throw new MetaCredentialError('credential-store-unavailable'); }
  if (response.error || !Array.isArray(response.data) || response.data.length > 1) throw new MetaCredentialError('credential-store-unavailable');
  if (!response.data.length) return null;
  const row = StoredRowSchema.safeParse(response.data[0]);
  if (!row.success) throw new MetaCredentialError('credential-store-unavailable');
  return { accessToken: row.data.access_token, expiresAt: row.data.expires_at, refreshedAt: row.data.refreshed_at, scopes: row.data.scopes, loginMode: row.data.login_mode };
}

/** Non-secret metadata for every stored token of one owner; the #120 scheduler filters it with instagramTokenRefreshDue. */
export async function listMetaTokenMetadata(db: Database, owner: string): Promise<MetaTokenMetadata[]> {
  if (!z.uuid().safeParse(owner).success) throw new MetaCredentialError('credential-store-unavailable');
  const { data, error } = await db.rpc('marketing_account_token_metadata', { p_owner: owner });
  const rows = z.array(MetadataRowSchema).max(20).safeParse(data);
  if (error || !rows.success) throw new MetaCredentialError('credential-store-unavailable');
  return rows.data.map(row => ({ accountId: row.account_id, brand: row.brand, platform: row.platform, expiresAt: row.expires_at, refreshedAt: row.refreshed_at, scopes: row.scopes, loginMode: row.login_mode }));
}

/**
 * True when an unexpired Instagram Login token, or a Facebook Login token (#166), has fewer than ten days left and is
 * old enough for Meta to refresh. A Facebook Login Page token derived from a long-lived user token does not expire,
 * so it is never due.
 */
export function instagramTokenRefreshDue(token: Pick<MetaTokenMetadata, 'expiresAt' | 'refreshedAt' | 'loginMode'>, now = new Date()): boolean {
  const expires = instant(token.expiresAt); const refreshed = instant(token.refreshedAt);
  return (token.loginMode === 'instagram' || token.loginMode === 'facebook') && Number.isFinite(expires) && Number.isFinite(refreshed) && expires > now.getTime() &&
    expires - now.getTime() < INSTAGRAM_TOKEN_REFRESH_WINDOW_MS && now.getTime() - refreshed >= INSTAGRAM_TOKEN_MIN_AGE_MS;
}

/** The stored token wins while unexpired; the environment value is the bootstrap. Holds carry a precise code. */
export function chooseMetaCredential(stored: StoredMetaToken | null, bootstrap: BootstrapMetaCredential, now = new Date()): ChosenMetaCredential {
  const live = (expiresAt: string) => Number.isFinite(instant(expiresAt)) && instant(expiresAt) > now.getTime();
  if (stored && live(stored.expiresAt)) return { source: 'database', accessToken: stored.accessToken, expiresAt: stored.expiresAt, scopes: stored.scopes, loginMode: stored.loginMode, refreshedAt: stored.refreshedAt };
  if (bootstrap.accessToken && live(bootstrap.expiresAt)) {
    if (!bootstrap.loginMode) return { hold: 'meta-login-mode-required' };
    return { source: 'environment', accessToken: bootstrap.accessToken, expiresAt: bootstrap.expiresAt, scopes: bootstrap.scopes, loginMode: bootstrap.loginMode, refreshedAt: null };
  }
  if (stored) return { hold: 'access-token-expired' };
  if (!bootstrap.accessToken) return { hold: 'access-token-missing' };
  return { hold: Number.isFinite(instant(bootstrap.expiresAt)) ? 'access-token-expired' : 'access-token-expiry-unverified' };
}

/**
 * Publisher configuration for one stored account. A held configuration has
 * no token at all, so the publisher's gate stops before any Graph request.
 */
export async function resolveMetaPublisherConfig(db: Database, owner: string, account: MetaCredentialAccount, env: Environment = process.env, now = new Date()): Promise<MetaPublisherConfig> {
  const prefix = metaEnvironmentPrefix(account.brand, account.platform);
  const bootstrap = bootstrapMetaCredential(account.brand, account.platform, env);
  const base = { enabled: env.MARKETING_PUBLISH_ENABLED === 'true' && env[`MARKETING_${account.brand.toUpperCase()}_PUBLISH_ENABLED`] === 'true',
    apiVersion: env[`${prefix}_API_VERSION`] ?? '', apiVersionVerifiedAt: env[`${prefix}_API_VERSION_VERIFIED_AT`] ?? '',
    approvedAssetHosts: (env.MARKETING_APPROVED_ASSET_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean) };
  const held = (code: string): MetaPublisherConfig => ({ ...base, loginMode: bootstrap.loginMode ?? (account.platform === 'threads' ? 'threads' : 'instagram'),
    accessToken: '', tokenExpiresAt: '', scopes: [], credentialHold: code });
  if (account.user_id !== owner) return held('credential-owner-mismatch');
  let stored: StoredMetaToken | null;
  try { stored = await readStoredMetaToken(db, owner, account.id); }
  catch (error) { return held(error instanceof MetaCredentialError ? error.code : 'credential-store-unavailable'); }
  const chosen = chooseMetaCredential(stored, bootstrap, now);
  if ('hold' in chosen) return held(chosen.hold);
  return { ...base, loginMode: chosen.loginMode, accessToken: chosen.accessToken, tokenExpiresAt: chosen.expiresAt, scopes: chosen.scopes, credentialSource: chosen.source };
}

/**
 * Exchanges an unexpired, at-least-24-hour-old Instagram Login token for a
 * new token, then stores it only while the captured account version and private
 * credential fingerprint still match.
 *
 * Meta documents this endpoint only with the token as the `access_token`
 * query parameter, so that is the one request here that carries it in the URL.
 * The URL is never logged or returned. A network failure, unreadable response
 * or failed store is reported as `uncertain` and is not retried. When the
 * stored token has expired, a live bootstrap token is refreshed into the same
 * row under the same captured transaction; the underlying private writer retains
 * its refreshed_at comparison as an additional check.
 */
export async function refreshInstagramToken(db: Database, owner: string, account: MetaCredentialAccount,
  options: { env?: Environment; now?: Date; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<InstagramTokenRefreshOutcome> {
  const now = new Date((options.now ?? new Date()).getTime());
  const selected = z.strictObject({ id: z.uuid(), user_id: z.uuid(), brand: z.enum(['dneskai', 'devshark']), platform: z.enum(['instagram', 'threads']) }).safeParse(account);
  const accountId = selected.success ? selected.data.id : account.id;
  const outcome = (status: Exclude<InstagramTokenRefreshOutcome['status'], 'refreshed'>, code: string): InstagramTokenRefreshOutcome => ({ status, accountId, code });
  if (!selected.success || !z.uuid().safeParse(owner).success || selected.data.user_id !== owner) return outcome('held', 'credential-owner-mismatch');
  if (selected.data.platform !== 'instagram') return outcome('held', 'refresh-instagram-only');
  if (!Number.isFinite(now.getTime())) return outcome('held', 'credential-store-unavailable');
  const signal = AbortSignal.any([AbortSignal.timeout(25_000), ...(options.signal ? [options.signal] : [])]);
  if (signal.aborted) return outcome('uncertain', 'refresh-request-uncertain');
  const env = options.env ?? process.env, original = selected.data;
  const bootstrap = bootstrapMetaCredential(original.brand, original.platform, env);
  const appId = env.MARKETING_META_APP_ID ?? '', appSecret = env.MARKETING_META_APP_SECRET ?? '';
  const version = env[`${metaEnvironmentPrefix(original.brand, original.platform)}_API_VERSION`] ?? '';
  const fetcher = options.fetcher ?? fetch;
  let stored: StoredMetaToken | null, privateCapture: ReturnType<typeof captureStoredInstagramCredential>, accountVersion: string;
  try {
    signal.throwIfAborted();
    const lookup = await awaitWithSignal(db.from('marketing_accounts').select('id,user_id,brand,platform,updated_at').eq('user_id', owner).eq('id', original.id).eq('brand', original.brand).eq('platform', original.platform).retry(false).abortSignal(signal).maybeSingle(), signal);
    signal.throwIfAborted();
    if (lookup.error) throw new Error();
    if (lookup.data === null) return outcome('held', 'account-unavailable');
    const captured = z.strictObject({ id: z.literal(original.id), user_id: z.literal(owner), brand: z.literal(original.brand), platform: z.literal(original.platform), updated_at: databaseTimestamp }).parse(lookup.data);
    accountVersion = captured.updated_at;
    stored = await readStoredMetaToken(db, owner, original.id, signal);
    privateCapture = captureStoredInstagramCredential(stored);
  } catch { return outcome('held', 'credential-store-unavailable'); }
  if (signal.aborted) return outcome('uncertain', 'refresh-request-uncertain');
  const fromEnvironment = bootstrap.accessToken ? { accessToken: bootstrap.accessToken, expiresAt: bootstrap.expiresAt, refreshedAt: null, scopes: bootstrap.scopes, loginMode: bootstrap.loginMode } : null;
  const live = (expiresAt: string) => Number.isFinite(instant(expiresAt)) && instant(expiresAt) > now.getTime();
  const current = stored && live(stored.expiresAt) ? stored : fromEnvironment && live(fromEnvironment.expiresAt) ? fromEnvironment : stored ?? fromEnvironment;
  if (!current) return outcome('held', 'access-token-missing');
  if (current.loginMode !== 'instagram' && current.loginMode !== 'facebook') return outcome('held', 'refresh-instagram-login-required');
  const expires = instant(current.expiresAt);
  if (!Number.isFinite(expires)) return outcome('held', 'access-token-expiry-unverified');
  if (expires <= now.getTime()) return outcome('held', 'access-token-expired');
  const issued = current.refreshedAt ? instant(current.refreshedAt) : expires - INSTAGRAM_LONG_LIVED_TOKEN_MS;
  if (!Number.isFinite(issued) || now.getTime() - issued < INSTAGRAM_TOKEN_MIN_AGE_MS) return outcome('skipped', 'access-token-too-new');
  if (!metaScopesStorable(current.scopes)) return outcome('held', 'verified-scopes-invalid');
  let url: URL;
  if (current.loginMode === 'facebook') {
    if (!/^\d{1,30}$/.test(appId) || appSecret.length < 16 || !/^v\d+\.\d+$/.test(version)) return outcome('held', 'refresh-app-credentials-missing');
    url = new URL(`${FACEBOOK_TOKEN_ENDPOINT}/${version}/oauth/access_token`);
    url.searchParams.set('grant_type', 'fb_exchange_token'); url.searchParams.set('client_id', appId);
    url.searchParams.set('client_secret', appSecret); url.searchParams.set('fb_exchange_token', current.accessToken);
  } else {
    url = new URL(INSTAGRAM_REFRESH_ENDPOINT);
    url.searchParams.set('grant_type', 'ig_refresh_token'); url.searchParams.set('access_token', current.accessToken);
  }
  let reply: Awaited<ReturnType<typeof metaGraphResponse>>;
  try { reply = await metaGraphResponse(url.href, { method: 'GET' }, signal, fetcher, { readErrors: false }); }
  catch (error) { return outcome('uncertain', error instanceof MetaGraphRequestError && error.code === 'meta-invalid-response' ? 'refresh-response-invalid' : 'refresh-request-uncertain'); }
  if (signal.aborted) return outcome('uncertain', 'refresh-request-uncertain');
  if (reply.status !== 200) return outcome(reply.status >= 500 ? 'uncertain' : 'failed', `refresh-http-${reply.status}`);
  const body = RefreshResponseSchema.safeParse(reply.body);
  if (!body.success || reply.body && typeof reply.body === 'object' && 'error' in reply.body || body.data.token_type !== undefined && body.data.token_type.toLowerCase() !== 'bearer') return outcome('uncertain', 'refresh-response-invalid');
  const expiresAt = new Date(now.getTime() + body.data.expires_in * 1000).toISOString();
  try {
    signal.throwIfAborted();
    const saved = await awaitWithSignal(db.rpc('renew_owned_marketing_credential', { p_owner: owner, p_expected_id: original.id, p_expected_at: accountVersion, p_expected_token: privateCapture, p_brand: original.brand, p_platform: original.platform,
      p_token: body.data.access_token, p_expires_at: expiresAt, p_scopes: current.scopes, p_login_mode: current.loginMode }).retry(false).abortSignal(signal), signal);
    signal.throwIfAborted();
    if (saved.error) throw new Error();
    const intent = { ownerId: z.literal(owner), expectedId: z.literal(original.id), expectedVersion: databaseTimestamp };
    const receipt = z.discriminatedUnion('kind', [
      z.strictObject({ ...intent, kind: z.literal('changed'), id: z.uuid().nullable(), updatedAt: databaseTimestamp.nullable() }),
      z.strictObject({ ...intent, kind: z.literal('refreshed'), id: z.literal(original.id), updatedAt: databaseTimestamp,
        result: z.strictObject({ accountId: z.literal(original.id), token: z.strictObject({ expiresAt: databaseTimestamp, refreshedAt: databaseTimestamp, scopes: storedScopes, loginMode }) }) }),
    ]).parse(saved.data);
    if (databaseVersion(receipt.expectedVersion) !== databaseVersion(accountVersion)) throw new Error();
    if (receipt.kind === 'changed') {
      if ((receipt.id === null) !== (receipt.updatedAt === null)) throw new Error();
      return outcome('held', 'refresh-account-changed');
    }
    if (databaseVersion(receipt.updatedAt) !== databaseVersion(accountVersion)) throw new Error();
    const metadata = receipt.result;
    if (databaseVersion(metadata.token.expiresAt) !== databaseVersion(expiresAt) || metadata.token.loginMode !== current.loginMode
      || metadata.token.scopes.length !== current.scopes.length || metadata.token.scopes.some((value, index) => value !== current.scopes[index])
      || stored && databaseVersion(metadata.token.refreshedAt)! <= databaseVersion(stored.refreshedAt)!) throw new Error();
    return { status: 'refreshed', accountId: original.id, expiresAt: metadata.token.expiresAt, refreshedAt: metadata.token.refreshedAt };
  } catch { return outcome('uncertain', 'refresh-store-failed'); }
}
