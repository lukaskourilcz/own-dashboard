import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe,it,expect } from 'vitest';
const workflow=JSON.parse(readFileSync('workflows/marketing/retired/dneskai-production-verification.json','utf8'));
const projectId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222',workerId='OFFLINEworker123';
const now=Date.parse('2026-10-13T20:30:00Z');
function execute(value:unknown,actualWorker=workerId,clock=now){
 let code=workflow.nodes.find((node:{name:string})=>node.name==='Validate production scope').parameters.jsCode;
 for(const [key,value] of Object.entries({REPLACE_WITH_PRODUCTION_DNESKAI_PROJECT_UUID:projectId,REPLACE_WITH_REGISTERED_PRODUCTION_RUN_UUID:runId,REPLACE_WITH_THIS_PRODUCTION_WORKFLOW_ID:workerId,REPLACE_WITH_APPROVED_EXPIRY:'2026-10-13T21:00:00Z'}))code=code.replaceAll(key,value);
 return vm.runInNewContext(`(()=>{${code}})()`,{$workflow:{id:actualWorker},$input:{all:()=>[{json:value}]},Date:{now:()=>clock,parse:Date.parse}},{timeout:1000});
}
describe('retired manual production workflow offline contract',()=>{
 it('cannot admit a new run and binds even its first manual call to the registered run',()=>{
  const initial=execute({})[0].json;expect(initial).toMatchObject({projectId,runId,ticks:0,origin:'https://own-dashboard-tau.vercel.app'});
  expect(execute({projectId,runId,ticks:1,startedAt:now})[0].json.runId).toBe(runId);
  expect(()=>execute({projectId,runId:projectId,ticks:1,startedAt:now})).toThrow('continuation-invalid');
  expect(()=>execute({},'OTHERworker123')).toThrow('configuration-required');
  expect(()=>execute({},workerId,Date.parse('2026-10-13T21:00:00Z'))).toThrow('expired');
 });
 it('has no public trigger, cookie, provider key, scheduler or HTTP retry',()=>{
  expect(workflow.active).toBe(false);expect(workflow.pinData).toEqual({});
  expect(workflow.nodes.filter((node:{type:string})=>/Trigger$/.test(node.type)).map((node:{type:string})=>node.type).sort()).toEqual(['n8n-nodes-base.executeWorkflowTrigger','n8n-nodes-base.manualTrigger']);
  const http=workflow.nodes.find((node:{type:string})=>node.type==='n8n-nodes-base.httpRequest');
  expect(http.parameters.genericAuthType).toBe('httpHeaderAuth');expect(http.parameters.jsonBody).toContain('runId:$json.runId,manual:true');expect(http.parameters.jsonBody).not.toContain('pilot:');
  expect(http.retryOnFail).toBe(false);expect(http.parameters.options.redirect.redirect.followRedirects).toBe(false);
  expect(workflow.settings).toMatchObject({executionTimeout:120,saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,availableInMCP:false,callerPolicy:'workflowsFromAList',callerIds:'REPLACE_WITH_THIS_PRODUCTION_WORKFLOW_ID'});
 });
});
