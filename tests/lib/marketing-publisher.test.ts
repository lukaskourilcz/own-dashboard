import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readFile, readdir } from 'node:fs/promises';
import { parseSourcePacket, type ContentRevision } from '@/lib/marketing/contracts';
import { contentHash, revisionHash } from '@/lib/marketing/hashes';
import { publicationGate, publishMarketingRevision, reconcileMarketingPublication, type PublishMarketingInput, type PublisherCheckpoint } from '@/lib/marketing/publisher';
vi.mock('server-only', () => ({}));

const now = new Date('2026-10-13T09:00:00Z');
const owner = '11111111-1111-4111-8111-111111111111';
// A real 1080 x 1350 JPEG: the publisher decodes feed images before creating any container.
let bytes: Buffer;
beforeAll(async () => { bytes = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#203040' } }).jpeg().toBuffer(); });
const sourceContent = { title: 'Synthetic QA question', body: 'QA only: choose an option.', category: 'javascript', difficulty: 'Easy', code: null,
  options: ['A', 'B'], answer: 'A', explanation: 'Synthetic authored QA explanation.', evidence: [], image: null };
function fixture(threads = false) {
  const source = parseSourcePacket({ schemaVersion: 'marketing-source/1', brand: 'devshark', kind: 'question', sourceId: 'question:qa-only', sourceRevision: 'qa-revision-1',
    contentHash: contentHash(sourceContent), canonicalUrl: 'https://devshark.app/daily/2026-10-13', locale: 'en', observedAt: now.toISOString(), expiresAt: null,
    eligible: true, eligibilityReason: 'Synthetic QA only', content: sourceContent });
  const revision: ContentRevision = { schemaVersion: 'marketing-content/1', brand: 'devshark', title: 'Synthetic QA post', caption: 'Synthetic QA caption only',
    format: threads ? 'thread' : 'post', sources: [{ sourceId: source.sourceId, sourceRevision: source.sourceRevision, contentHash: source.contentHash }], knowledgeIds: [],
    assets: threads ? [] : [{ url: 'https://assets.example.invalid/qa.jpg', sha256: createHash('sha256').update(bytes).digest('hex'), mimeType: 'image/jpeg', width: 1080, height: 1350, alt: 'Synthetic QA alt text' }],
    account: { id: '101', platform: threads ? 'threads' : 'instagram', handle: '@qa_only' }, scheduledAt: now.toISOString(), timeZone: 'Europe/Prague',
    templateVersion: 'qa-template/1', promptVersion: 'qa-prompt/1', model: 'qa-model', traceId: null };
  const hash = revisionHash(revision);
  const checkpoints: PublisherCheckpoint[] = [];
  const requests: Array<{ url: string; method: string; body: string }> = [];
  const input: PublishMarketingInput = { now, dryRun: false,
    revisionRow: { id: '22222222-2222-4222-8222-222222222222', user_id: owner, project_id: null, campaign_id: null, revision, content_hash: hash,
      status: 'approved', ready: true, approved_at: now.toISOString(), approved_hash: hash, feedback: null, created_at: now.toISOString() },
    publication: { id: '33333333-3333-4333-8333-333333333333', user_id: owner, revision_id: '22222222-2222-4222-8222-222222222222', platform: revision.account.platform,
      status: 'claimed', lease_until: '2026-10-13T09:10:00Z', remote_container_id: null, remote_media_id: null, remote_url: null, error_code: null },
    account: { id: '44444444-4444-4444-8444-444444444444', user_id: owner, remote_account_id: '101', brand: 'devshark', platform: revision.account.platform,
      handle: '@qa_only', verified_at: '2026-10-13T08:00:00Z', enabled: true }, sources: [source],
    config: { enabled: true, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-13T08:00:00Z', loginMode: threads ? 'threads' : 'instagram',
      accessToken: 'synthetic-qa-token-only', tokenExpiresAt: '2026-10-14T00:00:00Z', scopes: threads ? ['threads_basic', 'threads_content_publish'] : ['instagram_business_basic', 'instagram_business_content_publish'], approvedAssetHosts: ['assets.example.invalid'], pollIntervalMs: 0 },
    checkpoint: async checkpoint => { checkpoints.push(checkpoint); }, revalidate: async () => input,
    fetcher: async (request, options) => {
      const url = String(request); const method = options?.method ?? 'GET'; const body = String(options?.body ?? ''); requests.push({ url, method, body });
      if (url.startsWith('https://assets.example.invalid/')) return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/jpeg' } });
      if (url.includes('publishing_limit')) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] });
      if (url.includes('publish') && method === 'POST') return Response.json({ id: '301' });
      if (method === 'POST') { expect(checkpoints.some(row => row.stage === 'publish-intent')).toBe(false); return Response.json({ id: '201' }); }
      if (url.includes('/201?')) return Response.json({ id: '201', [threads ? 'status' : 'status_code']: 'FINISHED' });
      if (url.includes('/301?')) return Response.json({ id: '301', permalink: threads ? 'https://www.threads.net/@qa_only/post/qa' : 'https://www.instagram.com/p/qa' });
      return Response.json({ id: '101', username: 'qa_only' });
    } };
  return { input, checkpoints, requests };
}

