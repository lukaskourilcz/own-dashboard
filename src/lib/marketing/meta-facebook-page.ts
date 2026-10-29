import 'server-only';
import { z } from 'zod';
import { readFacebookPages, type FacebookPageList } from './facebook-page-list';
import { metaGraphResponse, MetaGraphRequestError } from './meta-graph-response';
import type { MetaPublisherConfig } from './publisher';

/**
 * The Facebook Page behind @dneskai under Facebook Login (#166, #216). Messaging (private replies) and webhook
 * subscriptions are Page edges and take a Page access token. A user token lists its Pages with their Page tokens
 * (`/me/accounts`); a Page token is the Page itself (`/me`). The Page is the one whose `instagram_business_account`
 * is the account's Instagram id, the same match verification uses. Tokens travel only in the Authorization header.
 */
export type FacebookPage = { pageId: string; pageToken: string };

export class FacebookPageError extends Error {
  constructor(readonly code: string, readonly uncertain = false) { super(code); this.name = 'FacebookPageError'; }
}

const numericId = z.string().regex(/^\d{1,100}$/);
const tokenValue = z.string().regex(/^\S{20,4096}$/);
const PageSchema = z.object({ id: numericId, access_token: tokenValue.optional(), instagram_business_account: z.object({ id: numericId }).optional() });

export async function resolveFacebookPage(config: Pick<MetaPublisherConfig, 'apiVersion' | 'accessToken' | 'loginMode'>, igUserId: string,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<FacebookPage> {
  config = { apiVersion: config.apiVersion, accessToken: config.accessToken, loginMode: config.loginMode };
  if (config.loginMode !== 'facebook') throw new FacebookPageError('login-mode-mismatch');
  if (!/^v\d+\.\d+$/.test(config.apiVersion)) throw new FacebookPageError('api-version-unverified');
  if (!numericId.safeParse(igUserId).success || !config.accessToken) throw new FacebookPageError('account-unavailable');
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(options.signal ? [options.signal] : [])]);
  const get = async (url: URL) => {
    try {
      return await metaGraphResponse(url.href, { method: 'GET', headers: { Authorization: `Bearer ${config.accessToken}` } }, signal, options.fetcher, { maximum: 131_072 });
    } catch (error) {
      throw new FacebookPageError(error instanceof MetaGraphRequestError && error.code === 'meta-invalid-response' ? 'meta-invalid-response' : 'meta-request-uncertain', true);
    }
  };
  const accounts = new URL(`https://graph.facebook.com/${config.apiVersion}/me/accounts`);
  accounts.searchParams.set('fields', 'id,access_token,instagram_business_account{id}');
  let listed: FacebookPageList<z.infer<typeof PageSchema>>;
  try { listed = await readFacebookPages(accounts, PageSchema, get, signal); }
  catch (error) {
    if (error instanceof FacebookPageError) throw error;
    throw new FacebookPageError(error instanceof MetaGraphRequestError ? error.code : 'meta-request-uncertain', true);
  }
  if (listed.kind === 'complete') {
    const matches = listed.pages.filter(item => item.instagram_business_account?.id === igUserId);
    if (matches.length > 1) throw new FacebookPageError('meta-invalid-response', true);
    const page = matches[0];
    if (!page) throw new FacebookPageError('facebook-page-link-required');
    if (!page.access_token) throw new FacebookPageError('facebook-page-token-unavailable');
    return { pageId: page.id, pageToken: page.access_token };
  }
  if (!listed.first || listed.status !== 400) throw new FacebookPageError(`meta-http-${listed.status}`, listed.status === 429 || listed.status >= 500);
  // A Page token cannot list Pages: only the first unsupported list request may fall back to /me.
  const url = new URL(`https://graph.facebook.com/${config.apiVersion}/me`);
  url.searchParams.set('fields', 'id,instagram_business_account{id}');
  const me = await get(url);
  if (me.status !== 200) throw new FacebookPageError(`meta-http-${me.status}`, me.status === 429 || me.status >= 500);
  const page = PageSchema.safeParse(me.body);
  if (!page.success) throw new FacebookPageError('meta-invalid-response');
  if (page.data.instagram_business_account?.id !== igUserId) throw new FacebookPageError('facebook-page-link-required');
  return { pageId: page.data.id, pageToken: config.accessToken };
}
