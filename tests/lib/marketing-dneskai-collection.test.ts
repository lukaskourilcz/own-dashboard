import { describe,it,expect,vi } from 'vitest';
import { tickDneskaiCollection,pendingDneskaiCandidates,type DneskaiCollectionDependencies } from '@/lib/marketing/dneskai-collection';
import { candidate } from '@/lib/marketing/dneskai-providers';
import type { DneskaiCollectionStore,DneskaiRun,DneskaiStage } from '@/lib/marketing/dneskai-store';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
const now=new Date('2026-10-13T20:30:00Z');
const env={MARKETING_DNESKAI_COLLECTION_ENABLED:'true',MARKETING_DNESKAI_PAID_ENABLED:'true',MARKETING_AI_CONSENT:'true',TYPESAFE_API_KEY:'test-only',APIFY_TOKEN:'test-only',MARKETING_DNESKAI_APIFY_ACTOR_ID:'test-only',MARKETING_DNESKAI_APIFY_BUILD:'1.2.3'};
function item(index:number,source='openai-blog'){return candidate(source,`OFFLINE-${index}`,`OFFLINE title ${index}`,`OFFLINE public claim ${index}`,`https://example.test/${index}`,now.toISOString(),now.toISOString());}
function fixture(stages:DneskaiStage[],items=Array.from({length:17},(_,i)=>item(i))){
 const run:DneskaiRun={id:runId,user_id:owner,project_id:project,date:'2026-10-13',target_date:'2026-10-14',status:'running',fence:null,tick_count:0,selected_count:0,cost_usd:0,error_code:null};
 const finish=vi.fn(async(_owner:string,_run:string,_fence:string,status:DneskaiRun['status'],error:string|null)=>{run.status=status;run.error_code=error;return{...run};});
 const saveStage=vi.fn(async(_owner:string,_run:string,_fence:string,id:string,result:Parameters<DneskaiCollectionStore['saveStage']>[4])=>{const stage=stages.find(row=>row.source_id===id)!;stage.status=result.status;stage.error_code=result.errorCode;stage.cost_usd=result.costUsd;if(result.registration)stage.registration=result.registration;for(const item of result.items){const i=items.findIndex(old=>old.id===item.id);if(i<0)items.push(item);else items[i]=item;}});
 const claimStage=vi.fn(async(_owner:string,_run:string,_fence:string,id:string,paid:boolean)=>{const row=stages.find(stage=>stage.source_id===id)!;row.status='running';if(paid)row.reserved_usd=row.kind==='instagram'?0.04:0.003;return{...row};});
 const planJev=vi.fn(async(_owner:string,_run:string,_fence:string,count:number)=>{for(let i=0;i<count;i++)stages.push(stage(`__jev:${String(i).padStart(2,'0')}`));run.jev_stage_count=count;return count;});
 const store:DneskaiCollectionStore={admit:vi.fn(async()=>({...run})),claim:vi.fn(async(_owner,_id,fence)=>({...run,fence})),stages:vi.fn(async()=>stages.map(row=>({...row}))),claimStage,saveStage,candidates:vi.fn(async()=>items.map(item=>({...item}))),history:vi.fn(async()=>[]),finish,planJev};
 return{store,run,items,stages,finish,saveStage,claimStage,planJev};
}
function stage(sourceId:string,kind:DneskaiStage['kind']='jev'):DneskaiStage{return{run_id:runId,source_id:sourceId,kind,status:'queued',since_at:'2026-10-06T20:30:00Z',registration:null,reserved_usd:0,cost_usd:null,error_code:null};}
describe('staged DNESKAi collection with mocked transports only',()=>{
 it('resumes only a registered production run with daily collection off and refuses expiry before paid HTTP',async()=>{
  const scoped={...env,VERCEL_ENV:'production',MARKETING_OWNER_ID:owner,MARKETING_DNESKAI_COLLECTION_ENABLED:'false',MARKETING_DNESKAI_PAID_ENABLED:'false',MARKETING_DNESKAI_MANUAL_RUN:JSON.stringify({version:'dneskai-manual/1',ownerId:owner,projectId:project,runId,startsAt:'2026-10-13T20:00:00Z',expiresAt:'2026-10-13T21:00:00Z'})};
  const f=fixture([stage('__jev:00')],[item(0)]),jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news',relevance:0.99,status:'new'})),costUsd:0.0001}));
  await tickDneskaiCollection(owner,{projectId:project,runId,manual:true},{store:f.store,env:scoped,now:()=>now,jev});
  expect(f.store.admit).not.toHaveBeenCalled();expect(jev).toHaveBeenCalledTimes(1);
  await expect(tickDneskaiCollection(owner,{projectId:project,runId},{store:f.store,env:scoped,now:()=>now,jev})).rejects.toThrow('disabled');
  await expect(tickDneskaiCollection(owner,{projectId:project,runId,manual:true},{store:f.store,env:scoped,now:()=>new Date('2026-10-13T21:00:00Z'),jev})).rejects.toThrow('disabled');
  expect(jev).toHaveBeenCalledTimes(1);
 });
 it('default disabled refuses before admission and missing Jev key holds without calls',async()=>{const f=fixture([stage('__jev:00')]),jev=vi.fn();await expect(tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:{},now:()=>now,jev})).rejects.toThrow('disabled');expect(f.store.admit).not.toHaveBeenCalled();const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:{...env,TYPESAFE_API_KEY:''},now:()=>now,jev});expect(result).toMatchObject({runId,status:'held',continue:false});expect(jev).not.toHaveBeenCalled();expect(f.saveStage.mock.calls[0][4].errorCode).toBe('collection-jev-unconfigured');});
 it('classifies all17 in bounded batches and includes earlier accepted batch in semantic history',async()=>{const f=fixture(Array.from({length:16},(_,i)=>stage(`__jev:${String(i).padStart(2,'0')}`))),jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,jev});expect(result.continue).toBe(false);expect(jev).toHaveBeenCalledTimes(3);expect(jev.mock.calls.map(call=>call[0].length)).toEqual([8,8,1]);expect(jev.mock.calls[1][1].map(item=>item.id)).toContain(f.items[0].id);expect(jev.mock.calls[2][1]).toHaveLength(16);expect(f.claimStage.mock.calls.filter(call=>call[4])).toHaveLength(3);});
 it('keeps data beyond128 explicitly pending/partial rather than truncating it as complete',async()=>{const f=fixture(Array.from({length:16},(_,i)=>stage(`__jev:${String(i).padStart(2,'0')}`)),Array.from({length:135},(_,i)=>item(i))),jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));let result;for(let i=0;i<4;i++)result=await tickDneskaiCollection(owner,{projectId:project,runId},{store:f.store,env,now:()=>now,jev});expect(jev).toHaveBeenCalledTimes(16);expect(result).toMatchObject({status:'partial',continue:false});expect(f.run.error_code).toBe('collection-classification-pending');expect(f.items.filter(item=>item.category===null)).toHaveLength(7);});
 it('stops new paid work after ambiguous actor start and retains unknown reservation',async()=>{const f=fixture([stage('instagram:mosseri','instagram'),stage('instagram:meta.ai','instagram'),stage('__jev:00')]),startInstagram=vi.fn(async()=>{throw new Error('raw private error');}),jev=vi.fn();await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,startInstagram,jev});expect(startInstagram).toHaveBeenCalledTimes(1);expect(f.stages[0]).toMatchObject({status:'held',reserved_usd:0.04,cost_usd:null});await tickDneskaiCollection(owner,{projectId:project,runId},{store:f.store,env,now:()=>now,startInstagram,jev});expect(startInstagram).toHaveBeenCalledTimes(1);expect(jev).not.toHaveBeenCalled();expect(f.stages[1].error_code).toBe('collection-cost-unresolved');});
 it('rechecks midnight after durable paid reservation before provider call',async()=>{const f=fixture([stage('instagram:mosseri','instagram')]),startInstagram=vi.fn(),clock=vi.fn(()=>now);const original=f.store.claimStage;f.store.claimStage=async(...args)=>{const result=await original(...args);clock.mockReturnValue(new Date('2026-10-13T22:00:01Z'));return result;};await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:clock,startInstagram});expect(startInstagram).not.toHaveBeenCalled();expect(f.stages[0].error_code).toBe('collection-day-or-consent-changed');});
 it('plans ceil(new candidates / 8) Jev stages once, only after every source stage settled',async()=>{
  const f=fixture([stage('openai-blog','feed')]),feed=vi.fn(async()=>({items:[],complete:true,errorCode:null}));
  const jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));
  const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,feed,jev});
  expect(f.planJev).toHaveBeenCalledTimes(1);expect(f.planJev.mock.calls[0][3]).toBe(3);
  expect(f.stages.filter(row=>row.kind==='jev').map(row=>row.source_id)).toEqual(['__jev:00','__jev:01','__jev:02']);
  expect(jev.mock.calls.map(call=>call[0].length)).toEqual([8,8,1]);expect(result).toMatchObject({status:'complete',continue:false});
 });
 it('plans no Jev stage without new candidates and still completes a covered run',async()=>{
  const f=fixture([stage('openai-blog','feed')],[]),feed=vi.fn(async()=>({items:[],complete:true,errorCode:null})),jev=vi.fn();
  expect(await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,feed,jev})).toMatchObject({status:'complete',continue:false});
  expect(f.planJev.mock.calls[0][3]).toBe(0);expect(f.stages.some(row=>row.kind==='jev')).toBe(false);expect(jev).not.toHaveBeenCalled();
 });
 it('waits for unfinished sources before planning and never replans a planned or legacy run',async()=>{
  const f=fixture([stage('instagram:mosseri','instagram')]),startInstagram=vi.fn(async()=>({id:'TEST',actId:'test-only',userId:'TEST',buildNumber:'1.2.3',defaultDatasetId:'TEST',status:'RUNNING' as const}));
  expect(await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,startInstagram})).toMatchObject({status:'running',continue:true});expect(f.planJev).not.toHaveBeenCalled();
  const legacy=fixture(Array.from({length:16},(_,i)=>stage(`__jev:${String(i).padStart(2,'0')}`)),[]);
  await tickDneskaiCollection(owner,{projectId:project},{store:legacy.store,env,now:()=>now,jev:vi.fn()});expect(legacy.planJev).not.toHaveBeenCalled();
  const planned=fixture([],[]);planned.run.jev_stage_count=0;
  await tickDneskaiCollection(owner,{projectId:project},{store:planned.store,env,now:()=>now,jev:vi.fn()});expect(planned.planJev).not.toHaveBeenCalled();
 });
 it('saves an Instagram read capped only by its limit as partial so the cursor can move',async()=>{
  const f=fixture([{...stage('instagram:mosseri','instagram'),status:'polling',registration:{id:'TEST'}}],[]);
  const pollInstagram=vi.fn(async()=>({running:false as const,run:{id:'TEST',actId:'test-only',userId:'TEST',buildNumber:'1.2.3',defaultDatasetId:'TEST',status:'SUCCEEDED' as const,usageTotalUsd:0.02},items:[item(1,'instagram:mosseri')],complete:false,errorCode:'collection-source-item-cap'}));
  await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,pollInstagram});
  expect(f.saveStage.mock.calls[0][4]).toMatchObject({status:'partial',errorCode:'collection-source-item-cap'});
 });
 it('terminal daily admission returns exact persisted state without feeds/providers',async()=>{const f=fixture([]);f.run.status='complete';const feed=vi.fn(),jev=vi.fn();expect(await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,feed,jev})).toEqual({runId,status:'complete',continue:false});expect(f.store.claimStage).not.toHaveBeenCalled();expect(feed).not.toHaveBeenCalled();expect(jev).not.toHaveBeenCalled();});
 it('cheap dedup precedes paid batching and source round-robin prevents a hot source starving others',()=>{const first=item(1,'openai-blog'),duplicate={...first,id:'different',url:'https://other.example.test/path'},items=[first,duplicate,item(2,'openai-blog'),item(3,'anthropic-news'),item(4,'deepmind-blog')];expect(pendingDneskaiCandidates(items,now).map(item=>item.sourceId).slice(0,3)).toEqual(['openai-blog','anthropic-news','deepmind-blog']);expect(pendingDneskaiCandidates(items,now)).toHaveLength(4);expect(pendingDneskaiCandidates([{...first,publishedAt:null},{...first,publishedAt:'2026-01-01T00:00:00Z'}],now)).toEqual([]);});
 it('manual explicit collection pilot admits before22 without reusing exhausted generation authority',async()=>{
  const f=fixture([stage('instagram:mosseri','instagram')],[]);f.run.collection_pilot_owner=owner;
  const pilotEnv={...env,VERCEL_ENV:'preview',MARKETING_OWNER_ID:owner,MARKETING_DNESKAI_COLLECTION_ENABLED:'false',MARKETING_PILOT_OWNER_ID:owner,MARKETING_PILOT_STARTS_AT:'2026-10-01T00:00:00Z',MARKETING_PILOT_EXPIRES_AT:'2026-10-03T00:00:00Z',MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED:'true',MARKETING_DNESKAI_COLLECTION_PILOT_OWNER_ID:owner,MARKETING_DNESKAI_COLLECTION_PILOT_PROJECT_ID:project,MARKETING_DNESKAI_COLLECTION_PILOT_STARTS_AT:'2026-10-13T10:00:00Z',MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT:'2026-10-13T14:00:00Z'};
  const startInstagram=vi.fn(async()=>({id:'TEST',actId:'test-only',userId:'TEST',buildNumber:'1.2.3',defaultDatasetId:'TEST',status:'RUNNING' as const}));
  const result=await tickDneskaiCollection(owner,{projectId:project,pilot:true},{store:f.store,env:pilotEnv,now:()=>new Date('2026-10-13T12:00:00Z'),startInstagram});
  expect(result.continue).toBe(true);expect(startInstagram).toHaveBeenCalledTimes(1);expect(f.store.admit).toHaveBeenCalledWith(owner,project,'2026-10-13',expect.any(Array),{ownerId:owner,projectId:project,startsAt:'2026-10-13T10:00:00Z',expiresAt:'2026-10-13T14:00:00Z'});
  await expect(tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:pilotEnv,now:()=>new Date('2026-10-13T12:00:00Z'),startInstagram})).rejects.toThrow('disabled');expect(startInstagram).toHaveBeenCalledTimes(1);
 });
 it('refuses caller adoption of an ordinary run into a pilot and expiry after reservation prevents POST',async()=>{
  const f=fixture([stage('instagram:mosseri','instagram')],[]),pilotEnv={...env,VERCEL_ENV:'preview',MARKETING_OWNER_ID:owner,MARKETING_DNESKAI_COLLECTION_PILOT_ENABLED:'true',MARKETING_DNESKAI_COLLECTION_PILOT_OWNER_ID:owner,MARKETING_DNESKAI_COLLECTION_PILOT_PROJECT_ID:project,MARKETING_DNESKAI_COLLECTION_PILOT_STARTS_AT:'2026-10-13T20:00:00Z',MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT:'2026-10-13T21:00:00Z'},startInstagram=vi.fn();
  await expect(tickDneskaiCollection(owner,{projectId:project,pilot:true},{store:f.store,env:pilotEnv,now:()=>now,startInstagram})).rejects.toThrow('run-unavailable');expect(startInstagram).not.toHaveBeenCalled();
  f.run.collection_pilot_owner=owner;const clock=vi.fn(()=>now),original=f.store.claimStage;f.store.claimStage=async(...args)=>{const result=await original(...args);clock.mockReturnValue(new Date(pilotEnv.MARKETING_DNESKAI_COLLECTION_PILOT_EXPIRES_AT));return result;};
  await tickDneskaiCollection(owner,{projectId:project,pilot:true},{store:f.store,env:pilotEnv,now:clock,startInstagram});expect(startInstagram).not.toHaveBeenCalled();expect(f.stages[0].reserved_usd).toBe(0.04);
 });

});