describe('guarded Meta publishing', () => {
  it('defaults to dry run and requires exact final approval, verified enabled account, fresh sources and due slot', async () => {
    const { input, requests } = fixture();
    expect((await publishMarketingRevision({ ...input, dryRun: undefined })).status).toBe('dry-run');
    expect(requests).toHaveLength(0);
    for (const mutate of [
      (value: PublishMarketingInput) => { value.revisionRow.approved_hash = 'a'.repeat(64); },
      (value: PublishMarketingInput) => { value.account.enabled = false; },
      (value: PublishMarketingInput) => { value.sources[0]!.observedAt = '2026-10-13T08:44:59Z'; },
      (value: PublishMarketingInput) => { value.sources[0]!.eligible = false; },
      (value: PublishMarketingInput) => { value.config.apiVersionVerifiedAt = ''; },
      (value: PublishMarketingInput) => { value.config.scopes = []; },
    ]) {
      const fresh = fixture(); mutate(fresh.input);
      expect((await publishMarketingRevision(fresh.input)).status).toBe('held'); expect(fresh.requests).toHaveLength(0);
    }
    input.revisionRow.revision.scheduledAt = '2026-10-13T08:44:59Z'; const hash = revisionHash(input.revisionRow.revision);
    input.revisionRow.content_hash = hash; input.revisionRow.approved_hash = hash;
    expect(publicationGate(input, input.config, now)).toBe('publish-window-expired');
  });
  it('creates, polls and publishes once with durable intent before the publish request', async () => {
    const { input, checkpoints, requests } = fixture();
    const outcome = await publishMarketingRevision(input);
    expect(outcome).toMatchObject({ status: 'published', remoteContainerId: '201', remoteMediaId: '301' });
    expect(checkpoints.map(row => row.stage)).toEqual(['container-created', 'publish-intent', 'outcome', 'outcome']);
    expect(requests.filter(row => row.method === 'POST')).toHaveLength(2);
    expect(requests.every(row => !row.url.includes(input.config.accessToken))).toBe(true);
    expect(JSON.stringify(checkpoints)).not.toContain(input.config.accessToken);
  });
  it('creates a text container without automatic Threads publication', async () => {
    const { input, requests } = fixture(true);
    expect((await publishMarketingRevision(input)).status).toBe('published');
    const create = requests.find(row => row.method === 'POST' && row.url.endsWith('/threads'))!;
    expect(create.body).toContain('media_type=TEXT'); expect(create.body).not.toContain('auto_publish_text');
  });
  it('holds drifted assets and revoked approval before remote publication', async () => {
    const drift = fixture(); const fetcher = drift.input.fetcher!;
    drift.input.fetcher = async (url, options) => String(url).includes('assets.example.invalid') ? new Response('different bytes', { headers: { 'Content-Type': 'image/jpeg' } }) : fetcher(url, options);
    expect((await publishMarketingRevision(drift.input)).errorCode).toBe('asset-hash-mismatch');
    expect(drift.requests.filter(row => row.method === 'POST')).toHaveLength(0);
    const revoked = fixture(); revoked.input.revalidate = async () => ({ ...revoked.input, revisionRow: { ...revoked.input.revisionRow, status: 'returned', approved_hash: null } });
    expect((await publishMarketingRevision(revoked.input)).status).toBe('held');
    expect(revoked.requests.filter(row => row.method === 'POST')).toHaveLength(1);
  });
  it('records an uncertain publish then only queries the recorded container', async () => {
    const { input, requests } = fixture(); const fetcher = input.fetcher!;
    input.fetcher = async (url, options) => { if (String(url).includes('/media_publish')) throw new Error('synthetic token must never leak'); return fetcher(url, options); };
    const uncertain = await publishMarketingRevision(input);
    expect(uncertain).toMatchObject({ status: 'reconciliation', errorCode: 'meta-request-uncertain', remoteContainerId: '201' });
    const count = requests.filter(row => row.method === 'POST').length;
    const recovered = await publishMarketingRevision({ ...input, publication: { ...input.publication, status: 'reconciliation', remote_container_id: '201', error_code: uncertain.errorCode } });
    expect(recovered.status).toBe('reconciliation'); expect(requests.filter(row => row.method === 'POST')).toHaveLength(count);
    expect(JSON.stringify(recovered)).not.toContain('synthetic token');
  });
  it('retains published media identity when permalink lookup fails and never republishes it', async () => {
    const { input, requests } = fixture(); const fetcher = input.fetcher!;
    input.fetcher = async (url, options) => String(url).includes('/301?') ? new Response(null, { status: 503 }) : fetcher(url, options);
    const outcome = await publishMarketingRevision(input);
    expect(outcome).toMatchObject({ status: 'reconciliation', remoteMediaId: '301', remoteUrl: null });
    const count = requests.filter(row => row.method === 'POST').length;
    expect((await reconcileMarketingPublication({ ...input, publication: { ...input.publication, status: 'reconciliation', remote_container_id: '201', remote_media_id: '301' } })).status).toBe('reconciliation');
    expect(requests.filter(row => row.method === 'POST')).toHaveLength(count);
  });
  it('persists the known media before a permalink deadline and retains it after a lost receipt fence', async () => {
    const first = fixture(); const fetcher = first.input.fetcher!; const controller = new AbortController(); first.input.signal = controller.signal;
    first.input.fetcher = async (url, options) => {
      if (String(url).includes('/301?')) {
        expect(first.checkpoints.at(-1)).toMatchObject({ stage: 'outcome', status: 'reconciliation', remoteMediaId: '301' });
        controller.abort(); throw new DOMException('QA deadline', 'AbortError');
      }
      expect(options?.signal).toBeDefined(); return fetcher(url, options);
    };
    expect(await publishMarketingRevision(first.input)).toMatchObject({ status: 'reconciliation', remoteMediaId: '301', remoteContainerId: '201' });
    expect(first.checkpoints.at(-1)).toMatchObject({ status: 'reconciliation', remoteMediaId: '301' });
    const second = fixture(); const checkpoint = second.input.checkpoint;
    second.input.checkpoint = async value => {
      if (value.remoteMediaId) throw new Error('QA receipt fence lost');
      await checkpoint(value);
    };
    expect(await publishMarketingRevision(second.input)).toMatchObject({ status: 'reconciliation', errorCode: 'checkpoint-fence-lost', remoteMediaId: '301' });
    expect(second.requests.some(request => request.url.includes('/301?'))).toBe(false);
    expect(second.checkpoints.filter(value => value.stage === 'outcome')).toHaveLength(0);
  });
  it('aborts a pending poll wait at the shared deadline and leaves the containers for a fresh retry', async () => {
    const { input, requests, checkpoints } = fixture(); const fetcher = input.fetcher!; const controller = new AbortController(); input.signal = controller.signal;
    input.fetcher = async (url, options) => String(url).includes('/201?') ? Response.json({ id: '201', status_code: 'IN_PROGRESS' }) : fetcher(url, options);
    input.wait = () => { controller.abort(); return new Promise<void>(() => {}); };
    // No publish intent exists yet, so the deadline is a retryable container failure, not an ambiguity.
    expect(await publishMarketingRevision(input)).toEqual({ status: 'pending', errorCode: 'container-retry', retryCause: 'publication-deadline-exceeded', remoteContainerId: null, remoteMediaId: null, remoteUrl: null });
    expect(checkpoints.at(-1)).toMatchObject({ stage: 'container-retry', status: 'pending', remoteContainerId: null });
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
    expect(requests.some(request => request.url.includes('media_publish'))).toBe(false);
  });
  it('does not write an outcome over a lost checkpoint fence', async () => {
    const { input, requests } = fixture(); const checkpoint = vi.fn(async () => { throw new Error('CAS lost'); }); input.checkpoint = checkpoint;
    expect(await publishMarketingRevision(input)).toMatchObject({ status: 'held', errorCode: 'checkpoint-fence-lost', remoteContainerId: null });
    // The container exists only as an unpublished draft; the lost fence stops before media_publish.
    expect(checkpoint).toHaveBeenCalledTimes(1); expect(requests.filter(row => row.method === 'POST')).toHaveLength(1);
    expect(requests.some(row => row.url.includes('media_publish'))).toBe(false);
  });
  it('only reads a claimed publish intent and rejects a foreign publication owner', async () => {
    const { input, requests } = fixture();
    input.publication.remote_container_id = '201'; input.publication.error_code = 'publish-intent';
    expect((await publishMarketingRevision(input)).status).toBe('reconciliation');
    expect(requests.filter(row => row.method === 'POST')).toHaveLength(0);
    input.publication.user_id = '55555555-5555-4555-8555-555555555555';
    expect((await publishMarketingRevision(input)).errorCode).toBe('publication-binding-mismatch');
  });
  it('keeps bounded unfinished containers pending without publication', async () => {
    const { input, requests } = fixture(); const fetcher = input.fetcher!;
    input.fetcher = async (url, options) => String(url).includes('/201?') ? Response.json({ id: '201', status_code: 'IN_PROGRESS' }) : fetcher(url, options);
    const outcome = await publishMarketingRevision(input);
    expect(outcome).toMatchObject({ status: 'pending', remoteContainerId: '201' });
    expect(requests.filter(row => row.method === 'POST')).toHaveLength(1);
  });
});

