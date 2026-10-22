import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClaudeMarketingModel, generateMarketingDraft, DEFAULT_GENERATION_BUDGET, MarketingCopySchema, marketingProviderWireSchema } from '@/lib/marketing/generation';
import { contentHash } from '@/lib/marketing/hashes';
import type { MarketingTrace } from '@/lib/marketing/tracing';

vi.mock('server-only', () => ({}));
beforeEach(() => {
  for (const name of ['LANGSMITH_TRACING', 'LANGCHAIN_TRACING_V2', 'LANGCHAIN_TRACING', 'LANGCHAIN_VERBOSE']) vi.stubEnv(name, 'false');
  for (const name of ['ANTHROPIC_API_URL', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']) vi.stubEnv(name, '');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function offlineInput() {
  const content = { title: 'Offline QA', body: 'Choose an option.', category: 'JavaScript', difficulty: 'Easy', code: null, options: ['A', 'B'], answer: 'A', explanation: 'Offline authored explanation.', evidence: [], image: null };
  const source = { schemaVersion: 'marketing-source/1' as const, brand: 'devshark' as const, kind: 'question' as const, sourceId: 'TEST-ONLY', sourceRevision: 'TEST-ONLY', contentHash: contentHash(content),
    canonicalUrl: 'https://example.invalid/test-only', locale: 'en' as const, observedAt: new Date().toISOString(), expiresAt: null, eligible: true, eligibilityReason: 'OFFLINE TEST SIMULATION ONLY', content };
  return { source, account: { id: 'TEST-ONLY', platform: 'threads' as const, handle: 'test-only' }, scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    templateVersion: 'devshark-editorial/2', knowledge: [], consent: true, revisionId: '11111111-1111-4111-8111-111111111111' };
}
describe('actual installed Claude/LangChain/LangSmith setup with mocked HTTP; zero network', () => {
  it('transforms unsupported strict constraints in the actual wire request and classifies one synthetic400', async () => {
    let request: Record<string, unknown> | undefined;
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(new URL(String(url)).origin).toBe('https://api.anthropic.com');
      request = JSON.parse(String(init?.body));
      return Response.json({ type: 'error', error: { type: 'invalid_request_error', message: 'TEST-ONLY-REJECTED-STRICT-SCHEMA' } }, { status: 400 });
    });
    vi.stubGlobal('fetch', fetcher);
    const model = await createClaudeMarketingModel({ apiKey: 'TEST-ONLY-NO-PROVIDER-CREDENTIAL', model: 'claude-sonnet-4-6', pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } });
    await expect(model.invoke({ system: 'OFFLINE TRANSPORT SIMULATION ONLY', prompt: 'OFFLINE TRANSPORT SIMULATION ONLY', maxOutputTokens: 2500, signal: AbortSignal.timeout(5000) })).rejects.toMatchObject({ code: 'provider-bad-request', providerFailure: { httpStatus: 400, providerCode: 'invalid_request_error' } });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(request?.model).toBe('claude-sonnet-4-6'); expect(request?.max_tokens).toBe(2500);
    const tools = request?.tools as Array<{ name: string; strict: boolean; input_schema: { properties: Record<string, unknown> } }>;
    expect(tools).toHaveLength(1); expect(tools[0].name).toBe('marketing_copy'); expect(tools[0].strict).toBe(true);
    expect(tools[0].input_schema).toEqual(marketingProviderWireSchema());
    expect(tools[0].input_schema.properties.title).not.toHaveProperty('minLength'); expect(tools[0].input_schema.properties.title).not.toHaveProperty('maxLength');
    expect(tools[0].input_schema.properties.slides).not.toHaveProperty('minItems'); expect(tools[0].input_schema.properties.slides).not.toHaveProperty('maxItems');
    expect(request?.tool_choice).toEqual({ type: 'tool', name: 'marketing_copy' });
  }, 15000);
  it('parses an actual SDK tool response and measured usage while retaining the bounded local schema', async () => {
    const copy = { title: 'Offline QA', caption: 'Offline QA', locale: 'en', slides: [
      { headline: 'Offline QA', body: 'Read the authored question.', code: null, evidenceIndexes: [] },
      { headline: 'Offline QA', body: 'Read the authored explanation.', code: null, evidenceIndexes: [] },
    ] };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: 'msg_TEST_ONLY', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
      content: [{ type: 'tool_use', id: 'toolu_TEST_ONLY', name: 'marketing_copy', input: copy }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 120, output_tokens: 80 } }));
    vi.stubGlobal('fetch', fetcher);
    const model = await createClaudeMarketingModel({ apiKey: 'TEST-ONLY-NO-PROVIDER-CREDENTIAL', model: 'claude-sonnet-4-6', pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } });
    expect(await model.invoke({ system: 'OFFLINE ONLY', prompt: 'OFFLINE ONLY', maxOutputTokens: 2500, signal: AbortSignal.timeout(5000) })).toEqual({ copy, usage: { inputTokens: 120, outputTokens: 80 } });
    expect(fetcher).toHaveBeenCalledTimes(1); expect(MarketingCopySchema.safeParse({ ...copy, title: 'x'.repeat(161) }).success).toBe(false);
  });
  it('holds unsupported copy after a successful mocked SDK response and does not weaken slide/length/number bounds', async () => {
    const bad = { title: 'x'.repeat(161), caption: 'Offline QA', locale: 'en', slides: [{ headline: 'Offline QA', body: 'Offline QA', code: null, evidenceIndexes: [-1] }] };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: 'msg_TEST_ONLY', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
      content: [{ type: 'tool_use', id: 'toolu_TEST_ONLY', name: 'marketing_copy', input: bad }], stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 120, output_tokens: 80 } }));
    vi.stubGlobal('fetch', fetcher);
    const model = await createClaudeMarketingModel({ apiKey: 'TEST-ONLY-NO-PROVIDER-CREDENTIAL', model: 'claude-sonnet-4-6', pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } });
    const finish = vi.fn<MarketingTrace['finish']>(async () => {});
    const tracer = { start: vi.fn(async () => ({ id: 'TEST-ONLY-TRACE', finish, stage: vi.fn<MarketingTrace['stage']>(async () => {}) })) };
    await expect(generateMarketingDraft(offlineInput(), { model, tracer, budget: { ...DEFAULT_GENERATION_BUDGET, maxAttempts: 1 } })).rejects.toThrow('copy-validation-failed');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', revisionHash: null, issues: ['invalid-schema', 'copy-validation-failed'] }));
  });
  it('does not retry an SDK rate-limit failure and exposes no raw vendor message or request ID', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ type: 'error', error: { type: 'rate_limit_error', message: 'TEST_ONLY_PRIVATE_MESSAGE https://private.example.invalid/' }, request_id: 'TEST_ONLY_PRIVATE_REQUEST_ID' }, { status: 429 }));
    vi.stubGlobal('fetch', fetcher);
    const model = await createClaudeMarketingModel({ apiKey: 'TEST-ONLY-NO-PROVIDER-CREDENTIAL', model: 'claude-sonnet-4-6', pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } });
    const finish = vi.fn<MarketingTrace['finish']>(async () => {}); const stage = vi.fn<MarketingTrace['stage']>(async () => {});
    const tracer = { start: vi.fn(async () => ({ id: 'TEST-ONLY-TRACE', finish, stage })) };
    try { await generateMarketingDraft(offlineInput(), { model, tracer }); throw new Error('expected-synthetic-failure'); }
    catch (failure) {
      expect(failure).toMatchObject({ code: 'provider-rate-limited', providerFailure: { httpStatus: 429, providerCode: 'rate_limit_error' } });
      expect(String(failure)).not.toContain('TEST_ONLY_PRIVATE'); expect(JSON.stringify(failure)).not.toContain('TEST_ONLY_PRIVATE');
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(stage).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledWith({ status: 'failed', revisionHash: null, issues: ['provider-rate-limited'],
      usage: { attempts: 1, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 } });
    // Decision 16: the real SDK surfaces the HTTP 429, a whole-request rejection that billed nothing, so it books $0.
    expect(JSON.stringify(finish.mock.calls)).not.toContain('TEST_ONLY_PRIVATE');
  });
  it('uses explicit output rules and only fixed validation codes on a bounded second actual SDK request', async () => {
    const requests: Record<string, unknown>[] = [];
    const valid = { title: 'Offline QA', caption: 'Read the authored exercise.', locale: 'en', slides: [
      { headline: 'Offline QA', body: 'Read the authored question.', code: null, evidenceIndexes: [] },
      { headline: 'Offline QA', body: 'Read the authored explanation.', code: null, evidenceIndexes: [] },
    ] };
    const invalid = { ...valid, slides: valid.slides.map(slide => ({ ...slide, body: 'TEST_ONLY_PRIVATE_OUTPUT 999999991', code: 'TEST_ONLY_PRIVATE_OUTPUT', evidenceIndexes: [0] })) };
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return Response.json({ id: 'msg_TEST_ONLY', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
        content: [{ type: 'tool_use', id: 'toolu_TEST_ONLY', name: 'marketing_copy', input: requests.length === 1 ? invalid : valid }],
        stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 200, output_tokens: 100 } });
    });
    vi.stubGlobal('fetch', fetcher);
    const model = await createClaudeMarketingModel({ apiKey: 'TEST-ONLY-NO-PROVIDER-CREDENTIAL', model: 'claude-sonnet-4-6', pricing: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } });
    const draft = await generateMarketingDraft(offlineInput(), { model });
    expect(fetcher).toHaveBeenCalledTimes(2); expect(draft.usage.attempts).toBe(2); expect(draft.usage.estimatedCostUsd).toBe(0.0042);
    expect(draft.revision.promptVersion).toBe('marketing-copy/4');
    const first = JSON.stringify(requests[0]); const second = JSON.stringify(requests[1]);
    for (const instruction of ['code:null', 'evidenceIndexes:[]', 'Do not number slides', 'headline 1-160 characters']) expect(first).toContain(instruction);
    expect(first).not.toContain('Validation feedback for this same authored source');
    expect(second).toContain('Validation feedback for this same authored source');
    for (const code of ['unsupported-number', 'model-code-forbidden', 'unknown-evidence']) expect(second).toContain(code);
    expect(second).not.toContain('TEST_ONLY_PRIVATE_OUTPUT'); expect(second).not.toContain('999999991');
    expect(draft.slides.every(slide => slide.code === null && slide.evidenceIndexes.length === 0)).toBe(true);
  });
});
