import 'server-only';
import { createHash } from 'node:crypto';
import type { AmbientAspect, AmbientPersona } from './ambient-config';

/**
 * The upload to HeyDarlink's `POST /api/photo-library/ambient` (repo mikeyrotten/phone-app). Authentication is
 * `Authorization: Bearer <HEYDARLINK_INGEST_TOKEN>`, compared in constant time on the server. The body is multipart:
 * the JPEG as `file`, one text field per metadata value and `sha256` of the exact bytes, which the server recomputes.
 * The contract is unchanged from Quorum's uploader; only the sender moved.
 */
export type AmbientIngestMetadata = {
  persona_key: AmbientPersona; aspect: AmbientAspect; pillar: string; shot_id: string; prompt: string;
  provider: string; model: string; cost_usd: number; seed: number | null; phash: string; source_ref: string | null;
};
export type AmbientIngestResult = { kind: 'stored'; id: string } | { kind: 'duplicate'; id: string | null; code: string } | { kind: 'failed'; status: number; code: string };

export const ambientSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function ambientIngestForm(jpeg: Uint8Array, meta: AmbientIngestMetadata): FormData {
  const form = new FormData();
  form.set('persona_key', meta.persona_key);
  form.set('aspect', meta.aspect);
  form.set('pillar', meta.pillar);
  form.set('shot_id', meta.shot_id);
  form.set('prompt', meta.prompt);
  form.set('provider', meta.provider);
  form.set('model', meta.model);
  form.set('cost_usd', meta.cost_usd.toFixed(6));
  if (meta.seed !== null) form.set('seed', String(meta.seed));
  form.set('phash', meta.phash);
  form.set('sha256', ambientSha256(jpeg));
  if (meta.source_ref) form.set('source_ref', meta.source_ref);
  form.set('file', new Blob([Buffer.from(jpeg)], { type: 'image/jpeg' }), `${meta.shot_id}-${meta.aspect.replace(':', 'x')}.jpg`);
  return form;
}

/**
 * 200 stored, 409 a duplicate the server already holds, anything else a failure. 429 and 5xx are retried with a short
 * backoff inside the tick's budget; other 4xx are a client bug or a wrong token, and repeating them would not help.
 * HTTPS only: the token never travels in clear text.
 */
export async function uploadAmbientFrame(input: { url: string; token: string; jpeg: Uint8Array; meta: AmbientIngestMetadata; fetchImpl?: typeof fetch; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> }): Promise<AmbientIngestResult> {
  let target: URL;
  try { target = new URL(input.url); if (target.protocol !== 'https:') throw new Error('http'); }
  catch { return { kind: 'failed', status: 0, code: 'INVALID_URL' }; }
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: AmbientIngestResult = { kind: 'failed', status: 0, code: 'NOT_ATTEMPTED' };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await (input.fetchImpl ?? fetch)(target.toString(), {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${input.token}` }, body: ambientIngestForm(input.jpeg, input.meta),
        signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      });
      const payload = (await response.json().catch(() => ({}))) as { id?: unknown; code?: unknown };
      const code = typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`;
      if (response.status === 200 && typeof payload.id === 'string') return { kind: 'stored', id: payload.id };
      if (response.status === 409) return { kind: 'duplicate', id: typeof payload.id === 'string' ? payload.id : null, code };
      last = { kind: 'failed', status: response.status, code };
      if (response.status !== 429 && response.status < 500) return last;
    } catch { last = { kind: 'failed', status: 0, code: 'NETWORK' }; }
    await sleep(2_000);
  }
  return last;
}
