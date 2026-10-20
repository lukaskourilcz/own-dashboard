import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ admin: vi.fn(), ports: vi.fn(), tick: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.admin() }));
vi.mock('@/lib/marketing/scheduler-ports', () => ({ createMarketingSchedulerPorts: (...args: unknown[]) => mocks.ports(...args) }));
vi.mock('@/lib/marketing/scheduler', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/marketing/scheduler')>();
  return { ...original, runMarketingTick: (...args: Parameters<typeof original.runMarketingTick>) => mocks.tick(...args) };
});
import { signAutomationBody } from '@/lib/marketing/automation-auth';
import { POST, maxDuration, runtime } from '@/app/api/marketing/tick/route';

const owner = '11111111-1111-4111-8111-111111111111';
const scheduler = 'TEST-ONLY-scheduler-secret-'.padEnd(48, 's'), worker = 'TEST-ONLY-worker-secret-'.padEnd(48, 'w');
const body = JSON.stringify({ tick: '22222222-2222-4222-8222-222222222222', kind: 'minute' });
const request = (headers: Record<string, string>, value = body) => new Request('https://own.example/api/marketing/tick', { method: 'POST', headers, body: value });
const signed = (value = body, secret = scheduler, at = Date.now()) => request(signAutomationBody(value, secret, at), value);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MARKETING_OWNER_ID', owner);
  vi.stubEnv('MARKETING_SCHEDULER_SECRET', scheduler);
  vi.stubEnv('MARKETING_WORKER_SECRET', worker);
  for (const key of ['MARKETING_PILOT_OWNER_ID', 'MARKETING_PILOT_STARTS_AT', 'MARKETING_PILOT_EXPIRES_AT', 'MARKETING_DNESKAI_SECRET', 'MARKETING_DEVSHARK_SECRET', 'MARKETING_PUBLISH_SECRET']) vi.stubEnv(key, undefined);
  mocks.admin.mockReturnValue({ admin: true });
  mocks.ports.mockReturnValue({ ports: true });
  mocks.tick.mockResolvedValue({ tick: '22222222-2222-4222-8222-222222222222', kind: 'minute', duplicate: false, recorded: true, did: [{ category: 'collection', status: 'noop', ms: 1 }], errors: [], next: { pending: [] } });
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/marketing/tick', () => {
  it('is a Node route inside the 60 s function limit', () => {
    expect(runtime).toBe('nodejs');
    expect(maxDuration).toBe(60);
  });
  it('runs one tick for the configured owner with the signed scheduler secret', async () => {
    const response = await POST(signed());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ duplicate: false, did: [{ category: 'collection', status: 'noop' }] });
    expect(mocks.ports).toHaveBeenCalledWith({ admin: true }, owner, process.env);
    expect(mocks.tick).toHaveBeenCalledWith({ owner, env: process.env, ports: { ports: true } }, { tick: '22222222-2222-4222-8222-222222222222', kind: 'minute' });
  });
  it('refuses a bad signature, a changed body, an unsigned bearer and a missing secret before any database access', async () => {
    const headers = signAutomationBody(body, scheduler);
    expect((await POST(request({ ...headers, 'X-Marketing-Signature': 'f'.repeat(64) }))).status).toBe(401);
    expect((await POST(request(headers, body.replace('minute', 'daily')))).status).toBe(401);
    expect((await POST(request({ Authorization: `Bearer ${scheduler}`, 'Content-Type': 'application/json' }))).status).toBe(401);
    expect((await POST(signed(body, 'TEST-ONLY-wrong-secret-'.padEnd(48, 'x')))).status).toBe(401);
    vi.stubEnv('MARKETING_SCHEDULER_SECRET', 'short-secret');
    expect((await POST(signed(body, 'short-secret'))).status).toBe(401);
    vi.stubEnv('MARKETING_SCHEDULER_SECRET', undefined);
    expect((await POST(signed())).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.tick).not.toHaveBeenCalled();
  });
  it('refuses a timestamp more than 300 s away', async () => {
    expect((await POST(signed(body, scheduler, Date.now() - 301_000))).status).toBe(401);
    expect((await POST(signed(body, scheduler, Date.now() + 301_000))).status).toBe(401);
    expect((await POST(signed(body, scheduler, Date.now() - 290_000))).status).toBe(200);
  });
  it('accepts no other automation role', async () => {
    const response = await POST(signed(body, worker));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden' });
    expect(mocks.tick).not.toHaveBeenCalled();
  });
  it('accepts only { tick: uuid, kind: minute|daily }', async () => {
    for (const value of ['{}', '{"tick":"not-a-uuid","kind":"minute"}', '{"tick":"22222222-2222-4222-8222-222222222222","kind":"hourly"}', '{"tick":"22222222-2222-4222-8222-222222222222","kind":"minute","owner":"x"}', 'not json']) {
      expect((await POST(signed(value))).status).toBe(400);
    }
    expect((await POST(signed(JSON.stringify({ tick: '22222222-2222-4222-8222-222222222222', kind: 'daily', padding: 'x'.repeat(5000) })))).status).toBe(413);
    expect(mocks.tick).not.toHaveBeenCalled();
  });
  it('answers 503 without exception text when the tick cannot be recorded', async () => {
    mocks.tick.mockRejectedValue(new Error('private connection string MUST NOT ESCAPE'));
    const response = await POST(signed());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'tick-unavailable' });
  });
});
