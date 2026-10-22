import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { rateLimit } from '@/lib/rate-limit';
import { parseContentRevision } from '@/lib/marketing/contracts';
import { DneskaiPreviewRequestSchema, type DneskaiPreviewRequest } from '@/lib/marketing/dneskai-lab';
import { DneskaiRevisionEditError, editedDneskaiDeck } from '@/lib/marketing/dneskai-revision-edit';
import { DNESKAI_PREVIEW_BUDGET_MS, dneskaiPreviewResponse } from '@/lib/marketing/dneskai-preview';
import { getBriefAssetHashLister, getBriefPoolLoader, getDneskaiMediaLoader } from '@/lib/marketing/dneskai-wiring';

export const runtime = 'nodejs';
export const maxDuration = 15;

/**
 * POST /api/marketing/dneskai/preview (REN-01): one slide of the owner's unsaved draft as real pixels.
 * Body `{ id, deck, slide }`: the revision being edited, the draft as the same `edit` deck a save would send, and the
 * slide of the edited deck to draw. The edit is checked with the save's rules (`editedDneskaiDeck`), then the slide
 * is rendered in memory by the vendored studio. $0: no model call. No write to `marketing-assets`, no revision, no
 * content hash: the answer is marked `draft` and can never be approved or published; approval still binds a saved
 * revision. Owner-only (the revision is read through the owner's session), rate-limited per owner like the fit route,
 * and bounded by `DNESKAI_PREVIEW_BUDGET_MS` (an abort answers 504 `worker-timeout`).
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const limited = await rateLimit(user.id, { key: 'dneskai-preview', limit: 60, windowSec: 60 });
  if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter) } });
  let input: DneskaiPreviewRequest;
  try { const raw = await request.text(); if (raw.length > 40_000) throw new Error('too-large'); input = DneskaiPreviewRequestSchema.parse(JSON.parse(raw)); }
  catch { return Response.json({ error: 'invalid-request' }, { status: 400 }); }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DNESKAI_PREVIEW_BUDGET_MS)]);
  const { data: row, error } = await db.from('marketing_revisions').select('revision').eq('id', input.id).eq('user_id', user.id).maybeSingle();
  if (error || !row) return Response.json({ error: 'revision-unavailable' }, { status: 404 });
  let original;
  try { original = parseContentRevision(row.revision); } catch { return Response.json({ error: 'revision-unavailable' }, { status: 404 }); }
  if (!original.deck) return Response.json({ error: 'deck-edit-unsupported' }, { status: 409 });
  const admin = createAdminClient();
  let wiring;
  try { wiring = { loadMedia: getDneskaiMediaLoader(admin, user.id), listBriefAssetHashes: getBriefAssetHashLister(admin, user.id), loadBriefPool: getBriefPoolLoader(admin, user.id) }; }
  catch (failure) { return Response.json({ error: failure instanceof Error && failure.message === 'media-unwired' ? 'media-unwired' : 'renderer-unavailable' }, { status: 503 }); }
  let deck;
  try { deck = await editedDneskaiDeck(original, input.deck, wiring.listBriefAssetHashes, wiring.loadBriefPool); }
  catch (failure) {
    if (failure instanceof DneskaiRevisionEditError) return Response.json({ error: failure.code }, { status: 409 });
    return Response.json({ error: 'media-unavailable' }, { status: 503 });
  }
  return dneskaiPreviewResponse(deck, input.slide, wiring.loadMedia, signal);
}
