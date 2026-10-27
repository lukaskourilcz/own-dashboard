import 'server-only';
import { z } from 'zod';
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
  const get = async (path: string, fields: string) => {
    const url = new URL(`https://graph.facebook.com/${config.apiVersion}/${path}`);
    url.searchParams.set('fields', fields);
    try {
      const reply = await metaGraphResponse(url.href, { method: 'GET', headers: { Authorization: `Bearer ${config.accessToken}` } }, signal, options.fetcher, { maximum: 131_072 });
      return { ok: reply.status === 200, ...reply };
    } catch (error) {
      throw new FacebookPageError(error instanceof MetaGraphRequestError && error.code === 'meta-invalid-response' ? 'meta-invalid-response' : 'meta-request-uncertain', true);
    }
  };
  const listed = await get('me/accounts', 'id,access_token,instagram_business_account{id}');
  if (listed.ok) {
    const pages = z.object({ data: z.array(PageSchema).max(100) }).safeParse(listed.body);
    if (pages.success) {
      const page = pages.data.data.find((item) => item.instagram_business_account?.id === igUserId);
      if (!page) throw new FacebookPageError('facebook-page-link-required');
      if (!page.access_token) throw new FacebookPageError('facebook-page-token-unavailable');
      return { pageId: page.id, pageToken: page.access_token };
    }
  }
  // A Page token cannot list Pages: it is the Page.
  const me = await get('me', 'id,instagram_business_account{id}');
  if (!me.ok) throw new FacebookPageError(`meta-http-${me.status}`);
  const page = PageSchema.safeParse(me.body);
  if (!page.success) throw new FacebookPageError('meta-invalid-response');
  if (page.data.instagram_business_account?.id !== igUserId) throw new FacebookPageError('facebook-page-link-required');
  return { pageId: page.data.id, pageToken: config.accessToken };
}
