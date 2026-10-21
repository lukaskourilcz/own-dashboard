import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type Node = { name: string; type: string; typeVersion: number; parameters: Record<string, unknown>; retryOnFail?: boolean; onError?: string };
const workflow = JSON.parse(readFileSync('workflows/marketing/retired/dneskai-collection-pilot-worker.json', 'utf8')) as {
  active: boolean; nodes: Node[]; settings: Record<string, unknown>; pinData: Record<string, unknown>;
  connections: Record<string, { main: { node: string }[][] }>;
};
const projectId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const workerId = 'OFFLINEworker123';
const origin = 'https://own-dashboard-offline-lukas-kourils-projects.vercel.app';
const now = Date.parse('2026-10-13T20:30:00Z');
const expiry = Date.parse('2026-10-15T09:10:00Z');
const scopeName = 'Validate isolated scope';
const progressName = 'Bounded safe progress';
const tailName = 'Recheck and project continuation';
function node(name: string) { const found = workflow.nodes.find(node => node.name === name); if (!found) throw new Error('missing-node'); return found; }
function code(name: string) { const value = node(name).parameters.jsCode; if (typeof value !== 'string') throw new Error('missing-code'); return value; }
function evaluate(name: string, value: unknown, options: { clock?: number; scope?: Record<string, unknown>; progress?: Record<string, unknown>; replacements?: Record<string, string>; rows?: unknown[]; actualWorkerId?: string } = {}) {
  let source = code(name);
  const replacements = {
    REPLACE_WITH_ISOLATED_DNESKAI_PROJECT_UUID: projectId,
    REPLACE_WITH_ISOLATED_OWN_PREVIEW_ORIGIN: origin,
    REPLACE_WITH_THIS_PILOT_WORKFLOW_ID: workerId,
    ...options.replacements,
  };
  for (const [placeholder, actual] of Object.entries(replacements)) source = source.replaceAll(placeholder, actual);
  const result = vm.runInNewContext(`(()=>{${source}})()`, {
    $workflow: { id: options.actualWorkerId ?? workerId },
    $input: { all: () => (options.rows ?? [value]).map(json => ({ json })) },
    $: (name: string) => ({ first: () => ({ json: name === scopeName ? options.scope : options.progress }) }),
    // No URL, fetch, credentials, Buffer, filesystem or n8n globals beyond the documented node data.
    Date: { now: () => options.clock ?? now, parse: Date.parse },
  }, { timeout: 1000 });
  return JSON.parse(JSON.stringify(result)) as { json: Record<string, unknown> }[];
}
function scope(value: unknown = {}) { return evaluate(scopeName, value)[0].json; }

