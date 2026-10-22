import { describe,it,expect,vi } from 'vitest';
import { tickDneskaiCollection,pendingDneskaiCandidates,dneskaiApifyStartRefused,DNESKAI_FEED_TIMEOUT_MS,type DneskaiCollectionDependencies } from '@/lib/marketing/dneskai-collection';
import { candidate,jevRequest,DneskaiProviderError } from '@/lib/marketing/dneskai-providers';
import { dneskaiCollectionBlockers,type DneskaiCollectionStore,type DneskaiRun,type DneskaiStage } from '@/lib/marketing/dneskai-store';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333';
const now=new Date('2026-10-13T20:30:00Z');
const env={MARKETING_DNESKAI_COLLECTION_ENABLED:'true',MARKETING_DNESKAI_PAID_ENABLED:'true',MARKETING_AI_CONSENT:'true',TYPESAFE_API_KEY:'test-only',APIFY_TOKEN:'test-only',MARKETING_DNESKAI_APIFY_ACTOR_ID:'test-only',MARKETING_DNESKAI_APIFY_BUILD:'1.2.3',MARKETING_DNESKAI_APIFY_ENABLED:'true'};
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
 it('takes only a project and a run to resume, and never ticks a retained pilot run',async()=>{
  for(const body of [{projectId:project,runId,manual:true},{projectId:project,pilot:true}])await expect(tickDneskaiCollection(owner,body,{store:fixture([]).store,env,now:()=>now})).rejects.toThrow();
  const f=fixture([stage('instagram:mosseri','instagram')],[]),startInstagram=vi.fn();f.run.collection_pilot_owner=owner;
  await expect(tickDneskaiCollection(owner,{projectId:project,runId},{store:f.store,env,now:()=>now,startInstagram})).rejects.toThrow('collection-run-unavailable');
  expect(f.store.admit).not.toHaveBeenCalled();expect(startInstagram).not.toHaveBeenCalled();
 });
 it('default disabled refuses before admission and missing Jev key holds without calls',async()=>{const f=fixture([stage('__jev:00')]),jev=vi.fn();await expect(tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:{},now:()=>now,jev})).rejects.toThrow('disabled');expect(f.store.admit).not.toHaveBeenCalled();const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:{...env,TYPESAFE_API_KEY:''},now:()=>now,jev});expect(result).toMatchObject({runId,status:'held',continue:false});expect(jev).not.toHaveBeenCalled();expect(f.saveStage.mock.calls[0][4].errorCode).toBe('collection-jev-unconfigured');});
 it('classifies all17 in bounded batches and includes earlier accepted batch in semantic history',async()=>{const f=fixture(Array.from({length:16},(_,i)=>stage(`__jev:${String(i).padStart(2,'0')}`))),jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,jev});expect(result.continue).toBe(false);expect(jev).toHaveBeenCalledTimes(3);expect(jev.mock.calls.map(call=>call[0].length)).toEqual([8,8,1]);expect(jev.mock.calls[1][1].map(item=>item.id)).toContain(f.items[0].id);expect(jev.mock.calls[2][1]).toHaveLength(16);expect(f.claimStage.mock.calls.filter(call=>call[4])).toHaveLength(3);});
 it('keeps data beyond128 explicitly pending/partial rather than truncating it as complete',async()=>{const f=fixture(Array.from({length:16},(_,i)=>stage(`__jev:${String(i).padStart(2,'0')}`)),Array.from({length:135},(_,i)=>item(i))),jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));let result;for(let i=0;i<4;i++)result=await tickDneskaiCollection(owner,{projectId:project,runId},{store:f.store,env,now:()=>now,jev});expect(jev).toHaveBeenCalledTimes(16);expect(result).toMatchObject({status:'partial',continue:false});expect(f.run.error_code).toBe('collection-classification-pending');expect(f.items.filter(item=>item.category===null)).toHaveLength(7);});
 it('stops new paid work after ambiguous actor start and retains unknown reservation',async()=>{const f=fixture([stage('instagram:mosseri','instagram'),stage('instagram:meta.ai','instagram'),stage('__jev:00')]),startInstagram=vi.fn(async()=>{throw new Error('raw private error');}),jev=vi.fn();await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,startInstagram,jev});expect(startInstagram).toHaveBeenCalledTimes(1);expect(f.stages[0]).toMatchObject({status:'held',reserved_usd:0.04,cost_usd:null});await tickDneskaiCollection(owner,{projectId:project,runId},{store:f.store,env,now:()=>now,startInstagram,jev});expect(startInstagram).toHaveBeenCalledTimes(1);expect(jev).not.toHaveBeenCalled();expect(f.stages[1].error_code).toBe('collection-cost-unresolved');});
 it('settles a start Apify definitely refused at zero, so the next profile and Jev still run',async()=>{
  const f=fixture([stage('instagram:mosseri','instagram'),stage('instagram:meta.ai','instagram'),stage('__jev:00')]);
  const startInstagram=vi.fn(async()=>{throw new DneskaiProviderError('provider-http-400-invalid-input');});
  const jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.001}));
  await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,startInstagram,jev});
  expect(startInstagram).toHaveBeenCalledTimes(2);
  expect(f.stages.slice(0,2).map(row=>[row.status,row.reserved_usd,row.cost_usd,row.error_code])).toEqual([['held',0.04,0,'provider-http-400-invalid-input'],['held',0.04,0,'provider-http-400-invalid-input']]);
  expect(jev).toHaveBeenCalled();
  expect(f.stages.some(row=>row.error_code==='collection-cost-unresolved')).toBe(false);
 });
 it.each(['provider-http-429-rate-limit-exceeded','provider-http-400','provider-http-500-internal-server-error','provider-response-ambiguous','collection-apify-binding-invalid'])('keeps the cost unknown after an ambiguous start (%s)',async code=>{
  const f=fixture([stage('instagram:mosseri','instagram'),stage('instagram:meta.ai','instagram'),stage('__jev:00')]),startInstagram=vi.fn(async()=>{throw new DneskaiProviderError(code);}),jev=vi.fn();
  await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,startInstagram,jev});
  expect(startInstagram).toHaveBeenCalledTimes(1);expect(f.stages[0]).toMatchObject({status:'held',reserved_usd:0.04,cost_usd:null,error_code:code});expect(jev).not.toHaveBeenCalled();
 });
 it('treats only pre-request refusals and Apify-typed 4xx answers as definite',()=>{
  for(const code of ['collection-apify-unconfigured','collection-instagram-input-invalid','provider-http-400-invalid-input','provider-http-404-actor-not-found','provider-http-402-not-enough-usage-to-run-paid-actor'])expect(dneskaiApifyStartRefused(code)).toBe(true);
  for(const code of ['provider-http-408','provider-http-409-invalid-request','provider-http-429-rate-limit-exceeded','provider-http-403','provider-http-failed','collection-paid-outcome-ambiguous'])expect(dneskaiApifyStartRefused(code)).toBe(false);
 });
 it('rechecks midnight after durable paid reservation before provider call',async()=>{const f=fixture([stage('instagram:mosseri','instagram')]),startInstagram=vi.fn(),clock=vi.fn(()=>now);const original=f.store.claimStage;f.store.claimStage=async(...args)=>{const result=await original(...args);clock.mockReturnValue(new Date('2026-10-13T22:00:01Z'));return result;};await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:clock,startInstagram});expect(startInstagram).not.toHaveBeenCalled();expect(f.stages[0].error_code).toBe('collection-day-or-consent-changed');});
 it('gives Jev the longest history its byte limits accept instead of holding a heavy day',async()=>{
  // Synthetic Czech text at the field limits: diacritics take two UTF-8 bytes, so the state limit trips below 148 records.
  const czech=(label:string,length:number)=>`${label} Žluťoučký kůň úpěl ďábelské ódy, řeřicha šíří vůni. `.repeat(20).slice(0,length);
  const current=Array.from({length:8},(_,i)=>candidate('openai-blog',`OFFLINE-current-${i}`,czech(`Titulek ${i}`,120),czech(`Text ${i}`,600),`https://example.test/current/${i}`,now.toISOString(),now.toISOString()));
  const earlier=Array.from({length:128},(_,i)=>({...candidate('the-verge',`OFFLINE-earlier-${i}`,czech(`Dřívější ${i}`,500),czech(`Dřívější text ${i}`,600),`https://example.test/earlier/${i}`,now.toISOString(),now.toISOString()),category:'ai-news' as const,relevance:0.9}));
  const stored=Array.from({length:20},(_,i)=>({id:`posted-test-${i}`,title:czech(`Příspěvek ${i}`,500),text:czech(`Popisek ${i}`,500)}));
  const f=fixture([stage('__jev:00')],[...current,...earlier]);f.store.history=vi.fn(async()=>stored.map(item=>({...item})));
  const jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));
  const all=[...stored,...earlier.map(item=>({id:item.id,title:item.title,text:item.text}))];
  // The whole list used to go to jevRequest, which refused it and held the run.
  expect(()=>jevRequest(current,all)).toThrow('collection-jev-input-limit');
  const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,jev});
  expect(result.status).not.toBe('held');expect(f.run.error_code).not.toBe('collection-jev-input-limit');
  expect(jev).toHaveBeenCalledTimes(1);
  const [items,history]=jev.mock.calls[0];
  expect(items.map(item=>item.id).sort()).toEqual(current.map(item=>item.id).sort());
  // Stored posts and selected reports first, then the newest earlier records; only the oldest give way.
  expect(history.length).toBeGreaterThan(20);expect(history.length).toBeLessThan(all.length);
  expect(history).toEqual(all.slice(0,history.length));
  expect(()=>jevRequest(items,history)).not.toThrow();
  expect(()=>jevRequest(items,all.slice(0,history.length+1))).toThrow('collection-jev-input-limit');
 });
 it('re-queues recent Jev holds once before the Jev plan only with DNESKAI_SELECTION_V2_ENABLED (decision 13)',async()=>{
  const jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));
  const feed=vi.fn(async()=>({items:[],complete:true,errorCode:null}));
  const held=()=>[...Array.from({length:8},(_,i)=>item(i)),{...item(8),status:'held' as const,category:'ai-news' as const,relevance:0.8,reason:'collection-review-relevance'}];
  // Off: the deployed path, the hold stays and only the eight open reports are planned.
  const off=fixture([stage('openai-blog','feed')],held());const offRequeue=vi.fn(async()=>1);
  await tickDneskaiCollection(owner,{projectId:project},{store:{...off.store,requeueHeld:offRequeue},env,now:()=>now,feed,jev});
  expect(offRequeue).not.toHaveBeenCalled();expect(off.planJev.mock.calls[0][3]).toBe(1);
  // On: the hold is open again before the plan counts the queue, so it shares the night's batches.
  const on=fixture([stage('openai-blog','feed')],held());const order:string[]=[];
  const requeueHeld=vi.fn(async()=>{order.push('requeue');const index=on.items.findIndex(row=>row.status==='held');on.items[index]={...on.items[index]!,status:'new',category:null,relevance:null,reason:null};return 1;});
  on.planJev.mockImplementation(async(_owner,_run,_fence,count)=>{order.push('plan');for(let i=0;i<count;i++)on.stages.push(stage(`__jev:${String(i).padStart(2,'0')}`));on.run.jev_stage_count=count;return count;});
  await tickDneskaiCollection(owner,{projectId:project},{store:{...on.store,requeueHeld},env:{...env,DNESKAI_SELECTION_V2_ENABLED:'true'},now:()=>now,feed,jev});
  expect(requeueHeld).toHaveBeenCalledTimes(1);expect(order).toEqual(['requeue','plan']);expect(on.planJev.mock.calls[0][3]).toBe(2);
  // A missing function (switch on before the migration) leaves the night as it was.
  const missing=fixture([stage('openai-blog','feed')],held());
  const result=await tickDneskaiCollection(owner,{projectId:project},{store:{...missing.store,requeueHeld:vi.fn(async()=>{throw new Error('collection-store-unavailable');})},env:{...env,DNESKAI_SELECTION_V2_ENABLED:'true'},now:()=>now,feed,jev});
  expect(missing.planJev.mock.calls[0][3]).toBe(1);expect(result).toMatchObject({continue:false});
 });
 it('plans ceil(new candidates / 8) Jev stages once, only after every source stage settled',async()=>{
  const f=fixture([stage('openai-blog','feed')]),feed=vi.fn(async()=>({items:[],complete:true,errorCode:null}));
  const jev=vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));
  const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,feed,jev});
  expect(f.planJev).toHaveBeenCalledTimes(1);expect(f.planJev.mock.calls[0][3]).toBe(3);
  expect(f.stages.filter(row=>row.kind==='jev').map(row=>row.source_id)).toEqual(['__jev:00','__jev:01','__jev:02']);
  expect(jev.mock.calls.map(call=>call[0].length)).toEqual([8,8,1]);expect(result).toMatchObject({status:'complete',continue:false});
 });
 it('records collection-selection-day-passed when a run finishes after Prague midnight',async()=>{
  // 00:10 in Prague on 14 October: the run of 13 October finishes, and the database selects nothing for it.
  const f=fixture([stage('openai-blog','feed')],[]),feed=vi.fn(async()=>({items:[],complete:true,errorCode:null}));
  expect(await tickDneskaiCollection(owner,{projectId:project,runId},{store:f.store,env,now:()=>new Date('2026-10-13T22:10:00Z'),feed,jev:vi.fn()})).toMatchObject({status:'complete',continue:false});
  expect(f.finish).toHaveBeenLastCalledWith(owner,runId,expect.any(String),'complete','collection-selection-day-passed');
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
 it('starts a free source only with its whole timeout left, except the first of a call',async()=>{
  // The first native night cut arXiv off at the old 8 s; a slow source now waits for the next call instead.
  expect(DNESKAI_FEED_TIMEOUT_MS).toBe(25_000);
  const f=fixture([stage('openai-blog','feed'),stage('anthropic-news','feed'),stage('deepmind-blog','feed'),stage('google-research','feed')],[]);
  let t=1_800_000_000_000;const realTime=vi.spyOn(Date,'now').mockImplementation(()=>t);
  const slow=vi.fn(async()=>{t+=21_000;return{items:[],complete:true,errorCode:null};}),fast=vi.fn(async()=>({items:[],complete:true,errorCode:null}));
  try{
   expect(await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,feed:slow})).toMatchObject({status:'running',continue:true});
   expect(slow).toHaveBeenCalledTimes(3);expect(f.stages.map(row=>row.status)).toEqual(['ok','ok','ok','queued']);
   expect(await tickDneskaiCollection(owner,{projectId:project,runId},{store:f.store,env,now:()=>now,feed:fast})).toMatchObject({continue:false});
   expect(fast).toHaveBeenCalledTimes(1);expect(f.stages.map(row=>row.status)).toEqual(['ok','ok','ok','ok']);
  }finally{realTime.mockRestore();}
 });
 it('terminal daily admission returns exact persisted state without feeds/providers',async()=>{const f=fixture([]);f.run.status='complete';const feed=vi.fn(),jev=vi.fn();expect(await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,feed,jev})).toEqual({runId,status:'complete',continue:false});expect(f.store.claimStage).not.toHaveBeenCalled();expect(feed).not.toHaveBeenCalled();expect(jev).not.toHaveBeenCalled();});
 it('cheap dedup precedes paid batching and source round-robin prevents a hot source starving others',()=>{const first=item(1,'openai-blog'),duplicate={...first,id:'different',url:'https://other.example.test/path'},items=[first,duplicate,item(2,'openai-blog'),item(3,'anthropic-news'),item(4,'deepmind-blog')];expect(pendingDneskaiCandidates(items,now).map(item=>item.sourceId).slice(0,3)).toEqual(['openai-blog','anthropic-news','deepmind-blog']);expect(pendingDneskaiCandidates(items,now)).toHaveLength(4);expect(pendingDneskaiCandidates([{...first,publishedAt:null},{...first,publishedAt:'2026-01-01T00:00:00Z'}],now)).toEqual([]);});


});
describe('Apify switch MARKETING_DNESKAI_APIFY_ENABLED: Instagram held, Jev still classifies',()=>{
 const started={id:'TEST',actId:'test-only',userId:'TEST',buildNumber:'1.2.3',defaultDatasetId:'TEST',status:'RUNNING' as const};
 const classify=()=>vi.fn<NonNullable<DneskaiCollectionDependencies['jev']>>(async items=>({items:items.map(item=>({...item,category:'ai-news' as const,relevance:0.99,status:'new' as const,duplicateOf:null})),costUsd:0.0001}));
 const night=()=>fixture([stage('openai-blog','feed'),stage('instagram:mosseri','instagram'),stage('instagram:meta.ai','instagram')],[]);
 const freeFeed=()=>vi.fn(async()=>({items:[item(1),item(2),item(3)],complete:true,errorCode:null}));
 it.each([undefined,'false','TRUE','1',''])('scheduled run with the switch %s holds every Instagram stage at zero cost, never starts Apify, classifies the free-feed candidates and finishes',async value=>{
  const f=night(),feed=freeFeed(),jev=classify(),startInstagram=vi.fn(async()=>started),pollInstagram=vi.fn();
  const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:{...env,MARKETING_DNESKAI_APIFY_ENABLED:value},now:()=>now,feed,jev,startInstagram,pollInstagram});
  expect(startInstagram).not.toHaveBeenCalled();expect(pollInstagram).not.toHaveBeenCalled();
  expect(f.stages.filter(row=>row.kind==='instagram')).toEqual([expect.objectContaining({status:'held',reserved_usd:0,cost_usd:0,error_code:'collection-apify-disabled'}),expect.objectContaining({status:'held',reserved_usd:0,cost_usd:0,error_code:'collection-apify-disabled'})]);
  expect(f.claimStage.mock.calls.filter(call=>call[3].startsWith('instagram:')).map(call=>call[4])).toEqual([false,false]);
  expect(jev).toHaveBeenCalledTimes(1);expect(jev.mock.calls[0][0]).toHaveLength(3);
  expect(result).toMatchObject({status:'complete',continue:false});expect(f.finish).toHaveBeenLastCalledWith(owner,runId,expect.any(String),'complete',null);
 });
 it('keeps a run with a switched-off Instagram stage partial when a free feed really failed',async()=>{
  const f=fixture([stage('openai-blog','feed'),stage('anthropic-news','feed'),stage('instagram:mosseri','instagram')],[]);
  const feed=vi.fn(async(source:{id:string})=>{if(source.id==='anthropic-news')throw new DneskaiProviderError('collection-source-timeout');return{items:[item(1),item(2)],complete:true,errorCode:null};});
  const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:{...env,MARKETING_DNESKAI_APIFY_ENABLED:'false'},now:()=>now,feed:feed as unknown as NonNullable<DneskaiCollectionDependencies['feed']>,jev:classify()});
  expect(f.stages.find(row=>row.kind==='instagram')).toMatchObject({status:'held',error_code:'collection-apify-disabled'});
  expect(result).toMatchObject({status:'partial',continue:false});expect(f.finish).toHaveBeenLastCalledWith(owner,runId,expect.any(String),'partial','collection-review-incomplete');
 });
 it('scheduled run with the switch on still starts Apify for a queued Instagram stage',async()=>{
  const f=night(),startInstagram=vi.fn(async()=>started);
  expect(await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,feed:freeFeed(),jev:classify(),startInstagram})).toMatchObject({status:'running',continue:true});
  expect(startInstagram).toHaveBeenCalledTimes(1);expect(f.stages.filter(row=>row.kind==='instagram').map(row=>[row.status,row.reserved_usd])).toEqual([['polling',0.04],['queued',0]]);
 });
 it('rechecks the switch after the reservation and right before the Apify start',async()=>{
  const f=fixture([stage('instagram:mosseri','instagram')],[]),live={...env},startInstagram=vi.fn(async()=>started),original=f.store.claimStage;
  f.store.claimStage=async(...args)=>{const result=await original(...args);live.MARKETING_DNESKAI_APIFY_ENABLED='false';return result;};
  await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:live,now:()=>now,startInstagram});
  expect(startInstagram).not.toHaveBeenCalled();expect(f.stages[0]).toMatchObject({status:'held',reserved_usd:0.04,cost_usd:0,error_code:'collection-apify-disabled'});
 });
 it('still reads an Apify run started before the switch went off, so its reservation gets its real cost',async()=>{
  const f=fixture([{...stage('instagram:mosseri','instagram'),status:'polling',reserved_usd:0.04,registration:{id:'TEST'}}],[]),startInstagram=vi.fn();
  const pollInstagram=vi.fn(async()=>({running:false as const,run:{...started,status:'SUCCEEDED' as const,usageTotalUsd:0.02},items:[item(1,'instagram:mosseri')],complete:true,errorCode:null}));
  await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env:{...env,MARKETING_DNESKAI_APIFY_ENABLED:'false'},now:()=>now,startInstagram,pollInstagram,jev:classify()});
  expect(pollInstagram).toHaveBeenCalledTimes(1);expect(startInstagram).not.toHaveBeenCalled();expect(f.stages[0]).toMatchObject({status:'ok',cost_usd:0.02});
 });
 it('lists collection-apify-disabled as a blocker unless the switch is exactly true',()=>{
  for(const value of [undefined,'false','TRUE',' true'])expect(dneskaiCollectionBlockers({...env,MARKETING_DNESKAI_APIFY_ENABLED:value})).toContain('collection-apify-disabled');
  expect(dneskaiCollectionBlockers(env)).not.toContain('collection-apify-disabled');expect(dneskaiCollectionBlockers({...env,MARKETING_DNESKAI_APIFY_ENABLED:'false'})).not.toContain('collection-apify-unconfigured');
 });
});


it('bounds free-read concurrency at three and shares the five-operation tick cap',async()=>{
 const ids=['openai-blog','anthropic-news','deepmind-blog','google-research','meta-ai','the-verge','ars-technica'];
 const f=fixture(ids.map(id=>stage(id,'feed')),[]);let active=0,peak=0;
 const feed=vi.fn(async()=>{active++;peak=Math.max(peak,active);await new Promise<void>(done=>setTimeout(done,5));active--;return{items:[],complete:true,errorCode:null};});
 const result=await tickDneskaiCollection(owner,{projectId:project},{store:f.store,env,now:()=>now,feed});
 expect(peak).toBe(3);expect(feed).toHaveBeenCalledTimes(5);expect(result.continue).toBe(true);
 expect(f.stages.filter(row=>row.status==='queued')).toHaveLength(2);expect(f.claimStage.mock.calls.every(call=>call[4]===false)).toBe(true);
});
