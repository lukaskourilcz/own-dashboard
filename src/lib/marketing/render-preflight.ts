import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { BrandSchema, parseSourcePacket, sourceUsable } from './contracts';
import { contentHash } from './hashes';
import { marketingPilotConfiguration } from './pilot';
import { previewPilotRetired } from './preview-pilot';
import { trustedMarketingTemplate } from './template-registry';
import { refreshSource } from './source-refresh';
import { MarketingRenderError, renderAuthoredMarketingPreflight, validateMarketingTemplate } from './render';

type Database = ReturnType<typeof createAdminClient>;
type Environment = Record<string, string | undefined>;
export const RenderPreflightInputSchema = z.strictObject({ brand: BrandSchema, sourceId: z.string().min(1).max(200), scheduledAt: z.iso.datetime({ offset: true }) });
export const MARKETING_PREFLIGHT_HOLD_CODES = ['render-preflight-preview-required', 'render-preflight-pilot-required', 'render-preflight-owner-mismatch', 'render-preflight-consent-required', 'render-preflight-schedule-invalid', 'render-preflight-account-unavailable', 'render-preflight-source-unavailable', 'render-preflight-source-changed', 'render-preflight-refresh-failed'] as const;
export class MarketingRenderPreflightError extends Error {
  constructor(public readonly code: typeof MARKETING_PREFLIGHT_HOLD_CODES[number]) { super(code); this.name = 'MarketingRenderPreflightError'; }
}
/** Authenticated Preview diagnostic. Reads producer/DB state; never reserves, writes or uploads. */
export async function runMarketingRenderPreflight(db: Database, ownerId: string, value: z.infer<typeof RenderPreflightInputSchema>, options: { env?: Environment; now?: () => Date; signal?: AbortSignal; refresh?: typeof refreshSource } = {}) {
  const input = RenderPreflightInputSchema.parse(value), env = options.env ?? process.env, now = options.now ?? (() => new Date());
  if (previewPilotRetired('generation-pilot', env)) throw new MarketingRenderPreflightError('render-preflight-preview-required');
  if (env.MARKETING_OWNER_ID !== ownerId) throw new MarketingRenderPreflightError('render-preflight-owner-mismatch');
  if (!marketingPilotConfiguration(ownerId, env, now())) throw new MarketingRenderPreflightError('render-preflight-pilot-required');
  if (env.MARKETING_AI_CONSENT !== 'true') throw new MarketingRenderPreflightError('render-preflight-consent-required');
  const scheduled = Date.parse(input.scheduledAt), time = now().getTime();
  if (scheduled <= time || scheduled > time + 6 * 86400000) throw new MarketingRenderPreflightError('render-preflight-schedule-invalid');
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
  // Only devShark's authored sources have a single-layout template; DNESKAi decks render through the carousel studio.
  const brand = input.brand;
  if (brand !== 'devshark') throw new MarketingRenderError('render-preflight-source-kind-unsupported');
  const template = validateMarketingTemplate(trustedMarketingTemplate(brand, env, now()), true);
  const { data: account, error: accountError } = await db.from('marketing_accounts').select('user_id,brand,platform,remote_account_id,handle,verified_at').eq('user_id', ownerId).eq('brand', input.brand).eq('platform', 'instagram').not('verified_at', 'is', null).single();
  if (accountError || !account || account.user_id !== ownerId || account.brand !== input.brand || account.platform !== 'instagram' || !account.verified_at) throw new MarketingRenderPreflightError('render-preflight-account-unavailable');
  const { data: row, error: sourceError } = await db.from('marketing_sources').select('packet').eq('user_id', ownerId).eq('brand', input.brand).eq('source_id', input.sourceId).maybeSingle();
  if (sourceError || !row) throw new MarketingRenderPreflightError('render-preflight-source-unavailable');
  const previous = parseSourcePacket(row.packet);
  if (previous.brand !== input.brand || previous.sourceId !== input.sourceId) throw new MarketingRenderPreflightError('render-preflight-source-unavailable');
  let source;
  try { source = parseSourcePacket(await (options.refresh ?? refreshSource)(previous, signal, { owner: ownerId, db })); }
  catch { throw new MarketingRenderPreflightError('render-preflight-refresh-failed'); }
  if (source.brand !== input.brand || source.sourceId !== input.sourceId || source.kind !== previous.kind || !sourceUsable(source, now()) || contentHash(source.content) !== source.contentHash) throw new MarketingRenderPreflightError('render-preflight-source-unavailable');
  const result = await renderAuthoredMarketingPreflight({ source, template, account: { id: account.remote_account_id, handle: account.handle, platform: 'instagram' }, scheduledAt: input.scheduledAt, revisionId: randomUUID(), signal, now: now() });
  // A source withdrawal or template/pilot expiry during rendering never produces a success receipt.
  let current;
  try { current = parseSourcePacket(await (options.refresh ?? refreshSource)(source, signal, { owner: ownerId, db })); }
  catch { throw new MarketingRenderPreflightError('render-preflight-refresh-failed'); }
  const fields = ['brand', 'kind', 'sourceId', 'sourceRevision', 'canonicalUrl', 'locale', 'contentHash'] as const;
  if (!sourceUsable(current, now()) || fields.some(field => current[field] !== source[field]) || contentHash(current.content) !== source.contentHash) throw new MarketingRenderPreflightError('render-preflight-source-changed');
  marketingPilotConfiguration(ownerId, env, now());
  if (contentHash(trustedMarketingTemplate(brand, env, now())) !== contentHash(template)) throw new MarketingRenderPreflightError('render-preflight-source-changed');
  return result;
}
