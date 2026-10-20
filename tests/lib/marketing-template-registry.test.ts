import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { trustedMarketingTemplate, resolveTrustedMarketingTemplate } from '@/lib/marketing/template-registry';
import { currentMarketingTemplate, marketingTemplateDefinition, marketingTemplateDigest } from '@/lib/marketing/render';
import { enqueueMarketingJob, executeMarketingJob, resolveMarketingTemplate } from '@/lib/marketing/worker-runtime';
import { enqueueCalendarMarketingJob } from '@/lib/marketing/orchestrator';
import { parseSourcePacket } from '@/lib/marketing/contracts';
import { contentHash, revisionHash } from '@/lib/marketing/hashes';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { MarketingWorkerRequest, MarketingWorkerResult } from '../../services/marketing-worker/protocol';
import question from '../../templates/marketing/benchmarks/devshark-question.json';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-10-13T12:00:00.000Z');
const config = { NODE_ENV: 'production', VERCEL_ENV: 'preview', MARKETING_OWNER_ID: owner, MARKETING_PILOT_OWNER_ID: owner,
  MARKETING_PILOT_STARTS_AT: '2026-10-13T10:00:00.000Z', MARKETING_PILOT_EXPIRES_AT: '2026-10-15T10:00:00.000Z',
  MARKETING_AI_CONSENT: 'true', ANTHROPIC_API_KEY: 'TEST-ONLY-NO-PROVIDER-CREDENTIAL', MARKETING_CLAUDE_MODEL: 'claude-sonnet-4-6', MARKETING_CLAUDE_INPUT_USD_PER_MTOK: '3', MARKETING_CLAUDE_OUTPUT_USD_PER_MTOK: '15' };
