import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST as automate } from '@/app/api/marketing/automation/route';
import { POST as enqueue } from '@/app/api/marketing/jobs/route';
import { POST as execute } from '@/app/api/marketing/jobs/[id]/execute/route';
import { MARKETING_BODY_TIMEOUT_MS } from '@/lib/marketing/http';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), database: vi.fn(), ingest: vi.fn(), save: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.database }));
vi.mock('@/lib/marketing/automation-auth', () => ({ authenticateAutomation: mocks.authenticate }));
vi.mock('@/lib/marketing/store', () => ({ ingestSource: mocks.ingest, saveRevision: mocks.save }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());
const handlers = [
 { name: 'source automation', maximum: 1024 * 1024, call: automate },
 { name: 'worker queue', maximum: 200000, call: enqueue },
 { name: 'worker execution', maximum: 200000, call: (request: Request) => execute(request, { params: Promise.resolve({ id: 'synthetic-job' }) }) },
];
function request(body: ReadableStream<Uint8Array>) { return new Request('https://fixture.invalid', { method:'POST',body,duplex:'half' } as RequestInit); }
function expectNoAdmission() {
 expect(mocks.authenticate).not.toHaveBeenCalled(); expect(mocks.database).not.toHaveBeenCalled();
 expect(mocks.ingest).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
}
for (const handler of handlers) {
 it(`${handler.name}: a stalled body returns 408 before auth, database or provider admission`, async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  const result = handler.call(request(new ReadableStream({ cancel })));
  await vi.advanceTimersByTimeAsync(MARKETING_BODY_TIMEOUT_MS);
  const response = await result; expect(response.status).toBe(408);
  expect(await response.json()).toEqual({ error:'request-body-timeout' }); expect(cancel).toHaveBeenCalledOnce(); expectNoAdmission();
 });
 it(`${handler.name}: a body beyond its byte limit returns 413 before admission`, async () => {
  const response = await handler.call(request(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(handler.maximum + 1)); c.close(); } })));
  expect(response.status).toBe(413); expect(await response.json()).toEqual({ error:'payload-too-large' }); expectNoAdmission();
 });
}
