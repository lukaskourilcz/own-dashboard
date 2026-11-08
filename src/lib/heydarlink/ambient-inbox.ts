import 'server-only';
import sharp from 'sharp';
import type { createAdminClient } from '@/lib/supabase/admin';
import { AMBIENT_GATE, AMBIENT_PERSONAS, AMBIENT_SIZES, type AmbientAspect, type AmbientPersona, type AmbientSettings } from './ambient-config';
import { ambientDuplicateGate, ambientFormatGate, inspectAmbientFrame, readAmbientFormat } from './ambient-gates';
import { ambientPhash } from './ambient-phash';
import { ambientSha256, uploadAmbientFrame } from './ambient-ingest';

/**
 * The owner's own ambient pictures (owner decision, 8 November 2026): Lukáš makes plan frames elsewhere (Codex) and
 * drops them into the private Storage bucket `heydarlink-ambient-inbox` as `<girl>__<shot_id>.jpg`, the shot id being
 * the plan ref's slug. Each ambient tick takes the next files: it crops and scales them to 1080x1350 or 1080x1920,
 * runs the duplicate check, the format check and Claude's look (people, faces, body parts, readable text, logos, NSFW)
 * and sends the passing ones to HeyDarlink's ingest under that shot id. A file then moves to `done/` or `rejected/`,
 * and `heydarlink_ambient_imports` keeps what happened. Keys never leave the server.
 */
type Database = ReturnType<typeof createAdminClient>;
export const AMBIENT_INBOX_BUCKET = 'heydarlink-ambient-inbox';
export const AMBIENT_INBOX_REVIEWED = 'reviewed';
const NAME = /^(nina|fatimah|teresa|michaela)__([a-z0-9-]{3,60})(?:__(4x5|9x16))?\.(?:jpe?g|png|webp)$/u;
const MAX_BYTES = 20_000_000;

export type AmbientInboxName = { persona: AmbientPersona; shotId: string; aspect: AmbientAspect | null };
/** `<girl>__<shot_id>[__4x5|__9x16].jpg`, or null for any other name. */
export function parseAmbientInboxName(name: string): AmbientInboxName | null {
  const match = NAME.exec(name);
  if (!match || !(AMBIENT_PERSONAS as readonly string[]).includes(match[1]!)) return null;
  return { persona: match[1] as AmbientPersona, shotId: match[2]!, aspect: match[3] === '9x16' ? '9:16' : match[3] === '4x5' ? '4:5' : null };
}

/** Without a suffix the picture's own shape decides: taller than 2:3 is a story, anything else a feed post. */
export function ambientInboxAspect(width: number, height: number): AmbientAspect {
  return height / width >= 1.5 ? '9:16' : '4:5';
}

