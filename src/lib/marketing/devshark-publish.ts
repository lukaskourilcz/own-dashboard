import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { createAdminClient } from '@/lib/supabase/admin';
import { parseContentRevision, type ContentRevision } from './contracts';
import { pragueScheduledAt } from './clock';
import { pragueMarketingDate } from './weekly-planning';
import { pragueDayAfter } from './dneskai-workspace';
import { DevsharkDeckSchema } from './devshark-deck';
import { renderDevsharkDeck, renderDevsharkStory } from './devshark-render';
import { devsharkDraftPacket } from './devshark-source';
import { STORY_HEIGHT, STORY_WIDTH, storyRenderKey } from './story-image';
import { createDneskaiSlideStorage } from './worker-runtime';
import { ingestSource, saveRevision } from './store';

/**
 * devShark publishing (owner decision, 7 November 2026). For each plan slot of today and tomorrow whose concept the
 * owner approved, the step renders the concept once, stores the slides, and saves and approves one revision per
 * channel: the Instagram carousel (12:00) with its story ten minutes later, and the Threads post (12:00 as the
 * twin, 19:00 alone). Every revision cites the concept as its source, so a concept changed after this stops them.
 * The publisher then sends them like any approved post. At most one render per tick.
 */
type Database = ReturnType<typeof createAdminClient>;

export const DEVSHARK_STORY_DELAY_MS = 10 * 60_000;
const APPROVAL_LEAD_MS = 2 * 60_000;
const THREADS_MAX = 500;
const TAG = '#devshark';

/** The devShark Instagram base set (Apify research, 8 November 2026), always carried, #devshark last. */
export const DEVSHARK_HASHTAG_BASE = ['typescript', 'javascript', 'webdevelopment', 'frontend', 'devshark'] as const;
/** Tags a devShark caption never carries: crowded by other niches or too broad (Apify research, 8 November 2026). */
export const DEVSHARK_HASHTAG_BLOCKED: ReadonlySet<string> = new Set(['python', 'git', 'css', 'programmerhumor', 'reactjs']);
/** At most seven hashtags on an Instagram post (owner, 8 November 2026); the base set leaves room for two topic tags. */
export const DEVSHARK_HASHTAG_LIMIT = 7;
const HASHTAG = /(^|\s)#([\p{L}\p{N}_]+)/gu;

/**
 * The Instagram caption of a devShark concept: its text without hashtags, then one hashtag line of up to two of its
 * own topic tags (blocked ones dropped) and the base set, seven at most. Threads keeps its own rule.
 */
export function devsharkInstagramCaption(caption: string): string {
  const own = [...caption.matchAll(HASHTAG)].map((match) => match[2]!.toLowerCase());
  const base: readonly string[] = DEVSHARK_HASHTAG_BASE;
  const topic = [...new Set(own)].filter((tag) => !DEVSHARK_HASHTAG_BLOCKED.has(tag) && !base.includes(tag)).slice(0, DEVSHARK_HASHTAG_LIMIT - base.length);
  const body = caption.split(/\n{2,}/).map((paragraph) => paragraph.split('\n').map((line) => line.replace(HASHTAG, '$1').replace(/[ \t]{2,}/g, ' ').trim()).filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
  const tags = [...topic, ...base].map((tag) => `#${tag}`).join(' ');
  return `${body}\n${tags}`;
}

/** The Threads text of a devShark caption: no hashtags, shortened to fit, then the one topic tag. */
export function devsharkThreadsText(caption: string): string {
  const body = caption.split(/\n{2,}/).map((paragraph) => paragraph.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, '$1').replace(/[ \t]{2,}/g, ' ').trim()).filter(Boolean).join('\n\n');
  const room = THREADS_MAX - TAG.length - 2;
  let text = body;
  if (text.length > room) {
    const cut = text.slice(0, room - 1);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
    text = end > room * 0.6 ? cut.slice(0, end + 1).trimEnd() : `${cut.slice(0, Math.max(1, cut.lastIndexOf(' '))).trimEnd()}…`;
  }
  return `${text}\n\n${TAG}`.trim().slice(0, THREADS_MAX);
}