describe('inactive Cloud workflow exports', () => {
  it('keeps credentials out of JSON and publish calls free of blind automatic retries', async () => {
    // Retired exports keep the same guarantees as the ones still in place.
    const exports = (await Promise.all(['workflows/marketing', 'workflows/marketing/retired'].map(async directory => (await readdir(directory)).filter(file => file.endsWith('.json')).map(file => ({ directory, file }))))).flat();
    expect(exports.map(entry => entry.file)).toEqual(expect.arrayContaining(['staging-source-check.json', 'dneskai-collection-pilot-worker.json', 'dneskai-production-verification.json', 'dneskai-source-collection.json']));
    for (const { directory, file } of exports) {
      const text = await readFile(`${directory}/${file}`, 'utf8'); const workflow = JSON.parse(text);
      expect(workflow.active).toBe(false); expect(text).not.toContain('n8n-nodes-base.executeCommand');
      for (const node of workflow.nodes.filter((node: { type: string }) => node.type === 'n8n-nodes-base.httpRequest')) {
        if (file === 'staging-source-check.json') {
          expect(node.parameters.genericAuthType).toBe('httpCustomAuth');
          expect(node.parameters.url).toBe('https://own-dashboard-j2ndtg5xk-lukas-kourils-projects.vercel.app/api/marketing/n8n');
          expect(node.credentials.httpCustomAuth.id).toBe('REPLACE_WITH_STAGING_CUSTOM_AUTH_CREDENTIAL_ID');
          expect(JSON.parse(node.parameters.jsonBody)).toEqual({ operation: 'refresh', brand: 'devshark', sourceIds: ['question:rm-js-17', 'question:rm-js-1', 'coding-task:js-digit-sum'] });
          expect(node.parameters.options.redirect.redirect.followRedirects).toBe(false);
          expect(node.parameters.options.timeout).toBe(60_000);
          expect(node.retryOnFail).toBe(false);
          expect(workflow.nodes.map((value: { type: string }) => value.type)).toEqual(['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.code']);
          expect(workflow.settings).toMatchObject({ saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false });
        } else if (file === 'dneskai-collection-pilot-worker.json') {
          expect(node.parameters.genericAuthType).toBe('httpCustomAuth');
          expect(node.parameters.url).toBe('={{ $("Validate isolated scope").first().json.origin + "/api/marketing/dneskai/collect" }}');
          expect(node.parameters.jsonBody).toContain('pilot:true');
          expect(node.credentials.httpCustomAuth.id).toBe('REPLACE_WITH_ISOLATED_COLLECTION_CUSTOM_AUTH_CREDENTIAL_ID');
          expect(node.parameters.options.redirect.redirect.followRedirects).toBe(false);
          expect(node.parameters.options.timeout).toBe(60_000);
          expect(node.retryOnFail).toBe(false);
          expect(workflow.settings).toMatchObject({ executionTimeout: 120, callerPolicy: 'workflowsFromAList', callerIds: 'REPLACE_WITH_THIS_PILOT_WORKFLOW_ID', availableInMCP: false, saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false });
          expect(workflow.nodes.filter((value: { type: string }) => value.type.endsWith('Trigger')).map((value: { type: string }) => value.type)).toEqual(['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.executeWorkflowTrigger']);
          expect(workflow.nodes.some((value: { type: string }) => value.type === 'n8n-nodes-base.webhook')).toBe(false);
        } else if (file === 'dneskai-production-verification.json') {
          expect(node.parameters.genericAuthType).toBe('httpHeaderAuth');
          expect(node.parameters.url).toBe('={{ $("Validate production scope").first().json.origin + "/api/marketing/dneskai/collect" }}');
          expect(node.parameters.jsonBody).toBe('={{ JSON.stringify({projectId:$json.projectId,runId:$json.runId,manual:true}) }}');
          expect(node.credentials.httpHeaderAuth.id).toBe('REPLACE_WITH_PRODUCTION_COLLECTION_CREDENTIAL_ID');
          expect(node.parameters.options.redirect.redirect.followRedirects).toBe(false);
          expect(node.retryOnFail).toBe(false);
          expect(workflow.settings).toMatchObject({executionTimeout:120,callerPolicy:'workflowsFromAList',callerIds:'REPLACE_WITH_THIS_PRODUCTION_WORKFLOW_ID',availableInMCP:false,saveManualExecutions:false});
          expect(workflow.nodes.filter((value:{type:string})=>value.type.endsWith('Trigger')).map((value:{type:string})=>value.type)).toEqual(['n8n-nodes-base.manualTrigger','n8n-nodes-base.executeWorkflowTrigger']);
        } else if (file === 'dneskai-source-collection.json') {
          expect(node.parameters.genericAuthType).toBe('httpHeaderAuth');
          expect(node.parameters.url).toBe('https://own-dashboard-tau.vercel.app/api/marketing/dneskai/collect');
          expect(node.credentials.httpHeaderAuth.id).toBe('REPLACE_WITH_HEADER_AUTH_CREDENTIAL_ID');
          expect(node.retryOnFail).toBe(false);
          expect(workflow.settings.saveDataSuccessExecution).toBe('none');
        } else {
          expect(node.parameters.genericAuthType).toBe('httpHeaderAuth'); expect(node.parameters.url).toContain('example.invalid');
        }
        if (node.name.startsWith('Publish') || node.name.startsWith('Execute')) expect(node.retryOnFail).toBe(false);
      }
    }
  });
});

