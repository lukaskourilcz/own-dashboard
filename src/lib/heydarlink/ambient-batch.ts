import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AMBIENT_ASPECTS, AMBIENT_CAPS, AMBIENT_GATE, AMBIENT_PERSONAS, ambientFalUsd, ambientSeed, ambientShotList, type AmbientAspect, type AmbientPersona, type AmbientSettings } from './ambient-config';
import { ambientDuplicateGate, ambientFormatGate, inspectAmbientFrame, readAmbientFormat } from './ambient-gates';
import { CropRefused, gradeAmbientFrame } from './ambient-grade';
import { ambientSha256, uploadAmbientFrame } from './ambient-ingest';
import { ambientPhash } from './ambient-phash';
import { AmbientRenderError, ambientStockSeed, renderAmbientFrame } from './ambient-render';

/**
 * HeyDarlink ambient batches (owner decision, 8 November 2026: on demand, not daily). A batch is one persona's whole
 * shot list, every shot in 4:5 and 9:16, so 20 frames. It starts by hand (`POST /api/heydarlink/ambient`) or when
 * HeyDarlink reports fewer than `AMBIENT_LOW_STOCK` unused frames for the persona. The marketing tick works one frame
 * at a time: render on fal, grade, gate, upload. Each batch has its own cost cap; each frame records its cost, and a
 * frame the cap cannot pay for is `skipped-cap` and closes the batch as `capped`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the generated database types do not cover these tables
type Database = SupabaseClient<any>;
type Environment = Record<string, string | undefined>;

export const AMBIENT_LOW_STOCK = 3;
/** The default cap of one batch: 20 frames are about $1.35 with no retries (fal $0.05 + $0.075 per shot, Claude ~$0.005 per check). */
export const AMBIENT_BATCH_USD_DEFAULT = 3;
const LEASE_SECONDS = 150;
/** One attempt needs about this long: a fal render, a download, the grade and Claude's look. */
const ATTEMPT_MS = 35_000;

export function ambientBatchCapUsd(env: Environment = process.env): number {
  const raw = Number(env.HEYDARLINK_AMBIENT_BATCH_USD ?? AMBIENT_BATCH_USD_DEFAULT);
  return Number.isFinite(raw) && raw > 0 && raw <= 20 ? raw : AMBIENT_BATCH_USD_DEFAULT;
}

/** Opens a batch for the persona, or returns the one already open. */
export async function openAmbientBatch(db: Database, persona: AmbientPersona, reason: 'manual' | 'low-stock', capUsd: number): Promise<{ id: string; created: boolean; frames: number }> {
  const open = await db.from('heydarlink_ambient_batches').select('id').eq('persona', persona).eq('status', 'open').maybeSingle();
  if (open.error) throw new Error('ambient-batch-unavailable');
  if (open.data) return { id: open.data.id as string, created: false, frames: 0 };
  const inserted = await db.from('heydarlink_ambient_batches').insert({ persona, reason, cap_usd: capUsd }).select('id').single();
  if (inserted.error || !inserted.data) {
    // Another request opened it meanwhile.
    const again = await db.from('heydarlink_ambient_batches').select('id').eq('persona', persona).eq('status', 'open').maybeSingle();
    if (again.data) return { id: again.data.id as string, created: false, frames: 0 };
    throw new Error('ambient-batch-write-failed');
  }
  const id = inserted.data.id as string;
  const shots = ambientShotList().personas[persona].shots;
  // Every shot in both aspects: the feed and the stories draw from the same batch.
  const rows = shots.flatMap((shot) => AMBIENT_ASPECTS.map((aspect) => ({ batch_id: id, persona, shot_id: shot.id, pillar: shot.pillar, aspect, prompt: shot.prompt })));
  const frames = await db.from('heydarlink_ambient_frames').insert(rows);
  if (frames.error) throw new Error('ambient-frames-write-failed');
  return { id, created: true, frames: rows.length };
}

const FrameSchema = z.object({ id: z.uuid(), batch_id: z.uuid(), persona: z.enum(AMBIENT_PERSONAS), shot_id: z.string(), pillar: z.string(), aspect: z.enum(AMBIENT_ASPECTS), prompt: z.string(), attempts: z.number().int(), reasons: z.array(z.string()) });
type Frame = z.infer<typeof FrameSchema>;
export type AmbientWorkResult = { status: 'idle' | 'uploaded' | 'rejected' | 'duplicate-on-server' | 'upload-failed' | 'skipped-cap' | 'deferred'; frameId?: string; costUsd?: number; code?: string };

async function closeIfFinished(db: Database, batchId: string) {
  const left = await db.from('heydarlink_ambient_frames').select('id', { count: 'exact', head: true }).eq('batch_id', batchId).in('status', ['pending', 'running']);
  if (!left.error && (left.count ?? 0) === 0) await db.from('heydarlink_ambient_batches').update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', batchId).eq('status', 'open');
}