function approval(brand: 'dneskai' | 'devshark') {
  return { brand, approvedBy: owner, approvedAt: now.toISOString(), templateSha256: currentMarketingTemplate(brand).templateSha256,
    designExportSha256: marketingTemplateDefinition(brand).style.design.archiveSha256 };
}
const env = () => ({ ...config, MARKETING_PILOT_TEMPLATE_APPROVALS: JSON.stringify([approval('devshark'), approval('dneskai')]) });
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe('private staging template approval registry; synthetic owner receipts only', () => {
  it('preserves ordinary repository behavior without a receipt, including production and partial pilot configuration', async () => {
    const ordinary = { VERCEL_ENV: 'production', MARKETING_PILOT_OWNER_ID: 'malformed' };
    expect(trustedMarketingTemplate('devshark', ordinary)).toEqual(currentMarketingTemplate('devshark'));
    expect(resolveTrustedMarketingTemplate('missing-version', ordinary)).toBeNull();
    expect(await resolveMarketingTemplate('devshark-editorial/2', { env: ordinary })).toEqual(currentMarketingTemplate('devshark'));
  });
  it('overlays exactly the two current digests/Design exports without changing public manifests or renderer definitions', async () => {
    const values = env();
    for (const brand of ['devshark', 'dneskai'] as const) {
      const original = currentMarketingTemplate(brand), definitionHash = contentHash(marketingTemplateDefinition(brand));
      const template = trustedMarketingTemplate(brand, values);
      expect(template).toEqual({ ...original, approved: true, approval: { approvedBy: owner, approvedAt: now.toISOString(), templateSha256: original.templateSha256, designExportSha256: approval(brand).designExportSha256 } });
      expect(await resolveMarketingTemplate(original.version, { env: values })).toEqual(template);
      expect(template.templateSha256).toBe(marketingTemplateDigest(brand)); expect(contentHash(marketingTemplateDefinition(brand))).toBe(definitionHash);
      expect(currentMarketingTemplate(brand)).toEqual(original); expect(original.approved).toBe(false); expect(original.approval).toBeNull();
    }
    expect(trustedMarketingTemplate('devshark', values).templateSha256).toBe('41a8ff3a7bacbd8935e754fbafea8eafa0874ab5f50fa207504a432f2d39ba23');
    expect(trustedMarketingTemplate('dneskai', values).templateSha256).toBe('e19dc4f3bf14c82ff429ae28bc08f975d174a37fd9ef4e09c839d8d30feec1d5');
  });
  it('keeps missing brands pending and allows an active empty receipt without inventing approvals', () => {
    const partial = { ...env(), MARKETING_PILOT_TEMPLATE_APPROVALS: JSON.stringify([approval('devshark')]) };
    expect(trustedMarketingTemplate('devshark', partial).approved).toBe(true);
    expect(trustedMarketingTemplate('dneskai', partial)).toEqual(currentMarketingTemplate('dneskai'));
    expect(trustedMarketingTemplate('devshark', { ...env(), MARKETING_PILOT_TEMPLATE_APPROVALS: '[]' }).approved).toBe(false);
  });
  it('rejects expired, future-start, foreign-owner and incomplete pilot contexts in Preview even for an empty receipt', () => {
    for (const invalid of [
      { ...env(), MARKETING_OWNER_ID: undefined },
      { ...env(), MARKETING_OWNER_ID: randomUUID() }, { ...env(), MARKETING_PILOT_OWNER_ID: undefined },
      { ...env(), MARKETING_PILOT_EXPIRES_AT: now.toISOString() }, { ...env(), MARKETING_PILOT_STARTS_AT: '2026-10-13T13:00:00.000Z' },
      { ...env(), MARKETING_PILOT_EXPIRES_AT: '2026-10-16T10:00:00.000Z' },
    ]) expect(() => trustedMarketingTemplate('devshark', invalid)).toThrow('pilot-template-approval-invalid');
  });
  it('ignores a retired receipt outside Preview: repository manifests apply and nothing is approved or blocked (#113)', async () => {
    for (const retired of [
      { ...env(), VERCEL_ENV: 'production' }, { ...env(), VERCEL_ENV: undefined }, { VERCEL_ENV: 'production', MARKETING_PILOT_TEMPLATE_APPROVALS: '[]' },
      { ...env(), VERCEL_ENV: 'production', MARKETING_PILOT_TEMPLATE_APPROVALS: '{malformed-test-only' }, { ...env(), VERCEL_ENV: 'development', MARKETING_PILOT_EXPIRES_AT: now.toISOString() },
    ]) {
      for (const brand of ['devshark', 'dneskai'] as const) {
        expect(trustedMarketingTemplate(brand, retired)).toEqual(currentMarketingTemplate(brand));
        expect(trustedMarketingTemplate(brand, retired).approved).toBe(false);
      }
      expect(resolveTrustedMarketingTemplate('missing-version', retired)).toBeNull();
      expect(await resolveMarketingTemplate('devshark-editorial/2', { env: retired })).toEqual(currentMarketingTemplate('devshark'));
    }
  });
  it('rejects malformed, partial, extra-field, duplicate and oversized receipts with a fixed non-private error', () => {
    const entry = approval('devshark');
    for (const raw of ['', '{private-test-value', 'null', '{}', JSON.stringify([{ brand: 'devshark' }]), JSON.stringify([{ ...entry, notes: 'private-test-value' }]),
      JSON.stringify([entry, entry]), JSON.stringify([entry, approval('dneskai'), entry]), ' '.repeat(4097)]) {
      const values = { ...env(), MARKETING_PILOT_TEMPLATE_APPROVALS: raw };
      expect(() => trustedMarketingTemplate('devshark', values)).toThrow('pilot-template-approval-invalid');
      expect(() => resolveTrustedMarketingTemplate('missing-version', values)).toThrow('pilot-template-approval-invalid');
    }
  });
  it('binds every entry to the owner, exact current digest/export and actual approval time inside the pilot', () => {
    for (const change of [
      { approvedBy: randomUUID() }, { approvedAt: 'not-a-date' }, { approvedAt: '2026-10-13T09:59:59.999Z' },
      { approvedAt: '2026-10-13T12:00:00.001Z' }, { approvedAt: config.MARKETING_PILOT_EXPIRES_AT },
      { designExportSha256: approval('dneskai').designExportSha256 }, { templateSha256: '0'.repeat(64) }, { brand: 'unknown' },
    ]) {
      const values = { ...env(), MARKETING_PILOT_TEMPLATE_APPROVALS: JSON.stringify([{ ...approval('devshark'), ...change }]) };
      // A bad entry blocks other brands too; resolution cannot cherry-pick around it.
      expect(() => trustedMarketingTemplate('dneskai', values)).toThrow('pilot-template-approval-invalid');
    }
  });
});

