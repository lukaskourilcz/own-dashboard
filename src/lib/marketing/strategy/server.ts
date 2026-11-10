import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { portfolioEntryFor } from '@/lib/portfolio';
import { StrategyReadSchema, type StrategyPublication } from './contracts';
import type { PublishingBrand } from '@/lib/publishing-calendar';

export async function requireStrategyProject(db: SupabaseClient, owner: string, projectId: string, brand: PublishingBrand) {
  const { data, error } = await db.from('projects').select('id,user_id,portfolio_key,repo_full_name,previous_repo_full_names,parent_id').eq('user_id', owner).eq('id', projectId).maybeSingle();
  const key = data && portfolioEntryFor(data)?.key;
  if (error) throw new Error('strategy-project-read-unavailable');
  return !!data && data.user_id === owner && key === (brand === 'devshark' ? 'react-express-app' : 'aifirst');
}
const receiptSelect = 'id,revision_id,platform,remote_media_id,remote_url,revision_row:marketing_revisions!inner(brand,revision)';
const receiptSchema = z.object({ id: z.uuid(), revision_id: z.uuid(), platform: z.enum(['instagram', 'threads']), remote_media_id: z.string().trim().min(1), remote_url: z.string().nullable(),
  revision_row: z.object({ brand: z.enum(['devshark', 'dneskai']), revision: z.object({ brand: z.enum(['devshark', 'dneskai']), title: z.string(), format: z.enum(['post', 'carousel', 'reel', 'story', 'thread']), account: z.object({ platform: z.enum(['instagram', 'threads']) }) }) }) });

/** A scalar projection, never signed asset URLs or source packets. Exported for receipt-integrity checks. */
export function strategyPublishedPost(raw: unknown, brand: PublishingBrand): StrategyPublication | null {
  const parsed = receiptSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data, r = row.revision_row.revision;
  if (row.revision_row.brand !== brand || r.brand !== brand || row.platform !== r.account.platform || (r.format === 'story' && row.platform !== 'instagram')) return null;
  let remoteUrl: string | null = null;
  try { const url = new URL(row.remote_url!); if (url.protocol === 'https:' && !url.username && !url.password) remoteUrl = url.href; } catch { /* Stories can have an id without a permanent URL. */ }
  if (r.format !== 'story' && !remoteUrl) return null;
  return { id: row.id, revisionId: row.revision_id, title: r.title.slice(0, 300), channel: r.format === 'story' ? 'story' : row.platform, format: r.format, remoteUrl };
}

export async function readStrategy(db: SupabaseClient, owner: string, projectId: string, brand: PublishingBrand) {
  const [links, results, receipts] = await Promise.all([
    db.from('marketing_strategy_links').select('idea_id,draft_id,topic_id').eq('user_id', owner).eq('project_id', projectId).eq('brand', brand).limit(100),
    db.from('marketing_strategy_results').select('id,publication_id,published_at,observed_at,experiment,variant,evidence,metrics').eq('user_id', owner).eq('project_id', projectId).eq('brand', brand).order('observed_at', { ascending: false }).limit(200),
    // Read actual receipts, not the newest drafts: a busy future plan must not hide posts due for seven-day measurement.
    db.from('marketing_publications').select(receiptSelect).eq('user_id', owner).eq('status', 'published').eq('revision_row.brand', brand).order('created_at', { ascending: false }).limit(100),
  ]);
  if (links.error || results.error || receipts.error) throw new Error('strategy-read-unavailable');
  const loaded = new Set((receipts.data ?? []).map((r) => r.id));
  const olderIds = [...new Set((results.data ?? []).map((r) => r.publication_id as string))].filter((id) => !loaded.has(id));
  const older = olderIds.length ? await db.from('marketing_publications').select(receiptSelect).eq('user_id', owner).eq('status', 'published').eq('revision_row.brand', brand).in('id', olderIds).limit(200) : { data: [], error: null };
  if (older.error) throw new Error('strategy-receipts-unavailable');
  const publications = [...(receipts.data ?? []), ...(older.data ?? [])].flatMap((row) => { const post = strategyPublishedPost(row, brand); return post ? [post] : []; });
  return StrategyReadSchema.parse({ links: links.data ?? [], results: results.data ?? [], publications,
    partial: (receipts.data?.length ?? 0) >= 100 || (results.data?.length ?? 0) >= 200 });
}
