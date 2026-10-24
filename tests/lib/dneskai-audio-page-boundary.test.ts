import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { listDneskaiAudioPage, listDneskaiAudioTracks } from '@/lib/marketing/dneskai-audio';
vi.mock('server-only', () => ({}));
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function row(number = 1) {
  return { id: id(number), user_id: owner, title: `Fixture ${number}`, artist: 'Fixture artist', source: 'original', licence_note: 'Own fixture', source_url: 'https://example.test/source', storage_path: `marketing-audio/${owner}/${id(number)}.mp3`, instagram_audio_id: null,
    duration_ms: 60000, mood: ['calm'], enabled: true, created_at: '2026-10-24T10:00:00.000001+00:00' };
}
type SignedEntry = { path: string; error: string | null; signedURL: string | null };
let values: unknown[], total: number | null, databaseStatus: number, signingStatus: number, databaseRequests: URL[], signedNames: string[][];
let signing: ((entries: SignedEntry[]) => unknown) | undefined;
let fetchRead: (() => Promise<Response>) | undefined;
const client = createClient('https://audio-page-fixture.supabase.co', 'TEST-ONLY-service-role', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/marketing_audio_tracks') {
      databaseRequests.push(url); if (fetchRead) return fetchRead();
      return Response.json(databaseStatus === 200 ? values : { message: 'synthetic private detail' }, { status: databaseStatus,
        headers: { 'Content-Range': `0-${Math.max(0, values.length - 1)}/${total ?? '*'}` } });
    }
    if (url.pathname === '/storage/v1/object/sign/marketing-audio') {
      const body = JSON.parse(String(init?.body)) as { paths: string[] }; signedNames.push(body.paths);
      const entries = body.paths.map(path => ({ path, error: null, signedURL: `/object/sign/marketing-audio/${path}?token=TEST-ONLY` }));
      return Response.json(signingStatus === 200 ? signing?.(entries) ?? entries : { message: 'synthetic private detail' }, { status: signingStatus });
    }
    throw new Error('Unexpected fixture request');
  } },
});
beforeEach(() => { values = [row()]; total = 1; databaseStatus = 200; signingStatus = 200; databaseRequests = []; signedNames = []; signing = undefined; fetchRead = undefined; });
afterEach(() => vi.restoreAllMocks());
const unavailable = async (pending: Promise<unknown>) => {
  const result = await pending.then(() => ({ code: 'unexpected-success', message: '' }), error => ({ code: error.code, message: error.message }));
  expect(result).toEqual({ code: 'audio-library-unavailable', message: 'audio-library-unavailable' });
};
it('reads one owner-scoped exact-count page, validates its sentinel, and signs only the displayed 200 files in one request', async () => {
  values = Array.from({ length: 201 }, (_, at) => row(at + 1)); total = 401;
  const page = await listDneskaiAudioPage(client, owner);
  expect(page.tracks.length).toBe(200); expect(page.nextOffset).toBe(200); expect(signedNames).toHaveLength(1); expect(signedNames[0]).toHaveLength(200);
  const query = databaseRequests[0]!.searchParams;
  expect(query.get('user_id')).toBe(`eq.${owner}`); expect(query.get('order')).toBe('created_at.asc,id.asc'); expect(query.get('limit')).toBe('201'); expect(databaseRequests).toHaveLength(1);
});
it.each([null, -1, 2, 201, 401])('refuses a missing or inconsistent exact count %s rather than showing an incomplete page', async count => {
  total = count; await unavailable(listDneskaiAudioPage(client, owner)); expect(signedNames).toEqual([]);
});
it('detects a backend row cap below the requested page size', async () => {
  values = Array.from({ length: 50 }, (_, at) => row(at + 1)); total = 401;
  await unavailable(listDneskaiAudioPage(client, owner)); expect(signedNames).toEqual([]);
});
it.each([
  ['malformed timestamp', { created_at: 'invalid' }], ['non-Postgres timestamp precision', { created_at: '2026-10-24T10:00:00.0000001Z' }],
  ['foreign owner', { user_id: other }], ['unsafe source URL', { source_url: 'https://user:password@example.test/source' }], ['null mood', { mood: null }],
  ['wrong object identity', { storage_path: `marketing-audio/${owner}/${id(2)}.mp3` }], ['foreign object owner', { storage_path: `marketing-audio/${other}/${id(1)}.mp3` }],
  ['traversal suffix', { storage_path: `marketing-audio/${owner}/${id(1)}.mp3/../other` }], ['unsupported extension', { storage_path: `marketing-audio/${owner}/${id(1)}.html` }],
  ['missing file identity', { storage_path: null }], ['Instagram source without its remote identity', { source: 'instagram-library', storage_path: null }],
] as const)('refuses %s before signing or dropping any row', async (_name, change) => {
  values = [{ ...row(), ...change }]; await unavailable(listDneskaiAudioPage(client, owner)); expect(signedNames).toEqual([]);
});
it('checks the extra sentinel instead of hiding a malformed next page', async () => {
  values = [...Array.from({ length: 200 }, (_, at) => row(at + 1)), { ...row(201), duration_ms: -1 }]; total = 201;
  await unavailable(listDneskaiAudioPage(client, owner)); expect(signedNames).toEqual([]);
});
it.each(['duplicate', 'reversed'] as const)('refuses %s row identities/order before signing', async kind => {
  values = kind === 'duplicate' ? [row(), row()] : [row(2), row(1)]; total = 2;
  await unavailable(listDneskaiAudioPage(client, owner)); expect(signedNames).toEqual([]);
});
it('preserves database microsecond ordering when id order differs inside one JavaScript millisecond', async () => {
  values = [row(2), { ...row(1), created_at: '2026-10-24T10:00:00.000002+00:00' }]; total = 2;
  const page = await listDneskaiAudioPage(client, owner); expect(page.tracks.map(track => track.id)).toEqual([id(2), id(1)]); expect(page.nextOffset).toBeNull();
});
it('retains Instagram rows without requesting file URLs', async () => {
  values = [{ ...row(), source: 'instagram-library', storage_path: null, source_url: null, instagram_audio_id: '123' }];
  const page = await listDneskaiAudioPage(client, owner); expect(page.tracks.map(track => [track.id, track.previewUrl])).toEqual([[id(1), null]]); expect(signedNames).toEqual([]);
});
it.each(['missing', 'duplicate', 'foreign-path', 'unsafe-url'] as const)('refuses a malformed signing batch (%s)', async kind => {
  values = [row(), row(2)]; total = 2;
  signing = entries => kind === 'missing' ? entries.slice(0, 1) : kind === 'duplicate' ? [entries[0], entries[0]] : kind === 'foreign-path' ? [{ ...entries[0], path: `${other}/${id(1)}.mp3` }, entries[1]]
    : [{ ...entries[0], signedURL: '//wrong host' }, entries[1]];
  await unavailable(listDneskaiAudioPage(client, owner));
});
it('keeps a track visible with an unavailable individual preview, while refusing a failed whole signing request', async () => {
  signing = entries => entries.map(entry => ({ ...entry, error: 'synthetic object unavailable', signedURL: null }));
  const page = await listDneskaiAudioPage(client, owner); expect(page.tracks.map(track => [track.id, track.previewUrl])).toEqual([[id(1), null]]);
  signingStatus = 503; await unavailable(listDneskaiAudioPage(client, owner));
});
it('refuses database outages once without retrying or signing', async () => {
  databaseStatus = 503; await unavailable(listDneskaiAudioPage(client, owner)); expect(databaseRequests).toHaveLength(1); expect(signedNames).toEqual([]);
});
it('distinguishes confirmed selected-track absence from missing counts or mismatched identities', async () => {
  values = []; total = 0; expect(await listDneskaiAudioTracks(client, owner, id(1))).toEqual([]); expect(signedNames).toEqual([]);
  values = [row(2)]; total = 1; await unavailable(listDneskaiAudioTracks(client, owner, id(1)));
  values = [row(1)]; total = null; await unavailable(listDneskaiAudioTracks(client, owner, id(1)));
  total = 1; const found = await listDneskaiAudioTracks(client, owner, id(1)); expect(found.map(track => track.id)).toEqual([id(1)]); expect(databaseRequests.at(-1)!.searchParams.get('id')).toBe(`eq.${id(1)}`);
});
it('does no request for cancelled or invalid selectors and never exposes a caller abort reason', async () => {
  const controller = new AbortController(); controller.abort('synthetic private reason');
  await expect(listDneskaiAudioPage(client, owner, 0, controller.signal)).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' });
  await expect(listDneskaiAudioTracks(client, owner, '')).rejects.toThrow(); expect(databaseRequests).toEqual([]); expect(signedNames).toEqual([]);
});
it('bounds a stalled SDK read even if its transport ignores cancellation', async () => {
  const controller = new AbortController(); vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal); fetchRead = () => new Promise(() => {});
  const pending = listDneskaiAudioPage(client, owner); await vi.waitFor(() => expect(databaseRequests).toHaveLength(1)); controller.abort('synthetic private reason');
  await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Request aborted' }); expect(databaseRequests).toHaveLength(1); expect(signedNames).toEqual([]);
});
