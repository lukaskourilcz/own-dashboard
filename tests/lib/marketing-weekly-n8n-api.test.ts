import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import question from '../../templates/marketing/benchmarks/devshark-question.json';
const mocks=vi.hoisted(()=>({admin:vi.fn(),sync:vi.fn(),querySources:vi.fn(),ingest:vi.fn(),enqueue:vi.fn(),execute:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>mocks.admin()}));
vi.mock('@/lib/marketing/orchestrator',()=>({synchronizeMarketingSources:(...args:unknown[])=>mocks.sync(...args),enqueueCalendarMarketingJob:(...args:unknown[])=>mocks.enqueue(...args),executeOrchestratedMarketingJob:(...args:unknown[])=>mocks.execute(...args),publishDueMarketing:vi.fn(),reconcileStoredMarketingPublication:vi.fn()}));
vi.mock('@/lib/marketing/source-refresh',()=>({refreshSource:vi.fn(),refreshMarketingSources:(...args:unknown[])=>mocks.querySources(...args)}));
vi.mock('@/lib/marketing/store',()=>({ingestSource:(...args:unknown[])=>mocks.ingest(...args)}));
import { POST } from '@/app/api/marketing/n8n/route';
const owner='11111111-1111-4111-8111-111111111111',secret='TEST-ONLY-N8N-SECRET-'.repeat(3);
const dates=['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24'];
type Row=Record<string,unknown>;
function database(tables:Record<string,Row[]>={}){
 const queries:Array<{table:string;filters:unknown[];limit:number|null}>=[];
 const db={from(table:string){
  const trace={table,filters:[]as unknown[],limit:null as number|null};queries.push(trace);
  const predicates:Array<(row:Row)=>boolean>=[];
  const get=(row:Row,key:string):unknown=>key.split('.').reduce<unknown>((value,part)=>value&&typeof value==='object'?(value as Row)[part]:undefined,row);
  const query={select:()=>query,eq:(key:string,value:unknown)=>{trace.filters.push([key,value]);predicates.push(row=>get(row,key)===value);return query;},in:(key:string,values:unknown[])=>{trace.filters.push([key,values]);predicates.push(row=>values.includes(get(row,key)));return query;},
   gte:(key:string,value:string)=>{trace.filters.push([key,'gte',value]);predicates.push(row=>String(get(row,key))>=value);return query;},lt:(key:string,value:string)=>{trace.filters.push([key,'lt',value]);predicates.push(row=>String(get(row,key))<value);return query;},order:()=>query,limit:(count:number)=>{trace.limit=count;return query;},
   then:(resolve:(value:{data:Row[];error:null})=>unknown)=>Promise.resolve({data:(tables[table]??[]).filter(row=>predicates.every(predicate=>predicate(row))).slice(0,trace.limit??10000),error:null}).then(resolve)};return query;
 }};return {db,queries};
}
function request(body:unknown,authorization=`Bearer ${secret}`){return new Request('https://example.invalid/api/marketing/n8n',{method:'POST',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify(body)});}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));Object.values(mocks).forEach(mock=>mock.mockReset());mocks.admin.mockReturnValue(database().db);
 vi.stubEnv('MARKETING_OWNER_ID',owner);vi.stubEnv('MARKETING_N8N_SECRET',secret);
 mocks.sync.mockResolvedValue({packets:[],held:[],nextCursor:null,observedAt:'2026-10-13T12:00:00Z',noEditionDates:[],dropped:0});
 mocks.querySources.mockImplementation(async({date}:{date:string})=>({packets:[{...question,sourceId:`TEST-ONLY-daily:${date}`,canonicalUrl:`https://devshark.app/daily/${date}`}],held:[],nextCursor:null,observedAt:'2026-10-13T12:00:00Z',noEditionDates:[],dropped:0}));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe('bounded authenticated Sunday discovery and read-only weekly reporting',()=>{
 it.each([
  {operation:'discover',brand:'devshark',dates:[...dates,'2026-10-25']},
  {operation:'discover',brand:'devshark',dates:['2026-10-19','2026-10-20']},
  {operation:'discover',brand:'devshark',dates:['2026-10-18','2026-10-20']},
  {operation:'discover',brand:'devshark',dates:[dates[0],dates[0]]},
  {operation:'discover',brand:'devshark',dates,cursor:'cannot-combine'},
  {operation:'discover',brand:'devshark',dates,date:dates[0]},
  {operation:'weekly-report',weekStartsOn:'2026-10-18',ownerId:'foreign'},
 ])('rejects invalid scope before privileged reads or producer writes:%j',async body=>{
  const response=await POST(request(body));expect(response.status).toBe(400);expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.querySources).not.toHaveBeenCalled();expect(mocks.ingest).not.toHaveBeenCalled();
 });
 it.each([{operation:'discover',brand:'dneskai'},{operation:'discover',brand:'dneskai',date:'2026-10-14'},{operation:'discover',brand:'dneskai',dates:['2026-10-13']},{operation:'weekly-report',brand:'dneskai',weekStartsOn:'2026-10-18'}])('refuses the retired DNESKAi operation %j with 410 before any read (audit finding cost-06)',async body=>{
  const response=await POST(request(body));expect(response.status).toBe(410);expect(await response.json()).toEqual({code:'route-retired'});
  expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.querySources).not.toHaveBeenCalled();expect(mocks.ingest).not.toHaveBeenCalled();
 });
 it('never accepts an unauthorized discovery or report',async()=>{
  mocks.admin.mockClear();for(const operation of ['discover','weekly-report'])expect((await POST(request({operation,brand:'devshark',weekStartsOn:'2026-10-18'},'Bearer wrong'))).status).toBe(401);expect(mocks.admin).not.toHaveBeenCalled();
 });
 it('refreshes actual dated producer identities and reports all42 slots including21 unsupported Stories without enqueueing',async()=>{
  const entries=dates.flatMap((date,day)=>Array.from({length:6},(_,index)=>({id:`TEST-ONLY-${day}-${index}`,user_id:owner,campaign_id:'TEST-ONLY-CAMPAIGN',date,kind:index===0?'carousel':index<3?'thread':'story',platform:index===0||index>=3?'instagram':'threads',status:index>=3?'blocked':'planned',needs_review:index>=3,local_time:'18:00'})));
  const state=database({marketing_campaigns:[{id:'TEST-ONLY-CAMPAIGN',user_id:owner,brand:'devshark',status:'active'}],marketing_calendar_entries:[...entries,{...entries[0],user_id:'foreign'}]});mocks.admin.mockReturnValue(state.db);
  const response=await POST(request({operation:'discover',brand:'devshark',dates}));expect(response.status).toBe(200);const body=await response.json();
  expect(body.entries).toHaveLength(21);expect(body.heldEntries).toHaveLength(21);expect(body.heldUnsupportedStoryCount).toBe(21);expect(body.planning).toMatchObject({calendarObservedCount:42,calendarHasMore:false,coverage:'complete',weeklyGenerationImplemented:false,remainingAdmissions:null,limits:{calendarEntries:42,jobAdmissionsPerRolling24Hours:8,pilotLifetimeJobs:3,pilotReservedUsd:0.75}});
  expect(mocks.querySources).toHaveBeenCalledTimes(7);expect(mocks.ingest).toHaveBeenCalledTimes(7);expect(mocks.sync).not.toHaveBeenCalled();
  for(const [index,date]of dates.entries()){expect(mocks.querySources.mock.calls[index][0]).toMatchObject({brand:'devshark',date,signal:expect.any(AbortSignal)});expect(mocks.ingest.mock.calls[index][1]).toBe(owner);expect(mocks.ingest.mock.calls[index][2].eligible).toBe(false);}
  expect(mocks.enqueue).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();expect(question.eligible).toBe(false);expect(state.queries[1].limit).toBe(43);
 });
 it('holds a producer date mismatch, detects calendar overflow, and does not claim future QOTD coverage',async()=>{
  mocks.querySources.mockResolvedValue({packets:[question],held:[],nextCursor:null,observedAt:'2026-10-13T12:00:00Z',noEditionDates:[],dropped:0});
  const state=database({marketing_campaigns:[{id:'campaign',user_id:owner,brand:'devshark',status:'active'}],marketing_calendar_entries:Array.from({length:43},(_,index)=>({id:String(index),campaign_id:'campaign',user_id:owner,date:dates[0],kind:'carousel',platform:'instagram',status:'planned',needs_review:false}))});mocks.admin.mockReturnValue(state.db);
  const response=await POST(request({operation:'discover',brand:'devshark',dates:[dates[0]]}));const body=await response.json();
  expect(body.packets).toEqual([]);expect(body.held).toEqual([{sourceId:question.sourceId,reason:'daily-source-date-mismatch'}]);expect(mocks.ingest).not.toHaveBeenCalled();
  expect(body.entries).toHaveLength(42);expect(body.planning).toMatchObject({coverage:'partial',calendarHasMore:true,calendarObservedCount:42});
 });
 it('reports only owned actual scheduled publication statuses and no provider metrics/baseline',async()=>{
  const state=database({marketing_publications:[
   {user_id:owner,status:'published',platform:'instagram',scheduled_at:'2026-10-18T16:00:00Z',marketing_revisions:{brand:'devshark'}},
   {user_id:owner,status:'queued',platform:'threads',scheduled_at:'2026-10-19T16:00:00Z',marketing_revisions:{brand:'devshark'}},
   {user_id:'foreign',status:'published',platform:'instagram',scheduled_at:'2026-10-18T16:00:00Z',marketing_revisions:{brand:'devshark'}},
   {user_id:owner,status:'published',platform:'instagram',scheduled_at:'2026-10-18T16:00:00Z',marketing_revisions:{brand:'dneskai'}},
   {user_id:owner,status:'published',platform:'instagram',scheduled_at:'2026-10-24T22:00:00Z',marketing_revisions:{brand:'devshark'}},
  ]});mocks.admin.mockReturnValue(state.db);
  const response=await POST(request({operation:'weekly-report',brand:'devshark',weekStartsOn:dates[0]}));const body=await response.json();
  expect(body).toMatchObject({mode:'read-only',sampleSize:2,coverage:'complete',hasMore:false,statusCounts:{queued:1,published:1,claimed:0,failed:0,reconciliation:0,cancelled:0},providerMetrics:{status:'unavailable',values:null},weeklyComparison:null});
  expect(response.headers.get('Cache-Control')).toBe('no-store');expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.querySources).not.toHaveBeenCalled();expect(mocks.ingest).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
  expect(state.queries[0]).toMatchObject({table:'marketing_publications',limit:1001});expect(state.queries[0].filters).toEqual(expect.arrayContaining([['user_id',owner],['marketing_revisions.brand','devshark']]));
 });
 it('labels a bounded publication sample partial and never manufactures a complete total',async()=>{
  const rows=Array.from({length:1001},()=>({user_id:owner,status:'published',platform:'instagram',scheduled_at:'2026-10-18T16:00:00Z',marketing_revisions:{brand:'devshark'}}));
  mocks.admin.mockReturnValue(database({marketing_publications:rows}).db);
  const response=await POST(request({operation:'weekly-report',brand:'devshark',weekStartsOn:dates[0]}));
  expect(await response.json()).toMatchObject({coverage:'partial',hasMore:true,sampleSize:1000,statusCounts:{published:1000},weeklyComparison:null,providerMetrics:{values:null}});
  expect(mocks.ingest).not.toHaveBeenCalled();expect(mocks.querySources).not.toHaveBeenCalled();
 });
 it('holds live producer outages without falling back to stored source state or executing paid work',async()=>{
  mocks.querySources.mockRejectedValue(new Error('TEST PRIVATE SOURCE TRANSPORT KEY'));
  const response=await POST(request({operation:'discover',brand:'devshark',dates}));
  expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'marketing-operation-held'});
  expect(mocks.sync).not.toHaveBeenCalled();expect(mocks.ingest).not.toHaveBeenCalled();expect(mocks.enqueue).not.toHaveBeenCalled();expect(mocks.execute).not.toHaveBeenCalled();
 });
});
