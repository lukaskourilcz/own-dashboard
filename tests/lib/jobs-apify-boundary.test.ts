import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { apifyTaskIds, normalizeApifyJob, fetchApifyTaskSnapshot, fetchApifyTask } from '@/lib/jobs/apify';
const now = Date.parse('2026-10-25T12:00:00Z'), task = 'SyntheticTask';
let network: ReturnType<typeof vi.fn>;
const meta = (finishedAt = new Date(now - 1000).toISOString()) => ({ data: { id: 'SyntheticRun', actorTaskId: task, startedAt: new Date(now - 2000).toISOString(), finishedAt, status: 'SUCCEEDED', defaultDatasetId: 'SyntheticDataset' } });
const items = (rows: unknown[] = [], total = rows.length) => Response.json(rows, { headers: { 'x-apify-pagination-offset': '0', 'x-apify-pagination-limit': '1001', 'x-apify-pagination-count': String(rows.length), 'x-apify-pagination-total': String(total) } });
beforeEach(() => { vi.stubEnv('APIFY_TOKEN', 'TEST-ONLY-Apify'); vi.spyOn(Date, 'now').mockReturnValue(now); network = vi.fn().mockResolvedValueOnce(Response.json(meta())).mockResolvedValueOnce(items()); vi.stubGlobal('fetch', network); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('refuses a future completion before reading its dataset', async () => {
 network.mockReset().mockResolvedValueOnce(Response.json(meta(new Date(now + 1000).toISOString()))).mockResolvedValueOnce(items());
 await expect(fetchApifyTask(task)).rejects.toThrow(); expect(network).toHaveBeenCalledOnce();
});
it('refuses a partial dataset rather than returning an invented complete success', async () => {
 network.mockReset().mockResolvedValueOnce(Response.json(meta())).mockResolvedValueOnce(items([], 1002));
 await expect(fetchApifyTask(task)).rejects.toThrow(); expect(network).toHaveBeenCalledTimes(2);
});
it('keeps a complete recent empty dataset as a truthful success with GET-only captured authority', async () => {
 await expect(fetchApifyTask(task)).resolves.toEqual([]); expect(network).toHaveBeenCalledTimes(2);
 for (const [url, init] of network.mock.calls) { expect(url).toMatch(/^https:\/\/api\.apify\.com\/v2\/(?:actor-tasks|datasets)\//); expect(url).not.toContain('TEST-ONLY-Apify'); expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store' }); expect(new Headers(init.headers).get('authorization')).toBe('Bearer TEST-ONLY-Apify'); expect(init.signal.aborted).toBe(true); }
 expect(network.mock.calls[1][0]).toContain('clean=false&skipHidden=true&format=json&offset=0&limit=1001');
});
it.each(['missing-run', 'status', 'run-id', 'task-id', 'dataset-id', 'old', 'invalid-date', 'start-after-finish'] as const)('refuses uncertain saved-run metadata before dataset reads: %s', async kind => {
 const run = meta().data;
 const invalid = kind === 'missing-run' ? {} : { data: { ...run, ...(kind === 'status' ? { status: 'RUNNING' } : kind === 'run-id' ? { id: '../private' } : kind === 'task-id' ? { actorTaskId: 'DifferentTask' } : kind === 'dataset-id' ? { defaultDatasetId: '../private' } : kind === 'old' ? { finishedAt: new Date(now - 86_400_001).toISOString(), startedAt: new Date(now - 86_401_001).toISOString() } : kind === 'invalid-date' ? { finishedAt: '2026-02-30T12:00:00Z' } : { startedAt: new Date(now + 1000).toISOString() }) } };
 network.mockReset().mockResolvedValue(Response.json(invalid)); await expect(fetchApifyTask(task)).rejects.toThrow('career-apify-unavailable'); expect(network).toHaveBeenCalledOnce();
});
it.each(['headers', 'offset', 'count', 'limit', 'wrong-total', 'over-cap', 'null-row', 'nested-row', 'bad-json', 'oversized'] as const)('refuses partial or malformed dataset evidence: %s', async kind => {
 const response = kind === 'headers' ? Response.json([]) : kind === 'null-row' ? items([null]) : kind === 'nested-row' ? items([[]]) : kind === 'over-cap' ? items(Array.from({ length: 1001 }, () => ({}))) : kind === 'bad-json' ? new Response('{') : kind === 'oversized' ? new Response(' '.repeat(8_388_609)) : items();
 if (kind === 'offset') response.headers.set('x-apify-pagination-offset', '1');
 if (kind === 'count') response.headers.set('x-apify-pagination-count', '1');
 if (kind === 'limit') response.headers.set('x-apify-pagination-limit', '1000');
 if (kind === 'wrong-total') response.headers.set('x-apify-pagination-total', 'garbage');
 network.mockReset().mockResolvedValueOnce(Response.json(meta())).mockResolvedValueOnce(response); await expect(fetchApifyTask(task)).rejects.toThrow('career-apify-unavailable'); expect(network).toHaveBeenCalledTimes(2);
});
it.each(['', '../private', 'owner~task~extra', 'A'.repeat(129)])('refuses invalid task identity (%#) before sending a request', async value => { await expect(fetchApifyTask(value)).rejects.toThrow('career-apify-unavailable'); expect(network).not.toHaveBeenCalled(); });
it('accepts a named task through its scoped endpoint while retaining its canonical returned task ID', async () => {
 network.mockReset().mockResolvedValueOnce(Response.json(meta())).mockResolvedValueOnce(items()); await expect(fetchApifyTask('owner~synthetic-task')).resolves.toEqual([]); expect(network.mock.calls[0][0]).toContain('/actor-tasks/owner~synthetic-task/runs/last?status=SUCCEEDED');
});
it('does not expose a missing credential or provider details', async () => {
 vi.stubEnv('APIFY_TOKEN', ''); await expect(fetchApifyTask(task)).rejects.toThrow('career-apify-unavailable'); expect(network).not.toHaveBeenCalled();
});
it('refuses already cancelled work and releases late metadata without a dataset request', async () => {
 const parent = new AbortController(); parent.abort(); await expect(fetchApifyTask(task, parent.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(network).not.toHaveBeenCalled();
 const active = new AbortController(); let finish!: (value: Response) => void; network.mockReset().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
 const pending = fetchApifyTask(task, active.signal), check = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); active.abort(); await check; const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel }))); await new Promise(resolve => setTimeout(resolve, 0)); expect(cancel).toHaveBeenCalledOnce(); expect(network).toHaveBeenCalledOnce();
});
it('releases a refused body without waiting for a stalled producer cancellation', async () => {
 const cancel = vi.fn(() => new Promise<void>(() => {})); network.mockReset().mockResolvedValue(new Response(new ReadableStream({ pull() {}, cancel }), { status: 503 })); await expect(fetchApifyTask(task)).rejects.toThrow('career-apify-unavailable'); expect(cancel).toHaveBeenCalledOnce();
});
it.each(['fetch', 'body'] as const)('bounds an uncooperative metadata %s and releases resources', async phase => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; });
 const cancel = vi.fn(); network.mockReset().mockImplementation(() => phase === 'fetch' ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ pull() {}, cancel }))));
 const pending = fetchApifyTask(task), check = expect(pending).rejects.toThrow('career-apify-unavailable'); await vi.advanceTimersByTimeAsync(10_001); await check; expect(network).toHaveBeenCalledOnce(); if (phase === 'body') expect(cancel).toHaveBeenCalledOnce(); vi.useRealTimers();
});
it('shares one fifteen-second pass across metadata and dataset waits', async () => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => { const controller = new AbortController(); setTimeout(() => controller.abort(), ms); return controller.signal; });
 let finish!: (value: Response) => void; const cancel = vi.fn(); network.mockReset().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(new Response(new ReadableStream({ pull() {}, cancel })));
 const pending = fetchApifyTask(task), check = expect(pending).rejects.toThrow('career-apify-unavailable'); await vi.advanceTimersByTimeAsync(9000); finish(Response.json(meta())); await vi.advanceTimersByTimeAsync(0); expect(network).toHaveBeenCalledTimes(2); await vi.advanceTimersByTimeAsync(6001); await check; expect(cancel).toHaveBeenCalledOnce(); vi.useRealTimers();
});
it('does not renew the age or accept a regressing clock while a dataset is downloaded', async () => {
 vi.spyOn(Date, 'now').mockReturnValueOnce(now).mockReturnValueOnce(now).mockReturnValue(now - 1);
 await expect(fetchApifyTask(task)).rejects.toThrow('career-apify-unavailable'); expect(network).toHaveBeenCalledTimes(2);
});