function simulation(values = env()) {
  // The retained producer fixture remains held. This clone is an offline admission simulation only.
  const source = parseSourcePacket({ ...structuredClone(question), eligible: true, eligibilityReason: 'OFFLINE TEMPLATE REGISTRY TEST ONLY', observedAt: now.toISOString() });
  const template = trustedMarketingTemplate('devshark', values), id = randomUUID(), jobId = randomUUID();
  const input: MarketingWorkerRequest = { schemaVersion: 'marketing-job/1', idempotencyKey: id, template, generation: { revisionId: id, consent: true, source,
    account: { id: 'TEST-ONLY-REMOTE', handle: 'test-only', platform: 'threads' }, scheduledAt: '2026-10-14T07:00:00.000Z', templateVersion: template.version, knowledge: [] } };
  const account = { id: randomUUID(), remote_account_id: input.generation.account.id, handle: input.generation.account.handle, verified_at: now.toISOString(), enabled: false };
  const query = { select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() };
  for (const method of ['select', 'eq', 'not', 'order'] as const) query[method].mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: account, error: null });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => {
    void args; return { data: name === 'marketing_enqueue_job' ? { jobId, status: 'queued', duplicate: false } : name === 'marketing_claim_job' ? input : name === 'marketing_check_pilot_attempt' ? true : 'review', error: null };
  });
  const db = { from: vi.fn(() => query), rpc } as unknown as ReturnType<typeof createAdminClient>;
  const model = { model: 'claude-sonnet-4-6', pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 }, invoke: vi.fn() };
  const revision = { schemaVersion: 'marketing-content/1' as const, brand: 'devshark' as const, title: 'Offline registry simulation', caption: 'Offline registry simulation', format: 'thread' as const,
    sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }], account: input.generation.account, assets: [], knowledgeIds: [],
    scheduledAt: input.generation.scheduledAt, timeZone: 'Europe/Prague' as const, templateVersion: template.version, promptVersion: 'marketing-copy/3', model: model.model, traceId: null };
  const result: MarketingWorkerResult = { revision, slides: [], traceId: null, revisionHash: revisionHash(revision), usage: { attempts: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } };
  return { values, source, template, input, jobId, account, query, rpc, db, model, result };
}
describe('same registry for orchestration, durable admission and worker reload; no model calls', () => {
  it('rejects an invalid supplied receipt before calendar or duplicate-job reads', async () => {
    for (const [key, value] of Object.entries(env())) vi.stubEnv(key, value);
    vi.stubEnv('MARKETING_PILOT_TEMPLATE_APPROVALS', '{malformed-test-only');
    const from = vi.fn();
    await expect(enqueueCalendarMarketingJob({ from } as unknown as ReturnType<typeof createAdminClient>, owner, { brand: 'devshark', entryId: randomUUID(), platform: 'threads' })).rejects.toThrow('pilot-template-approval-invalid');
    expect(from).not.toHaveBeenCalled();
  });
  it('rejects production resolver overrides when no private receipt exists', async () => {
    const state = simulation(), override = vi.fn(async () => state.template);
    const values = { ...state.values, VERCEL_ENV: 'production', MARKETING_PILOT_TEMPLATE_APPROVALS: undefined };
    await expect(enqueueMarketingJob(state.db, owner, state.input, { env: values, resolveTemplate: override })).rejects.toThrow('template-not-approved');
    expect(override).not.toHaveBeenCalled(); expect(state.rpc).not.toHaveBeenCalled(); expect(state.model.invoke).not.toHaveBeenCalled();
  });
  it('admits and reloads the exact receipt, ignores resolver overrides and rejects caller-forged approval metadata', async () => {
    const state = simulation(), override = vi.fn(async () => currentMarketingTemplate('devshark'));
    await enqueueMarketingJob(state.db, owner, state.input, { env: state.values, resolveTemplate: override });
    expect(override).not.toHaveBeenCalled(); expect(state.rpc).toHaveBeenCalledWith('marketing_enqueue_job', expect.objectContaining({ p_request: state.input }));
    const run = vi.fn(async (_input, dependencies) => { expect(await dependencies.reloadTemplate(state.template.version)).toEqual(state.template); return state.result; });
    expect((await executeMarketingJob(state.db, owner, state.jobId, { env: state.values, model: state.model, refreshSource: vi.fn(), resolveTemplate: override, run, storage: { put: vi.fn() } })).status).toBe('review');
    expect(override).not.toHaveBeenCalled(); expect(state.model.invoke).not.toHaveBeenCalled();
    const forged = { ...state.input, template: { ...state.template, approval: { ...state.template.approval!, approvedBy: randomUUID() } } };
    await expect(enqueueMarketingJob(state.db, owner, forged, { env: state.values })).rejects.toThrow('template-not-approved');
    expect(question.eligible).toBe(false);
  });
  it('holds an admitted template if its brand receipt disappears before execution, before invoking a model', async () => {
    const state = simulation(); await enqueueMarketingJob(state.db, owner, state.input, { env: state.values });
    state.values.MARKETING_PILOT_TEMPLATE_APPROVALS = '[]';
    state.rpc.mockImplementation(async (name: string) => ({ data: name === 'marketing_claim_job' ? state.input : 'failed', error: null }));
    expect(await executeMarketingJob(state.db, owner, state.jobId, { env: state.values, model: state.model, refreshSource: vi.fn(), storage: { put: vi.fn() } })).toEqual({ claimed: true, status: 'failed', errorCode: 'template-superseded' });
    expect(state.model.invoke).not.toHaveBeenCalled();
  });
  it('selects that same private receipt through actual calendar orchestration and durable admission', async () => {
    const state = simulation(); for (const [key, value] of Object.entries(state.values)) vi.stubEnv(key, value);
    const entry = { id: randomUUID(), campaign_id: randomUUID(), date: '2026-10-14', local_time: '09:00', kind: 'thread', platform: 'threads', needs_review: false, status: 'planned', generation_version: 1 };
    const from = vi.fn((table: string) => {
      const query = { select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn(), single: vi.fn(), maybeSingle: vi.fn() };
      for (const method of ['select', 'eq', 'not', 'order'] as const) query[method].mockReturnValue(query);
      query.single.mockResolvedValue({ data: table === 'marketing_calendar_entries' ? entry : table === 'marketing_campaigns' ? { starts_on: '2026-10-13', ends_on: '2026-10-15' } : state.account, error: null });
      query.maybeSingle.mockResolvedValue({ data: table === 'marketing_jobs' ? null : state.account, error: null });
      query.limit.mockResolvedValue({ data: table === 'marketing_sources' ? [{ id: randomUUID(), packet: state.source }] : [], error: null }); return query;
    });
    const db = { from, rpc: state.rpc } as unknown as ReturnType<typeof createAdminClient>;
    expect(await enqueueCalendarMarketingJob(db, owner, { brand: 'devshark', platform: 'threads', entryId: entry.id })).toEqual({ jobId: state.jobId, status: 'queued', duplicate: false });
    const request = state.rpc.mock.calls.find(([name]) => name === 'marketing_enqueue_job')![1].p_request as MarketingWorkerRequest;
    expect(request.template).toEqual(await resolveMarketingTemplate(request.template.version)); expect(request.template).toEqual(state.template);
    expect(request.calendarEntryId).toBe(entry.id); expect(request.generation.source).toEqual(state.source); expect(state.model.invoke).not.toHaveBeenCalled();
  });
});