/**
 * Works one frame: claims it, checks the batch cap, renders, grades and gates it, and uploads it. A frame that fails a
 * gate gets one more attempt with a new seed while the tick has time; a provider error is recorded and the frame
 * returns to the queue until its attempts run out. Never posts anything; HeyDarlink decides where a frame goes.
 */
export async function workAmbientFrame(db: Database, settings: AmbientSettings, input: { signal: AbortSignal; remainingMs: () => number; fetchImpl?: typeof fetch; now?: () => Date }): Promise<AmbientWorkResult> {
  if (input.remainingMs() < ATTEMPT_MS + 5_000) return { status: 'deferred', code: 'ambient-tick-short' };
  const claimed = await db.rpc('heydarlink_ambient_claim', { p_lease_seconds: LEASE_SECONDS });
  if (claimed.error) throw new Error('ambient-claim-failed');
  const raw = (claimed.data as unknown[] | null)?.[0];
  if (!raw) return { status: 'idle' };
  const frame: Frame = FrameSchema.parse(raw);
  const batch = await db.from('heydarlink_ambient_batches').select('cap_usd').eq('id', frame.batch_id).single();
  const spent = await db.from('heydarlink_ambient_frames').select('cost_usd').eq('batch_id', frame.batch_id).limit(200);
  if (batch.error || spent.error) throw new Error('ambient-batch-unavailable');
  let batchSpent = (spent.data ?? []).reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0);
  const capUsd = Number(batch.data.cap_usd);
  const shotList = ambientShotList();
  const shot = shotList.personas[frame.persona].shots.find((item) => item.id === frame.shot_id);
  const reasons = [...frame.reasons];
  let costUsd = 0, attempts = frame.attempts;
  const finish = async (status: AmbientWorkResult['status'], patch: Record<string, unknown> = {}) => {
    const { error } = await db.from('heydarlink_ambient_frames').update({ status, reasons: reasons.slice(-40), attempts, cost_usd: Number((costUsd + (await priorCost(db, frame.id))).toFixed(6)), lease_until: null, updated_at: new Date().toISOString(), ...patch }).eq('id', frame.id);
    if (error) throw new Error('ambient-frame-write-failed');
    if (status === 'skipped-cap') {
      // The cap is spent: nothing else in this batch can be paid for.
      await db.from('heydarlink_ambient_frames').update({ status: 'skipped-cap', reasons: ['cap:batch'], updated_at: new Date().toISOString() }).eq('batch_id', frame.batch_id).eq('status', 'pending');
      await db.from('heydarlink_ambient_batches').update({ status: 'capped', finished_at: new Date().toISOString() }).eq('id', frame.batch_id).eq('status', 'open');
    } else await closeIfFinished(db, frame.batch_id);
    return { status, frameId: frame.id, costUsd } as AmbientWorkResult;
  };
  if (!shot) { reasons.push('config:shot-removed'); return finish('rejected'); }

  const history = await db.from('heydarlink_ambient_frames').select('phash').eq('status', 'uploaded').gte('updated_at', new Date((input.now?.() ?? new Date()).getTime() - AMBIENT_GATE.historyDays * 86_400_000).toISOString()).not('phash', 'is', null).limit(2000);
  if (history.error) throw new Error('ambient-history-unavailable');
  const hashes = (history.data ?? []).map((row) => row.phash as string);
  const date = (input.now?.() ?? new Date()).toISOString().slice(0, 10);
  const aspect: AmbientAspect = frame.aspect;
  const frameEstimate = ambientFalUsd(aspect) + AMBIENT_GATE.reserveUsd;
  let stock: Awaited<ReturnType<typeof ambientStockSeed>> | undefined;

  while (attempts < AMBIENT_CAPS.maxAttemptsPerFrame) {
    if (input.remainingMs() < ATTEMPT_MS) {
      // Not enough of the tick left for another try: the frame goes back to the queue as it is.
      const { error } = await db.from('heydarlink_ambient_frames').update({ status: 'pending', reasons: reasons.slice(-40), attempts, cost_usd: Number((costUsd + (await priorCost(db, frame.id))).toFixed(6)), lease_until: null, updated_at: new Date().toISOString() }).eq('id', frame.id);
      if (error) throw new Error('ambient-frame-write-failed');
      return { status: 'deferred', frameId: frame.id, costUsd, code: 'ambient-tick-short' };
    }
    if (batchSpent + frameEstimate > capUsd) { reasons.push('cap:batch'); return finish('skipped-cap'); }
    const tag = `a${attempts + 1}`;
    attempts += 1;
    if (stock === undefined) stock = await ambientStockSeed(shot, aspect, { pexelsKey: settings.pexelsKey, date, fetchImpl: input.fetchImpl, signal: input.signal });
    const falUsd = ambientFalUsd(aspect);
    let render;
    try {
      render = await renderAmbientFrame({ falKey: settings.falKey, prompt: shot.prompt, aspect, seed: ambientSeed(date, frame.persona, shot.id, aspect, attempts), stock, fetchImpl: input.fetchImpl, signal: input.signal });
    } catch (error) {
      // A render the provider may have billed counts in full.
      costUsd += falUsd; batchSpent += falUsd;
      reasons.push(`${tag}:${error instanceof AmbientRenderError ? error.code : 'ambient-render-failed'}`);
      continue;
    }
    costUsd += falUsd; batchSpent += falUsd;
    let jpeg: Buffer;
    try { jpeg = await gradeAmbientFrame({ source: render.bytes, aspect, grade: shotList.personas[frame.persona].grade, noiseSeed: ambientSeed(shot.id, aspect) }); }
    catch (error) { reasons.push(`${tag}:grade:${error instanceof CropRefused ? 'crop-refused' : 'undecodable'}`); continue; }
    const hash = await ambientPhash(jpeg);
    const found = ambientFormatGate(jpeg, await readAmbientFormat(jpeg), aspect);
    const duplicate = ambientDuplicateGate(hash, hashes);
    if (duplicate) found.push(duplicate);
    if (render.flaggedNsfw) found.push('renderer:nsfw');
    if (!found.length) {
      const look = await inspectAmbientFrame({ jpeg, brief: shot.prompt, apiKey: settings.anthropicKey, model: settings.gateModel, fetchImpl: input.fetchImpl, signal: input.signal });
      costUsd += look.costUsd; batchSpent += look.costUsd;
      found.push(...look.reasons);
    }
    if (found.length) { reasons.push(...found.map((reason) => `${tag}:${reason}`)); continue; }
    const result = await uploadAmbientFrame({ url: settings.ingestUrl, token: settings.ingestToken, jpeg, fetchImpl: input.fetchImpl, signal: input.signal, meta: {
      persona_key: frame.persona, aspect, pillar: shot.pillar, shot_id: shot.id, prompt: shot.prompt, provider: 'fal', model: render.model,
      cost_usd: Number((costUsd + (await priorCost(db, frame.id))).toFixed(6)), seed: render.seed, phash: hash, source_ref: render.sourceRef } });
    const common = { provider: 'fal', model: render.model, phash: hash, sha256: ambientSha256(jpeg), seed: render.seed, source_ref: render.sourceRef };
    if (result.kind === 'stored') return finish('uploaded', { ...common, ingest_id: result.id });
    reasons.push(`ingest:${result.code}`);
    return finish(result.kind === 'duplicate' ? 'duplicate-on-server' : 'upload-failed', common);
  }
  return finish('rejected');
}

