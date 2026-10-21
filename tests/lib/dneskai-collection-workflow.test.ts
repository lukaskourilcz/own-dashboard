import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const workflow = JSON.parse(readFileSync('workflows/marketing/retired/dneskai-source-collection.json', 'utf8'));
const progress = workflow.nodes.find((node: { name: string }) => node.name === 'Collection progress').parameters.jsCode;
const runId = '11111111-1111-4111-8111-111111111111';
function execute(value: unknown, index = 0) {
  return JSON.parse(JSON.stringify(vm.runInNewContext(`(()=>{${progress}})()`, {
    $input: { all: () => [{ json: value }] }, $runIndex: index,
  }, { timeout: 1000 })));
}
// Retired under #120: the pg_cron tick replaced this n8n timer. The export keeps its guarantees.
describe('DNESKAi evening collection workflow (retired)', () => {
  it('targets the requested domain at22Prague with no publisher, no stored payloads and no unsafe request retries', () => {
    expect(workflow.active).toBe(false);
    expect(workflow.settings).toMatchObject({ timezone: 'Europe/Prague', saveDataSuccessExecution: 'none', saveDataErrorExecution: 'none', saveManualExecutions: false, saveExecutionProgress: false });
    expect(workflow.nodes.find((node: { type: string }) => node.type.endsWith('.scheduleTrigger')).parameters.rule.interval[0].expression).toBe('*/5 22-23 * * *');
    const http = workflow.nodes.filter((node: { type: string }) => node.type.endsWith('.httpRequest'));
    expect(http).toHaveLength(1);
    expect(http[0]).toMatchObject({ retryOnFail: false, onError: 'stopWorkflow', parameters: {
      url: 'https://own-dashboard-tau.vercel.app/api/marketing/dneskai/collect', genericAuthType: 'httpHeaderAuth',
      options: { redirect: { redirect: { followRedirects: false } } },
    } });
    expect(http[0].parameters.jsonBody).toContain('projectId');
    expect(http[0].parameters.jsonBody).not.toContain('runId');
    expect(workflow.settings.executionTimeout).toBe(120);
    expect(workflow.nodes).toHaveLength(5);
    expect(workflow.nodes.some((node: { type: string }) => node.type.endsWith('.wait'))).toBe(false);
    expect(JSON.stringify(workflow)).not.toMatch(/"operation":"(?:approve|publish|execute)"/);
  });
  it('keeps the exact durable run identity and strips source data before waiting', () => {
    expect(execute({ runId, status: 'running', continue: true, token: 'PRIVATE', candidates: [{ text: 'PRIVATE' }] })).toEqual([
      { json: { runId, status: 'running', continue: true, approvalRequired: true } },
    ]);
    expect(execute({ runId, status: 'running', continue: true }, 39)[0].json).toMatchObject({ continue: true, status: 'running' });
  });
  it.each(['complete', 'partial', 'held', 'failed'])('stops on%s without inventing approval', status => {
    expect(execute({ runId, status, continue: false })[0].json).toMatchObject({ status, continue: false, approvalRequired: true });
    expect(() => execute({ runId, status, continue: true })).toThrow('collection-response-invalid');
  });
  it.each([{ runId: 'wrong', status: 'running', continue: true }, { runId, status: 'approved', continue: false }, { runId, status: 'running' }])('rejects malformed responses', value => {
    expect(() => execute(value)).toThrow('collection-response-invalid');
  });
});