/** Cover-crops and scales to the aspect's size, as a JPEG the format gate accepts. */
export async function fitAmbientInboxPicture(bytes: Uint8Array, aspect: AmbientAspect): Promise<Buffer> {
  const { width, height } = AMBIENT_SIZES[aspect];
  return sharp(bytes).rotate().resize(width, height, { fit: 'cover', position: 'attention', kernel: 'lanczos3' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

const PILLARS: ReadonlyArray<readonly [string, RegExp]> = [
  ['food', /pasta|tomato|pancake|kolach|dates|market|apple|basil|bread|cake/u], ['drinks', /coffee|wine|beer|cocktail|aperol|pint|thermos|spritz|tea|latte/u],
  ['books', /book|textbook|reading/u], ['flatlay', /flat-lay/u], ['flowers', /flower/u], ['outfit', /dress|heels|garment|sunglasses|towel/u],
  ['sunset', /sunset|golden-hour|dusk/u], ['interiors', /room|hotel|desk|kitchen|window|ring-light|studio|bed/u], ['views', /skyline|view|bridge|dune|desert|fields|marina|harbour|houses/u],
];
/** The shot list's pillar a shot id reads as; `city` when none fits. */
export const ambientInboxPillar = (shotId: string) => PILLARS.find(([, pattern]) => pattern.test(shotId))?.[0] ?? 'city';

export type AmbientInboxResult = { taken: number; uploaded: number; rejected: number; costUsd: number };

export async function processAmbientInbox(db: Database, settings: AmbientSettings, input: { signal: AbortSignal; remainingMs: () => number; fetchImpl?: typeof fetch; now?: () => Date }): Promise<AmbientInboxResult> {
  const result: AmbientInboxResult = { taken: 0, uploaded: 0, rejected: 0, costUsd: 0 };
  // `reviewed/` holds pictures the owner's agent already looked at (owner decision, 8 November 2026): they skip
  // Claude's paid look and keep every free check. Those go first.
  const files: Array<{ name: string; path: string; reviewed: boolean }> = [];
  for (const folder of [AMBIENT_INBOX_REVIEWED, ''] as const) {
    const listed = await db.storage.from(AMBIENT_INBOX_BUCKET).list(folder, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
    if (listed.error) continue;
    for (const item of listed.data ?? []) if (item.id && item.name) files.push({ name: item.name, path: folder ? `${folder}/${item.name}` : item.name, reviewed: !!folder });
  }
  for (const file of files) {
    // About 25 seconds a picture: the download, the gate and the upload.
    if (input.remainingMs() < 25_000 || input.signal.aborted) break;
    const parsed = parseAmbientInboxName(file.name);
    const now = (input.now?.() ?? new Date()).toISOString();
    const gate = file.reviewed ? 'owner-reviewed' : 'claude';
    const record = async (status: string, patch: Record<string, unknown>) => {
      await db.from('heydarlink_ambient_imports').upsert({ name: file.path, persona: parsed?.persona ?? null, shot_id: parsed?.shotId ?? null, status, gate, updated_at: now, ...patch }, { onConflict: 'name' });
      await db.storage.from(AMBIENT_INBOX_BUCKET).move(file.path, `${status === 'uploaded' ? 'done' : 'rejected'}/${file.name}`);
    };
    result.taken++;
    if (!parsed) { result.rejected++; await record('rejected', { reasons: ['inbox:name'] }); continue; }
    const download = await db.storage.from(AMBIENT_INBOX_BUCKET).download(file.path);
    if (download.error || !download.data) continue;
    const source = new Uint8Array(await download.data.arrayBuffer());
    if (source.byteLength > MAX_BYTES) { result.rejected++; await record('rejected', { reasons: ['inbox:too-large'] }); continue; }
    let jpeg: Buffer, aspect: AmbientAspect;
    try {
      const meta = await sharp(source).metadata();
      if (!meta.width || !meta.height) throw new Error('size');
      aspect = parsed.aspect ?? ambientInboxAspect(meta.width, meta.height);
      jpeg = await fitAmbientInboxPicture(source, aspect);
    } catch { result.rejected++; await record('rejected', { reasons: ['inbox:undecodable'] }); continue; }
    const hash = await ambientPhash(jpeg);
    const since = new Date((input.now?.() ?? new Date()).getTime() - AMBIENT_GATE.historyDays * 86_400_000).toISOString();
    const [frames, imports] = await Promise.all([
      db.from('heydarlink_ambient_frames').select('phash').eq('status', 'uploaded').gte('updated_at', since).not('phash', 'is', null).limit(2000),
      db.from('heydarlink_ambient_imports').select('phash').eq('status', 'uploaded').gte('updated_at', since).not('phash', 'is', null).limit(2000),
    ]);
    if (frames.error || imports.error) break;
    const found = ambientFormatGate(jpeg, await readAmbientFormat(jpeg), aspect);
    const duplicate = ambientDuplicateGate(hash, [...(frames.data ?? []), ...(imports.data ?? [])].map((row) => row.phash as string));
    if (duplicate) found.push(duplicate);
    // The plan ref is the brief: the shot id with its words back.
    const brief = `Candid phone photo of ${parsed.shotId.replace(/^new-ambient-9-16-/u, '').replaceAll('-', ' ')}, with no people, no faces, no text and no logos.`;
    let costUsd = 0;
    if (!found.length && !file.reviewed) {
      const look = await inspectAmbientFrame({ jpeg, brief, apiKey: settings.anthropicKey, model: settings.gateModel, fetchImpl: input.fetchImpl, signal: input.signal });
      costUsd = look.costUsd; result.costUsd += look.costUsd;
      found.push(...look.reasons);
    }
    const common = { aspect, phash: hash, sha256: ambientSha256(jpeg), cost_usd: Number(costUsd.toFixed(6)) };
    if (found.length) { result.rejected++; await record('rejected', { ...common, reasons: found.slice(0, 40) }); continue; }
    const sent = await uploadAmbientFrame({ url: settings.ingestUrl, token: settings.ingestToken, jpeg, fetchImpl: input.fetchImpl, signal: input.signal, meta: {
      persona_key: parsed.persona, aspect, pillar: ambientInboxPillar(parsed.shotId), shot_id: parsed.shotId, prompt: brief, provider: 'openai', model: 'owner-codex',
      cost_usd: Number(costUsd.toFixed(6)), seed: null, phash: hash, source_ref: null } });
    if (sent.kind === 'stored') { result.uploaded++; await record('uploaded', { ...common, reasons: [], ingest_id: sent.id }); continue; }
    // HeyDarlink takes provider fal, openai or gemini, and a source_ref only as pexels:<id> or pixabay:<id> (none here); the owner's pictures come from Codex, which draws with OpenAI.
    // A failed upload stays in the inbox for the next tick; a duplicate the server already holds is done, and so is
    // a refusal no retry can change (a 4xx other than 429), so one bad file never holds the rest.
    if (sent.kind === 'failed' && sent.status >= 400 && sent.status < 500 && sent.status !== 429) { result.rejected++; await record('rejected', { ...common, reasons: [`ingest:${sent.code}`] }); continue; }
    if (sent.kind === 'duplicate') { result.rejected++; await record('rejected', { ...common, reasons: [`ingest:${sent.code}`] }); continue; }
    await db.from('heydarlink_ambient_imports').upsert({ name: file.path, persona: parsed.persona, shot_id: parsed.shotId, status: 'upload-failed', gate, reasons: [`ingest:${sent.code}`], updated_at: now, ...common }, { onConflict: 'name' });
    break;
  }
  return result;
}
