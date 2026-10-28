import { readVerifiedServerContext } from '@/lib/supabase/server-owner';
import { awaitWithSignal } from '@/lib/abortable';
import { readKnowledgeBody } from '@/lib/marketing/knowledge-body';
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
const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
  try {
    const context = await readVerifiedServerContext(signal);
    if (!context) return fail(401, 'unauthorized');
    const { db, ownerId } = context;
    signal.throwIfAborted();
    const rateSignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
    rateSignal.throwIfAborted();
    const limited = await awaitWithSignal(rateLimit(ownerId, { key: 'dneskai-preview', limit: 60, windowSec: 60 }), rateSignal);
    signal.throwIfAborted();
    if (!limited.ok) return Response.json({ error: 'rate-limited' }, { status: 429, headers: { 'Retry-After': String(limited.retryAfter), 'Cache-Control': 'private, no-store' } });
    let input: DneskaiPreviewRequest;
    try {
      const raw = await readKnowledgeBody(request, 160_000, signal);
      if (raw.length > 40_000) throw new Error('too-large');
      input = DneskaiPreviewRequestSchema.parse(JSON.parse(raw));
      signal.throwIfAborted();
    } catch (error) {
      const interrupted = signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
      return fail(interrupted ? 503 : 400, interrupted ? 'render-unavailable' : 'invalid-request');
    }
    const { data: row, error } = await awaitWithSignal(db.from('marketing_revisions').select('revision').eq('id', input.id).eq('user_id', ownerId).retry(false).abortSignal(signal).maybeSingle(), signal);
    signal.throwIfAborted();
    if (error) return fail(503, 'render-unavailable');
    if (!row) return fail(404, 'revision-unavailable');
    let original;
    try { original = parseContentRevision(row.revision); } catch { return fail(503, 'render-unavailable'); }
    if (!original.deck) return fail(409, 'deck-edit-unsupported');
    const admin = createAdminClient(signal);
    let wiring;
    try { wiring = { loadMedia: getDneskaiMediaLoader(admin, ownerId), listBriefAssetHashes: getBriefAssetHashLister(admin, ownerId), loadBriefPool: getBriefPoolLoader(admin, ownerId) }; }
    catch (failure) { return fail(503, failure instanceof Error && failure.message === 'media-unwired' ? 'media-unwired' : 'renderer-unavailable'); }
    signal.throwIfAborted();
    let deck;
    try {
      deck = await awaitWithSignal(editedDneskaiDeck(original, input.deck, wiring.listBriefAssetHashes, wiring.loadBriefPool), signal);
      signal.throwIfAborted();
    } catch (failure) {
      if (signal.aborted) return fail(503, 'render-unavailable');
      if (failure instanceof DneskaiRevisionEditError) return fail(409, failure.code);
      return fail(503, 'media-unavailable');
    }
    const renderSignal = AbortSignal.any([signal, AbortSignal.timeout(DNESKAI_PREVIEW_BUDGET_MS)]);
    renderSignal.throwIfAborted();
    try { return await awaitWithSignal(dneskaiPreviewResponse(deck, input.slide, wiring.loadMedia, renderSignal), renderSignal); }
    catch { return fail(renderSignal.aborted ? 504 : 503, renderSignal.aborted ? 'worker-timeout' : 'render-unavailable'); }
  } catch {
    return fail(503, 'render-unavailable');
  }
}