describe('retired staging source check export', () => {
  it('keeps staging source prose, URLs and transport fields out of the manual summary', async () => {
    const workflow = JSON.parse(await readFile('workflows/marketing/retired/staging-source-check.json', 'utf8'));
    const node = workflow.nodes.find((value: { type: string }) => value.type === 'n8n-nodes-base.code');
    const summarize = new Function('$input', node.parameters.jsCode);
    const marker = 'PRIVATE_TRANSPORT_AND_SOURCE_SENTINEL';
    const packets = ['question:rm-js-17', 'question:rm-js-1', 'coding-task:js-digit-sum'].map((sourceId, index) => ({ sourceId, eligible: index !== 1, contentHash: 'a'.repeat(64), content: { body: marker }, canonicalUrl: `https://example.invalid/${marker}` }));
    const response = { brand: 'devshark', packets, held: [{ sourceId: 'question:rm-js-1' }], dropped: 0, headers: { cookie: marker }, raw: marker };
    const result = summarize({ all: () => [{ json: response }] });
    expect(result[0].json).toMatchObject({ status: 'checked', requestedCount: 3, eligibleCount: 2, heldCount: 1, missingCount: 0 });
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(() => summarize({ all: () => [{ json: { ...response, packets: [packets[0], packets[0]] } }] })).toThrow();
    expect(() => summarize({ all: () => [{ json: { ...response, brand: 'dneskai' } }] })).toThrow();
  });
});
