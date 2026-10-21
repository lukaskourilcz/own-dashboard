import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { describe,expect,it } from 'vitest';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';

type Workflow={active:boolean;nodes:Array<{name:string;type:string;parameters:{jsCode?:string;rule?:{interval:Array<{expression:string}>};genericAuthType?:string;url?:string};retryOnFail?:boolean}>;settings:Record<string,unknown>;connections:Record<string,unknown>};
const load=async(name:string)=>JSON.parse(await readFile(`workflows/marketing/${name}.json`,'utf8')) as Workflow;
function clock(instant:string){
 const date=/^\d{4}-\d{2}-\d{2}$/.test(instant)?instant:pragueMarketingDate(new Date(instant));
 const shift=(days:number)=>clock(new Date(Date.parse(`${date}T12:00:00Z`)+days*86400000).toISOString().slice(0,10));
 return {setZone:(zone:string)=>{expect(zone).toBe('Europe/Prague');return clock(date);},toISODate:()=>date,weekday:new Date(`${date}T12:00:00Z`).getUTCDay()||7,plus:({days}:{days:number})=>shift(days),minus:({days}:{days:number})=>shift(-days)};
}
function execute(workflow:Workflow,name:string,input:Array<{json:Record<string,unknown>}>=[],now='2026-10-13T12:00:00Z'){
 const source=workflow.nodes.find(node=>node.name===name)?.parameters.jsCode;if(!source)throw new Error('test-workflow-code-missing');
 const raw=vm.runInNewContext(`(()=>{${source}\n})()`,{$input:{all:()=>input},$now:clock(now)},{timeout:1000});
 return JSON.parse(JSON.stringify(raw)) as Array<{json:Record<string,unknown>;pairedItem?:{item:number}}>;
}
describe('retired DNESKAi daily preparation export',()=>{
 it('prepares DNESKAi for Prague today only and refuses to silently truncate overcapacity or use held sources',async()=>{
  const daily=await load('retired/daily-preparation');
  expect(execute(daily,'Brand calendar scopes',[],'2026-10-13T22:30:00Z')).toEqual([{json:{operation:'discover',brand:'dneskai',date:'2026-10-14'}}]);
  const response={brand:'dneskai',entries:[{id:'TEST-ONLY-ENTRY',platform:'instagram'}],packets:[{eligible:true}],planning:{calendarHasMore:false},heldEntries:[]};
  expect(execute(daily,'Actual calendar entries',[{json:response}])).toEqual([{json:{operation:'enqueue',brand:'dneskai',entryId:'TEST-ONLY-ENTRY',platform:'instagram'},pairedItem:{item:0}}]);
  const oversized={...response,entries:Array.from({length:9},(_,index)=>({id:`TEST-ONLY-${index}`,platform:'instagram'}))};
  expect(execute(daily,'Actual calendar entries',[{json:oversized}])).toEqual([]);
  expect(execute(daily,'Daily preparation holds',[{json:oversized}])[0].json).toMatchObject({status:'held',holdCode:'daily-capacity-review-required',observedEntryCount:9,remainingAdmissions:null});
  const split={...response,entries:oversized.entries.slice(0,5)};
  expect(execute(daily,'Actual calendar entries',[{json:split},{json:split}])).toEqual([]);
  expect(execute(daily,'Daily preparation holds',[{json:split},{json:split}])[0].json).toMatchObject({status:'held',holdCode:'daily-capacity-review-required',totalRequestedCount:10});
  expect(execute(daily,'Actual calendar entries',[{json:{...response,packets:[{eligible:false}]}}])).toEqual([]);
  expect(execute(daily,'Daily preparation holds',[{json:{...response,packets:[{eligible:false}]}}])[0].json).toMatchObject({status:'held',holdCode:'fresh-approved-source-required'});
  expect(execute(daily,'Actual calendar entries',[{json:{...response,brand:'devshark'}}])).toEqual([]);
 });
});
describe('actual inactive n8n Code snippets with native item envelopes and explicit capability holds',()=>{
 it('plans Sunday itself through Saturday and exposes42 requested deliverables without enqueue/execute/provider nodes',async()=>{
  const weekly=await load('devshark-weekly-preparation');
  const expected=['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24'];
  for(const now of ['2026-10-13T12:00:00Z','2026-10-17T22:30:00Z'])expect(execute(weekly,'Sunday seven-day scope',[],now)).toEqual([{json:{operation:'discover',brand:'devshark',dates:expected}}]);
  expect(weekly.nodes.find(node=>node.type==='n8n-nodes-base.scheduleTrigger')?.parameters.rule?.interval[0].expression).toBe('0 7 * * 0');
  expect(weekly.nodes.some(node=>/enqueue|execute|publish/i.test(node.name))).toBe(false);
  const marker='TEST-ONLY-PRIVATE-SOURCE-TRANSPORT-MARKER';
  const summary=execute(weekly,'Weekly preparation holds',[{json:{brand:'devshark',dates:expected,entries:Array.from({length:21},()=>({})),heldEntries:Array.from({length:21},()=>({})),heldUnsupportedStoryCount:21,packets:[{body:marker}],planning:{calendarObservedCount:42,calendarHasMore:false},message:marker}}])[0];
  expect(summary.json).toMatchObject({observedDeliverableCount:42,supportedReleasedCount:21,heldUnsupportedStoryCount:21,requestedDeliverableQuota:42,automaticallyGenerated:0,providerCalls:0,status:'held',remainingAdmissions:null,ownerReviewRequired:true});
  expect(summary.json.holdCodes).toEqual(['weekly-paid-admission-extension-required','thread-variants-unimplemented','story-publication-unsupported','weekly-asset-window-required']);
  expect(JSON.stringify(summary)).not.toContain(marker);
  expect(execute(weekly,'Weekly preparation holds',[{json:{error:marker}}])[0].json.holdCodes).toEqual(['source-discovery-unavailable']);
 });
 it('keeps weekly review manual/read-only, with observed persisted counts and unavailable provider metrics',async()=>{
  const review=await load('weekly-review');expect(review.nodes.some(node=>node.type==='n8n-nodes-base.scheduleTrigger')).toBe(false);
  expect(execute(review,'Previous completed week scopes',[],'2026-10-18T05:00:00Z')).toEqual(['devshark','dneskai'].map(brand=>({json:{operation:'weekly-report',brand,weekStartsOn:'2026-10-11'}})));
  const marker='TEST-ONLY-PRIVATE-REPORT-MARKER';
  const summary=execute(review,'Read-only weekly report',[{json:{mode:'read-only',brand:'devshark',coverage:'complete',sampleSize:2,hasMore:false,window:{startDate:'2026-10-11'},statusCounts:{published:1,failed:1},caption:marker}}])[0].json;
  expect(summary).toMatchObject({mode:'read-only',coverage:'complete',sampleSize:2,statusCounts:{published:1,failed:1,queued:null},providerMetricsStatus:'unavailable',providerMetrics:null,weeklyComparison:null,providerCalls:0});
  expect(JSON.stringify(summary)).not.toContain(marker);
  expect(execute(review,'Read-only weekly report',[{json:{error:marker}}])[0].json).toMatchObject({status:'held',coverage:'unavailable',sampleSize:null,errorCode:'weekly-report-unavailable',providerMetrics:null});
 });
 it('preserves inactive/no-save/redirect refusal/placeholder auth and no retries for paid execution',async()=>{
  for(const file of ['retired/daily-preparation','devshark-weekly-preparation','weekly-review']){
   const workflow=await load(file);expect(workflow.active).toBe(false);expect(workflow.settings).toMatchObject({timezone:'Europe/Prague',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,saveExecutionProgress:false});
   for(const node of workflow.nodes.filter(node=>node.type==='n8n-nodes-base.httpRequest')){expect(node.parameters.genericAuthType).toBe('httpHeaderAuth');expect(node.parameters.url).toContain('example.invalid');if(node.name.startsWith('Execute'))expect(node.retryOnFail).toBe(false);}
   expect(JSON.stringify(workflow)).not.toContain('n8n-nodes-base.executeCommand');
  }
 });
});