async function priorCost(db: Database, id: string): Promise<number> {
  const { data } = await db.from('heydarlink_ambient_frames').select('cost_usd').eq('id', id).maybeSingle();
  return Number(data?.cost_usd ?? 0);
}

/**
 * The low-stock refill: HeyDarlink's unused ready frames per persona, read from `HEYDARLINK_AMBIENT_STOCK_URL` with the
 * same Bearer token. Until that endpoint exists the check is off and batches start by hand. A persona below
 * `AMBIENT_LOW_STOCK` without an open batch gets one, at most once an hour per persona.
 */
export async function refillAmbientStock(db: Database, settings: AmbientSettings, env: Environment, input: { fetchImpl?: typeof fetch; signal?: AbortSignal; now?: () => Date }): Promise<{ checked: boolean; opened: AmbientPersona[] }> {
  const url = env.HEYDARLINK_AMBIENT_STOCK_URL;
  if (!url || !url.startsWith('https://')) return { checked: false, opened: [] };
  const now = input.now?.() ?? new Date();
  const recent = await db.from('heydarlink_ambient_batches').select('persona,created_at,status').gte('created_at', new Date(now.getTime() - 3_600_000).toISOString()).limit(50);
  if (recent.error) return { checked: false, opened: [] };
  let stock: Record<string, unknown>;
  try {
    const response = await (input.fetchImpl ?? fetch)(url, { headers: { Authorization: `Bearer ${settings.ingestToken}` }, redirect: 'error', signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    if (!response.ok) return { checked: false, opened: [] };
    const body = (await response.json()) as { ready?: Record<string, unknown> };
    stock = body.ready ?? {};
  } catch { return { checked: false, opened: [] }; }
  const opened: AmbientPersona[] = [];
  for (const persona of AMBIENT_PERSONAS) {
    const ready = stock[persona];
    if (typeof ready !== 'number' || ready >= AMBIENT_LOW_STOCK) continue;
    if ((recent.data ?? []).some((row) => row.persona === persona)) continue;
    const batch = await openAmbientBatch(db, persona, 'low-stock', ambientBatchCapUsd(env));
    if (batch.created) opened.push(persona);
  }
  return { checked: true, opened };
}