describe('retired isolated native collection continuation, offline VM only', () => {
  it('has only manual/internal triggers, one bounded POST, a time wait and detached self-call', () => {
    expect(workflow.active).toBe(false);
    expect(workflow.nodes).toHaveLength(9);
    expect(workflow.nodes.map(node => node.type)).not.toContain('n8n-nodes-base.scheduleTrigger');
    expect(workflow.nodes.filter(node => /Trigger$/.test(node.type)).map(node => node.type).sort()).toEqual(['n8n-nodes-base.executeWorkflowTrigger', 'n8n-nodes-base.manualTrigger']);
    expect(workflow.nodes.filter(node => /webhook|executeCommand|openAi|anthropic/i.test(node.type))).toEqual([]);
    expect(workflow.settings).toMatchObject({ executionTimeout: 120, availableInMCP: false, callerPolicy: 'workflowsFromAList', callerIds: 'REPLACE_WITH_THIS_PILOT_WORKFLOW_ID', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false });
    expect(workflow.pinData).toEqual({});
    const http = node('Collect one registered pilot tick');
    expect(http.parameters).toMatchObject({ method: 'POST', genericAuthType: 'httpCustomAuth', options: { timeout: 60000, redirect: { redirect: { followRedirects: false } } } });
    expect(http.retryOnFail).toBe(false); expect(http.onError).toBe('stopWorkflow');
    expect(http.parameters.jsonBody).toContain('pilot:true');
    expect(node('Wait15 before next tick').parameters).toEqual({ resume: 'timeInterval', amount: 15, unit: 'seconds' });
    expect(node('Detach next internal tick').parameters).toMatchObject({ source: 'database', workflowId: { value: '={{ $workflow.id }}', mode: 'id' }, mode: 'once', options: { waitForSubWorkflow: false } });
    expect(workflow.connections['Recheck and project continuation'].main[0][0].node).toBe('Detach next internal tick');
    expect(workflow.connections['Continue same pilot run'].main).toHaveLength(1);
  });
  it('keeps the committed export unusable until exact scoped configuration is supplied', () => {
    expect(() => vm.runInNewContext(`(()=>{${code(scopeName)}})()`, { $workflow: { id: workerId }, $input: { all: () => [{ json: {} }] }, Date })).toThrow('configuration-required');
    expect(() => evaluate(scopeName, {}, { actualWorkerId: 'differentWorker' })).toThrow('configuration-required');
  });
  it.each(['https://own-dashboard-tau.vercel.app', 'https://own-dashboard-offline-lukas-kourils-projects.vercel.app/path', `${origin}?key=x`, `${origin}:443`, 'http://own-dashboard-offline-lukas-kourils-projects.vercel.app', 'https://user:password@own-dashboard-offline-lukas-kourils-projects.vercel.app', 'https://evil.example'])('refuses production, paths or foreign target: %s', value => {
    expect(() => evaluate(scopeName, {}, { replacements: { REPLACE_WITH_ISOLATED_OWN_PREVIEW_ORIGIN: value } })).toThrow('configuration-required');
  });
  it('carries exactly the same registered run through multiple native continuations', () => {
    let control: Record<string, unknown> = {};
    let clock = now;
    for (let index = 0; index < 3; index++) {
      const current = evaluate(scopeName, control, { clock })[0].json;
      const progress = evaluate(progressName, { runId, status: index === 2 ? 'partial' : 'running', continue: index < 2 }, { clock, scope: current })[0].json;
      expect(progress).toMatchObject({ projectId, runId, ticks: index + 1, approvalRequired: true });
      if (index < 2) {
        clock += 15000;
        control = evaluate(tailName, progress, { clock, scope: current, progress })[0].json;
        expect(Object.keys(control)).toEqual(['projectId', 'runId', 'ticks', 'startedAt']);
        expect(control.startedAt).toBe(now);
      } else expect(progress).toMatchObject({ status: 'partial', continue: false });
    }
  });
  it('drops response credentials, source prose, headers and unknown fields before child dispatch', () => {
    const current = scope();
    const progress = evaluate(progressName, { runId, status: 'running', continue: true, Authorization: 'PRIVATE', source: 'PRIVATE SOURCE', responseHeaders: { cookie: 'PRIVATE' } }, { scope: current })[0].json;
    const child = evaluate(tailName, progress, { scope: current, progress })[0].json;
    expect(JSON.stringify(progress)).not.toContain('PRIVATE'); expect(JSON.stringify(child)).not.toContain('PRIVATE');
    expect(child).toEqual({ projectId, runId, ticks: 1, startedAt: now });
  });
  it.each(['complete', 'partial', 'held', 'failed'])('stops terminal %s without another tick', status => {
    const current = scope(); const progress = evaluate(progressName, { runId, status, continue: false }, { scope: current })[0].json;
    expect(progress).toMatchObject({ status, continue: false, approvalRequired: true });
    expect(() => evaluate(tailName, progress, { scope: current, progress })).toThrow('continuation-held');
    expect(() => evaluate(progressName, { runId, status, continue: true }, { scope: current })).toThrow('response-invalid');
  });
  it('does not mislabel a busy lease as successful or spawn a duplicate child', () => {
    const current = scope(); const progress = evaluate(progressName, { runId, status: 'running', continue: false }, { scope: current })[0].json;
    expect(progress).toMatchObject({ status: 'running', continue: false, errorCode: 'collection-pilot-run-busy' });
    expect(() => evaluate(tailName, progress, { scope: current, progress })).toThrow('continuation-held');
  });
  it('holds at the40th unfinished tick without inventing completion or a new run', () => {
    const current = scope({ projectId, runId, ticks: 39, startedAt: now });
    const progress = evaluate(progressName, { runId, status: 'running', continue: true }, { scope: current })[0].json;
    expect(progress).toMatchObject({ ticks: 40, status: 'running', continue: false, errorCode: 'collection-pilot-tick-limit' });
    expect(() => evaluate(scopeName, { projectId, runId, ticks: 40, startedAt: now })).toThrow('continuation-invalid');
    expect(() => evaluate(tailName, progress, { scope: current, progress })).toThrow('continuation-held');
  });
  it('blocks expiry before a tick and rechecks clock after waiting before a detached call', () => {
    expect(() => evaluate(scopeName, {}, { clock: expiry - 59000 })).toThrow('expired');
    const current = evaluate(scopeName, {}, { clock: expiry - 80000 })[0].json;
    const progress = evaluate(progressName, { runId, status: 'running', continue: true }, { clock: expiry - 74000, scope: current })[0].json;
    expect(progress).toMatchObject({ continue: false, errorCode: 'collection-pilot-expiry-near' });
    const earlier = evaluate(progressName, { runId, status: 'running', continue: true }, { clock: expiry - 80000, scope: current })[0].json;
    expect(() => evaluate(tailName, earlier, { clock: expiry - 59000, scope: current, progress: earlier })).toThrow('continuation-held');
  });
  it.each([{ projectId: 'foreign', runId, ticks: 1, startedAt: now }, { projectId, runId: 'wrong', ticks: 1, startedAt: now }, { projectId, runId, ticks: -1, startedAt: now }, { projectId, runId, ticks: 1.5, startedAt: now }, { projectId, runId, ticks: 1, startedAt: now + 1 }, { projectId, runId, ticks: 1, startedAt: now - 4800001 }, { projectId, runId, ticks: 1, startedAt: now, source: 'PRIVATE' }])('rejects forged or unbounded control state before HTTP', value => {
    expect(() => evaluate(scopeName, value)).toThrow('continuation-invalid');
  });
  it('rejects changed run identities, malformed responses or multiple records', () => {
    const current = scope({ projectId, runId, ticks: 1, startedAt: now });
    for (const value of [{ runId: projectId, status: 'running', continue: true }, { runId, status: 'approved', continue: false }, { runId, status: 'running' }]) expect(() => evaluate(progressName, value, { scope: current })).toThrow('response-invalid');
    expect(() => evaluate(progressName, {}, { scope: current, rows: [{ runId, status: 'running', continue: true }, {}] })).toThrow('response-invalid');
  });
});