const row = () => ({ id: 'synthetic-job', title: 'Frontend Engineer React', url: 'https://thehub.io/jobs/synthetic', descriptionText: '<p>React TypeScript frontend engineer in Oslo</p>', companyName: 'Synthetic company', location: 'Oslo, Norway', remote: true, tags: ['React'], postedAt: '2026-10-24' });
it('normalizes one bounded eligible record without changing its saved-run observation time', async () => {
 network.mockReset().mockResolvedValueOnce(Response.json(meta())).mockResolvedValueOnce(items([row()])); const result = await fetchApifyTask(task);
 expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ source: `apify-${task}`, externalId: 'synthetic-job', title: row().title, observedAt: meta().data.finishedAt, postedAt: '2026-10-24T00:00:00.000Z', tags: ['React'] });
});
it.each([null, [], 42, { ...row(), title: 'x'.repeat(301) }, { ...row(), url: 'https://private.invalid/jobs' }, { ...row(), id: 'x'.repeat(2049) }, { ...row(), isActive: false }])('ignores an ineligible or invalid record (%#) without throwing', input => { expect(normalizeApifyJob(input, task, meta().data.finishedAt)).toBeNull(); });
it('bounds descriptive fields and tags, rejects invalid published dates and handles unmatched HTML linearly', () => {
 const input = { ...row(), companyName: 'c'.repeat(1000), location: 'Oslo '.repeat(200), salary: 's'.repeat(1000), seniority: 's'.repeat(1000), tags: ['React', 'React', 1, 'x'.repeat(101), ...Array.from({ length: 80 }, (_, index) => `tag-${index}`)], postedAt: '2026-02-30', descriptionText: `React frontend ${'<'.repeat(100_000)}` };
 const result = normalizeApifyJob(input, task, meta().data.finishedAt)!; expect(result).not.toBeNull(); expect(result.company).toHaveLength(500); expect(result.location).toHaveLength(500); expect(result.salary).toHaveLength(500); expect(result.seniority).toHaveLength(200); expect(result.description).toHaveLength(12_000); expect(result.tags).toHaveLength(50); expect(new Set(result.tags).size).toBe(50); expect(result.postedAt).toBeNull();
});
it('deduplicates configured tasks before the existing five-task cap without reading credentials', () => {
 vi.stubEnv('APIFY_JOB_TASK_IDS', `one, one, owner~Task_ABC, ../invalid, ${'x'.repeat(129)},two,three,four,five`); expect(apifyTaskIds()).toEqual(['one', 'owner~Task_ABC', 'two', 'three', 'four']);
});

it('retains a completed task observation envelope even when its eligible job array is empty', async () => {
 await expect(fetchApifyTaskSnapshot(task)).resolves.toEqual({ jobs: [], observedAt: meta().data.finishedAt });
});
