import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { dneskaiDefaultRevisionFormat } from '@/lib/marketing/dneskai-reel-format';
import { requestDneskaiReelRender } from '@/lib/marketing/dneskai-reel';
const revisionHash='c'.repeat(64);
describe('default format of a new post (#165)', () => {
    it('starts education posts as a Reel and news as a carousel, only while Reels are on', () => {
        const on = { MARKETING_DNESKAI_REELS_ENABLED: 'true' };
        expect(dneskaiDefaultRevisionFormat('carousel', 'tool', on)).toBe('reel');
        expect(dneskaiDefaultRevisionFormat('carousel', 'ai-project', on)).toBe('reel');
        expect(dneskaiDefaultRevisionFormat('carousel', 'ai-news', on)).toBe('carousel');
        expect(dneskaiDefaultRevisionFormat('carousel', 'tool', {})).toBe('carousel');
        expect(dneskaiDefaultRevisionFormat('single-image', 'tool', on)).toBe('post');
    });
});
describe('requestDneskaiReelRender', () => {
    const secret = 's'.repeat(40);
    const ownerId = '11111111-1111-4111-8111-111111111111';
    afterEach(() => vi.restoreAllMocks());
    const revisionId = '22222222-2222-4222-8222-222222222222';
    it('posts a scheduler-signed async request to this deployment and accepts 202', async () => {
        const fetcher = vi.fn(async () => Response.json({ status: 'accepted', ownerId, revisionId, revisionHash, audioTrackId: null }, { status: 202 }));
        expect(await requestDneskaiReelRender({ origin: 'https://own.example', revisionId, revisionHash, audioTrackId: null, env: { MARKETING_SCHEDULER_SECRET: secret, MARKETING_OWNER_ID: ownerId }, fetcher })).toBe(true);
        const [url, init] = fetcher.mock.calls[0]! as unknown as [
            string,
            RequestInit & {
                headers: Record<string, string>;
            }
        ];
        expect(url).toBe('https://own.example/api/marketing/dneskai/render-reel');
        expect(JSON.parse(String(init.body))).toEqual({ revisionId, revisionHash, audioTrackId: null, async: true });
        const time = init.headers['X-Marketing-Timestamp'];
        expect(init.headers['X-Marketing-Signature']).toBe(createHmac('sha256', secret).update(`${time}.${init.body}`).digest('hex'));
    });
    it('sends nothing without a usable secret or to a plain-http host, and reports a refusal', async () => {
        const fetcher = vi.fn(async () => new Response('{}', { status: 404 }));
        expect(await requestDneskaiReelRender({ origin: 'https://own.example', revisionId, revisionHash, audioTrackId: null, env: {}, fetcher })).toBe(false);
        expect(await requestDneskaiReelRender({ origin: 'http://own.example', revisionId, revisionHash, audioTrackId: null, env: { MARKETING_SCHEDULER_SECRET: secret, MARKETING_OWNER_ID: ownerId }, fetcher })).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
        expect(await requestDneskaiReelRender({ origin: 'https://own.example', revisionId, revisionHash, audioTrackId: null, env: { MARKETING_SCHEDULER_SECRET: secret, MARKETING_OWNER_ID: ownerId }, fetcher })).toBe(false);
    });
    it.each([
        { status: 200, body: { status: 'accepted', ownerId, revisionId, revisionHash, audioTrackId: null } },
        { status: 202, body: { status: 'rendering' } },
        { status: 202, body: { status: 'accepted', ownerId: '33333333-3333-4333-8333-333333333333', revisionId, revisionHash, audioTrackId: null } },
        { status: 202, body: { status: 'accepted', ownerId, revisionHash, revisionId: '33333333-3333-4333-8333-333333333333', audioTrackId: null } },
        { status: 202, body: { status: 'accepted', ownerId, revisionId, revisionHash, audioTrackId: '33333333-3333-4333-8333-333333333333' } },
        { status: 202, body: { status: 'accepted', ownerId, revisionId, revisionHash, audioTrackId: null, extra: true } },
    ])('refuses uncorrelated or non-accepted successful HTTP responses: %#', async ({ status, body }) => {
        const fetcher = vi.fn(async () => Response.json(body, { status }));
        expect(await requestDneskaiReelRender({ origin: 'https://own.example', revisionId, revisionHash, audioTrackId: null, env: { MARKETING_SCHEDULER_SECRET: secret, MARKETING_OWNER_ID: ownerId }, fetcher })).toBe(false);
        expect(fetcher).toHaveBeenCalledOnce();
    });
});
describe('scoped render acceptance transport', () => {
    const ownerId = '11111111-1111-4111-8111-111111111111', revisionId = '22222222-2222-4222-8222-222222222222', audioTrackId = '33333333-3333-4333-8333-333333333333', env = { MARKETING_OWNER_ID: ownerId, MARKETING_SCHEDULER_SECRET: 'TEST_ONLY_SCHEDULER_SECRET_NOT_REAL' }, ack = () => ({ status: 'accepted', ownerId, revisionId, revisionHash, audioTrackId });
    const input = () => ({ origin: 'https://own.example', revisionId, revisionHash, audioTrackId, env });
    afterEach(() => vi.restoreAllMocks());
    it('correlates an explicit track under the caller lifetime without a retry', async () => {
        const caller = new AbortController(), fetcher = vi.fn(async () => Response.json(ack(), { status: 202 }));
        expect(await requestDneskaiReelRender({ ...input(), signal: caller.signal, fetcher })).toBe(true);
        expect(fetcher).toHaveBeenCalledOnce();
    });
    it.each(['ftp://localhost', 'http://own.example', 'https://user:password@own.example', 'https://own.example/path', 'https://own.example?target=other', 'https://own.example#other'])('sends no credentials to an invalid deployment origin: %s', async (origin) => {
        const fetcher = vi.fn();
        expect(await requestDneskaiReelRender({ ...input(), origin, fetcher })).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it.each([{ MARKETING_OWNER_ID: 'bad', MARKETING_SCHEDULER_SECRET: env.MARKETING_SCHEDULER_SECRET }, { MARKETING_SCHEDULER_SECRET: env.MARKETING_SCHEDULER_SECRET }])('requires a configured original owner before signing: %#', async (env) => {
        const fetcher = vi.fn();
        expect(await requestDneskaiReelRender({ ...input(), env, fetcher })).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('refuses a retired caller or invalid captured revision before transport', async () => {
        const caller = new AbortController(), fetcher = vi.fn();
        caller.abort('TEST_ONLY_PRIVATE_REASON');
        expect(await requestDneskaiReelRender({ ...input(), signal: caller.signal, fetcher })).toBe(false);
        expect(await requestDneskaiReelRender({ ...input(), revisionId: 'bad', fetcher })).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
    });
    it.each(['metadata', 'body'] as const)('bounds uncooperative %s under one ten-second scope', async (phase) => {
        const deadline = new AbortController();
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
        const pull = vi.fn(), cancel = vi.fn(() => new Promise<void>(() => {
        }));
        const fetcher = vi.fn(async () => phase === 'metadata' ? new Promise<Response>(() => {
        }) : new Response(new ReadableStream({ pull, cancel },{highWaterMark:0}), { status: 202, headers: { 'content-type': 'application/json' } }));
        const pending = requestDneskaiReelRender({ ...input(), fetcher });
        await vi.waitFor(() => expect(phase === 'body' ? pull : fetcher).toHaveBeenCalledOnce());
        deadline.abort('TEST_ONLY_PRIVATE_REASON');
        expect(await pending).toBe(false);
        expect(fetcher).toHaveBeenCalledOnce();
        if (phase === 'body')
            expect(cancel).toHaveBeenCalledOnce();
    });
    it('discards a late response after the original caller retires', async () => {
        const caller = new AbortController();
        let resolve!: (response: Response) => void;
        const fetcher = vi.fn(() => new Promise<Response>(done => {
            resolve = done;
        })), cancel = vi.fn();
        const pending = requestDneskaiReelRender({ ...input(), signal: caller.signal, fetcher });
        caller.abort('TEST_ONLY_PRIVATE_REASON');
        expect(await pending).toBe(false);
        resolve(new Response(new ReadableStream({ cancel }), { status: 202, headers: { 'content-type': 'application/json' } }));
        await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    });
    it.each([
        () => new Response('x'.repeat(1025), { status: 202, headers: { 'content-type': 'application/json' } }),
        () => new Response(new Uint8Array([0xc3, 0x28]), { status: 202, headers: { 'content-type': 'application/json' } }),
        () => new Response('{}', { status: 202, headers: { 'content-type': 'text/html' } }),
        () => new Response('{}', { status: 202, headers: { 'content-type': 'application/json', 'content-length': '1025' } }),
        () => new Response(null, { status: 202, headers: { 'content-type': 'application/json' } }),
        () => new Response('not-json', { status: 202, headers: { 'content-type': 'application/json' } }),
    ])('refuses incomplete, oversized or malformed acknowledgement bodies: %#', async (response) => {
        const fetcher = vi.fn(async () => response());
        expect(await requestDneskaiReelRender({ ...input(), fetcher })).toBe(false);
        expect(fetcher).toHaveBeenCalledOnce();
    });
    it('discards a nonaccepted error body without reading or exposing it', async () => {
        const pull = vi.fn(), cancel = vi.fn();
        const fetcher = vi.fn(async () => new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { status: 503 }));
        expect(await requestDneskaiReelRender({ ...input(), fetcher })).toBe(false);
        expect(pull).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
    });
});
it('discards a response if cancellation arrives between response admission and reading', async () => {
    const caller = new AbortController(), cancel = vi.fn(), response = new Response(new ReadableStream({ cancel }), { status: 202, headers: { 'content-type': 'application/json' } });
    const original = response.headers.get.bind(response.headers);
    vi.spyOn(response.headers, 'get').mockImplementation(name => {
        caller.abort('TEST_ONLY_PRIVATE_REASON');
        return original(name);
    });
    const fetcher = vi.fn(async () => response);
    expect(await requestDneskaiReelRender({
        origin: 'https://own.example', revisionId: '22222222-2222-4222-8222-222222222222', revisionHash, audioTrackId: null, signal: caller.signal, env: { MARKETING_OWNER_ID: '11111111-1111-4111-8111-111111111111', MARKETING_SCHEDULER_SECRET: 'TEST_ONLY_SCHEDULER_SECRET_NOT_REAL' }, fetcher
    })).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
});

it.each([undefined,'','BAD','A'.repeat(64)])('sends no request for an invalid captured revision hash: %s',async revisionHash=>{
 const fetcher=vi.fn();expect(await requestDneskaiReelRender({origin:'https://own.example',revisionId:'22222222-2222-4222-8222-222222222222',revisionHash:revisionHash as string,audioTrackId:null,env:{MARKETING_OWNER_ID:'11111111-1111-4111-8111-111111111111',MARKETING_SCHEDULER_SECRET:'TEST_ONLY_SCHEDULER_SECRET_NOT_REAL'},fetcher})).toBe(false);expect(fetcher).not.toHaveBeenCalled();
});
it('refuses an accepted response for a different captured revision hash',async()=>{
 const ownerId='11111111-1111-4111-8111-111111111111',revisionId='22222222-2222-4222-8222-222222222222',fetcher=vi.fn(async()=>Response.json({status:'accepted',ownerId,revisionId,revisionHash:'f'.repeat(64),audioTrackId:null},{status:202}));
 expect(await requestDneskaiReelRender({origin:'https://own.example',revisionId,revisionHash,audioTrackId:null,env:{MARKETING_OWNER_ID:ownerId,MARKETING_SCHEDULER_SECRET:'TEST_ONLY_SCHEDULER_SECRET_NOT_REAL'},fetcher})).toBe(false);expect(fetcher).toHaveBeenCalledOnce();
});