type Slot = { id: string; date: string; local_time: string; instagram: boolean; threads: boolean; draft_id: string; status: string; code: string | null;
  instagram_revision_id: string | null; threads_revision_id: string | null; story_revision_id: string | null };
type Account = { remote_account_id: string; handle: string };
const DraftSchema = z.object({ id: z.uuid(), title: z.string(), caption: z.string(), deck: DevsharkDeckSchema, status: z.string(), origin: z.string() });
const read = <T>(result: { data: T | null; error: unknown }, code: string): T => { if (result.error) throw new Error(code); return result.data as T; };

export type DevsharkPublishResult = { prepared: number; approved: number; codes: Record<string, number> };

export async function prepareDevsharkPosts(db: Database, owner: string, project: string, input: { now: Date; signal: AbortSignal; remainingMs: () => number }): Promise<DevsharkPublishResult> {
  z.uuid().parse(owner); z.uuid().parse(project);
  const result: DevsharkPublishResult = { prepared: 0, approved: 0, codes: {} };
  const note = (code: string) => { result.codes[code] = (result.codes[code] ?? 0) + 1; };
  const today = pragueMarketingDate(input.now);
  const slots = read(await db.from('marketing_devshark_plan').select('id,date,local_time,instagram,threads,draft_id,status,code,instagram_revision_id,threads_revision_id,story_revision_id')
    .eq('user_id', owner).eq('project_id', project).gte('date', today).lte('date', pragueDayAfter(today, 1)).in('status', ['planned', 'ready']).order('date').order('local_time').limit(6), 'devshark-plan-unavailable') as Slot[];
  if (!slots.length) return result;
  const accounts = read(await db.from('marketing_accounts').select('platform,remote_account_id,handle').eq('user_id', owner).eq('brand', 'devshark').not('verified_at', 'is', null), 'devshark-accounts-unavailable') as Array<Account & { platform: string }>;
  const instagram = accounts.find((row) => row.platform === 'instagram') ?? null, threads = accounts.find((row) => row.platform === 'threads') ?? null;
  const storage = createDneskaiSlideStorage(db, owner, { signal: input.signal });
  let rendered = false;
  const update = async (slot: Slot, patch: Partial<Slot>) => {
    const { error } = await db.from('marketing_devshark_plan').update(patch).eq('user_id', owner).eq('id', slot.id);
    if (error) throw new Error('devshark-plan-write-failed');
    Object.assign(slot, patch);
  };
  const approve = async (id: string) => {
    const { data: row } = await db.from('marketing_revisions').select('content_hash,status').eq('user_id', owner).eq('id', id).maybeSingle();
    if (!row || row.status === 'approved') return;
    const { error } = await db.rpc('marketing_devshark_plan_approve', { p_owner: owner, p_revision_id: id, p_expected_hash: row.content_hash });
    if (error) throw new Error(`devshark-approval-${String(error.message ?? 'failed').replace(/[^a-z]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 60)}`);
    result.approved++;
  };
  for (const slot of slots) {
    if (input.remainingMs() < 8_000 || input.signal.aborted) break;
    const at = Date.parse(pragueScheduledAt(slot.date, slot.local_time));
    if (at <= input.now.getTime() + APPROVAL_LEAD_MS) { await update(slot, { status: 'failed', code: 'slot-passed' }); continue; }
    try {
      const needs = { instagram: slot.instagram && !slot.instagram_revision_id, story: slot.instagram && !slot.story_revision_id, threads: slot.threads && !slot.threads_revision_id };
      if (needs.instagram || needs.story || needs.threads) {
        if ((needs.instagram || needs.story) && !instagram) { await update(slot, { code: 'instagram-account-missing' }); note('instagram-account-missing'); }
        if (needs.threads && !threads) { await update(slot, { code: 'threads-account-missing' }); note('threads-account-missing'); }
        const want = { instagram: needs.instagram && !!instagram, story: needs.story && !!instagram, threads: needs.threads && !!threads };
        if (!want.instagram && !want.story && !want.threads) continue;
        if (rendered || input.remainingMs() < 20_000) { note('devshark-render-waiting'); continue; }
        const draft = DraftSchema.parse(read(await db.from('marketing_devshark_drafts').select('id,title,caption,deck,status,origin').eq('user_id', owner).eq('id', slot.draft_id).maybeSingle(), 'devshark-draft-unavailable'));
        if (draft.status !== 'planned') { await update(slot, { status: 'failed', code: `concept-${draft.status}` }); continue; }
        // The concept is the revisions' source; store its packet now so approval and publishing can check it.
        const packet = devsharkDraftPacket(draft, input.now);
        await ingestSource(db, owner, packet, 'devshark');
        const slides = await renderDevsharkDeck(draft.deck);
        rendered = true;
        const assets: ContentRevision['assets'] = [];
        for (const slide of slides) {
          const renderKey = createHash('sha256').update(`devshark-slide/1\n${slide.sha256}`).digest('hex');
          const stored = (await storage.find(renderKey)) ?? (await storage.put({ renderKey, bytes: slide.jpeg, sha256: slide.sha256, metadata: { kind: 'devshark-slide', draftId: draft.id } }));
          assets.push({ url: stored.url, sha256: stored.sha256, mimeType: 'image/jpeg', width: 1080, height: 1350, alt: slide.alt || draft.title });
        }
        const common = { schemaVersion: 'marketing-content/1', brand: 'devshark', title: draft.title.slice(0, 300), sources: [{ sourceId: packet.sourceId, sourceRevision: packet.sourceRevision, contentHash: packet.contentHash }],
          knowledgeIds: [], timeZone: 'Europe/Prague', templateVersion: 'devshark-social/1', promptVersion: draft.origin === 'generated' ? 'devshark-generated/1' : 'devshark-concept/1', model: 'owner-approved-concept', traceId: null } as const;
        const scheduledAt = new Date(at).toISOString();
        if (want.instagram) {
          const saved = await saveRevision(db, owner, parseContentRevision({ ...common, caption: devsharkInstagramCaption(draft.caption), format: 'carousel', assets, account: { id: instagram!.remote_account_id, platform: 'instagram', handle: instagram!.handle }, scheduledAt }), {});
          await update(slot, { instagram_revision_id: saved.id });
        }
        if (want.threads) {
          const saved = await saveRevision(db, owner, parseContentRevision({ ...common, caption: devsharkThreadsText(draft.caption), format: 'carousel', assets, account: { id: threads!.remote_account_id, platform: 'threads', handle: threads!.handle }, scheduledAt }), {});
          await update(slot, { threads_revision_id: saved.id });
        }
        if (want.story) {
          const cover = slides[0]!;
          const renderKey = storyRenderKey(cover.sha256, 'devshark-story/2');
          let story = await storage.find(renderKey);
          if (!story) { const image = await renderDevsharkStory(draft.deck); story = await storage.put({ renderKey, bytes: image.jpeg, sha256: image.sha256, metadata: { kind: 'devshark-story', draftId: draft.id } }); }
          const saved = await saveRevision(db, owner, parseContentRevision({ ...common, caption: `Story: ${draft.title}`.slice(0, 2200), format: 'story',
            assets: [{ url: story.url, sha256: story.sha256, mimeType: 'image/jpeg', width: STORY_WIDTH, height: STORY_HEIGHT, alt: cover.alt || draft.title }], account: { id: instagram!.remote_account_id, platform: 'instagram', handle: instagram!.handle },
            scheduledAt: new Date(at + DEVSHARK_STORY_DELAY_MS).toISOString() }), {});
          await update(slot, { story_revision_id: saved.id });
        }
        result.prepared++;
      }
      for (const id of [slot.instagram_revision_id, slot.threads_revision_id, slot.story_revision_id]) if (id) await approve(id);
      const complete = (!slot.instagram || (slot.instagram_revision_id && slot.story_revision_id)) && (!slot.threads || slot.threads_revision_id);
      await update(slot, { status: complete ? 'approved' : 'ready', ...(complete ? { code: null } : {}) });
    } catch (error) {
      const code = error instanceof Error && /^[a-z][a-z0-9-]{1,99}$/.test(error.message) ? error.message : 'devshark-publish-failed';
      note(code);
      await update(slot, { code }).catch(() => undefined);
    }
  }
  return result;
}
