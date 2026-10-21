import { describe,it,expect,vi } from 'vitest';
import { candidate,collectDneskaiFeed,jevRequest,classifyDneskaiCandidates,startDneskaiInstagram,pollDneskaiInstagram } from '@/lib/marketing/dneskai-providers';
import { DNESKAI_SOURCES,dueDneskaiSources,isDneskaiProject,dneskaiCheapIdentity } from '@/lib/marketing/dneskai-registry';
import { signAutomationBody } from '@/lib/marketing/automation-auth';
vi.mock('server-only',()=>({}));
const now=new Date('2026-10-13T20:30:00Z'),signal=new AbortController().signal;
const row=(i=0)=>candidate('openai-blog',`TEST-${i}`,`OFFLINE TEST title ${i}`,`OFFLINE TEST public text ${i}`,`https://example.test/${i}`,now.toISOString(),now.toISOString());
const json=(body:unknown)=>Response.json(body);
const apifyEnv={APIFY_TOKEN:'test-only-token',MARKETING_DNESKAI_APIFY_ACTOR_ID:'official-test-id',MARKETING_DNESKAI_APIFY_BUILD:'1.2.3'};
const registration={id:'testRun',actId:'official-test-id',userId:'testUser',buildNumber:'1.2.3',defaultDatasetId:'testDataset',status:'SUCCEEDED' as const,finishedAt:'2026-10-13T20:29:00Z',usageTotalUsd:0.01};
function jevResponse(request:ReturnType<typeof jevRequest>){const answers:Record<string,unknown>={};for(const [key,question]of Object.entries(request.questions)){const q=question as {type:string;criteria?:Record<string,unknown>};if(q.type==='noul')answers[key]={type:'noul',noul:0.99};else{const choice=key.startsWith('category')?'ai-news':'none';answers[key]={type:'choice',choice,confidence:0.95,probabilities:Object.fromEntries(Object.keys(q.criteria!).map(key=>[key,key===choice?1:0]))};}}return{model:'jev-1.13.0',answers,usage:{input_tokens:1000,output_tokens:100}};}
describe('DNESKAi provider boundaries: mocked HTTP only',()=>{
 it.each([1,2])('keeps emoji at all Jev text boundaries well formed with %i UTF-16 units remaining',remaining=>{
  const text=(limit:number)=>'a'.repeat(limit-remaining)+'🤖 suffix';
  const items=[{...row(),title:text(120),text:text(600)}],history=[{id:'prior-test',title:text(40),text:text(64)}];
  const state=JSON.parse(JSON.stringify(jevRequest(items,history))).state;
  for(const [value,limit] of [[state.items[0].title,120],[state.items[0].text,600],[state.history[0].title,40],[state.history[0].text,64]] as const){
   expect(value.isWellFormed()).toBe(true);expect(value.length).toBeLessThanOrEqual(limit);
   expect(value).toBe('a'.repeat(limit-remaining)+(remaining===2?'🤖':''));
  }
  expect(items[0].title).toBe(text(120));
 });
 it('normalizes malformed source Unicode only in the bounded Jev request',()=>{
  const item={...row(),title:'test\uD800text\uDC00',text:'test\uDC00'};
  const state=jevRequest([item],[]).state;
  expect(state.items[0]).toMatchObject({title:'test\uFFFDtext\uFFFD',text:'test\uFFFD'});
  expect(item.title).toBe('test\uD800text\uDC00');
 });
 it('does not split an Instagram emoji when deriving its 500-unit candidate title',async()=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!,caption='a'.repeat(499)+'🤖 public caption';
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({data:registration})).mockResolvedValueOnce(json([{id:'emoji-test',shortCode:'test',caption,timestamp:'2026-10-13T20:20:00Z',url:'https://www.instagram.com/p/test/',ownerUsername:'mosseri'}]));
  const result=await pollDneskaiInstagram(source,registration,'2026-10-12T00:00:00Z',{env:apifyEnv,fetcher,signal,now});
  expect(result.running).toBe(false);if(!result.running){expect(result.items[0].title).toBe('a'.repeat(499));expect(result.items[0].text).toBe(caption);}
 });
 it('uses canonical project identity,42 genuine registry identities and exact cadence',()=>{expect(DNESKAI_SOURCES).toHaveLength(42);expect(new Set(DNESKAI_SOURCES.map(row=>row.id)).size).toBe(42);expect(isDneskaiProject({portfolio_key:'aifirst',repo_full_name:null,parent_id:null})).toBe(true);expect(isDneskaiProject({portfolio_key:null,repo_full_name:'owner/fake-dneskai',parent_id:null})).toBe(false);expect(dueDneskaiSources('2026-10-18').filter(row=>row.kind==='instagram').map(row=>row.name).sort()).toEqual(['insidertech','meta.ai','mosseri','techcrunch','theapplehub']);expect(DNESKAI_SOURCES.find(row=>row.id==='anthropic-news')?.kind).toBe('html');for(const id of ['ars-technica','the-verge','wired-ai'])expect(DNESKAI_SOURCES.find(row=>row.id===id)?.weekdays).toEqual([1]);expect(DNESKAI_SOURCES.find(row=>row.id==='github-ai-releases')?.weekdays).toEqual([2,5]);});
 it('cheap dedup ignores tracking URLs and case/spacing in the same authored text',()=>{expect(dneskaiCheapIdentity({title:'NEWS',text:'Some   text',url:'https://example.test/item?utm_source=x'})).toEqual(dneskaiCheapIdentity({title:'news',text:'some text',url:'https://example.test/item'}));});
 it('calls only configured bridge origin with exact HMAC and refuses incomplete foreign responses',async()=>{const source=DNESKAI_SOURCES.find(row=>row.id==='anthropic-news')!,secret='test-only-secret-'.repeat(3),env={MARKETING_DNESKAI_SOURCE_URL:'https://quorum.example/admin/api/marketing-sources',MARKETING_DNESKAI_SOURCE_SECRET:secret},fetcher=vi.fn<typeof fetch>(async()=>json({schemaVersion:'dneskai-feed/1',sources:[{sourceId:source.id,status:'ok',errorCode:null,items:[{externalId:'test',title:'Test authored news',url:'https://example.test/news',summary:'Public summary',publishedAt:now.toISOString(),fetchedAt:now.toISOString()}]}]}));const result=await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher,signal,now});expect(result.complete).toBe(true);const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://quorum.example/admin/api/marketing-collection');expect(init.redirect).toBe('error');expect(init.headers).toEqual(signAutomationBody(init.body as string,secret,now.getTime()));fetcher.mockResolvedValueOnce(json({schemaVersion:'dneskai-feed/1',sources:[]}));await expect(collectDneskaiFeed(source,now.toISOString(),{env,fetcher,signal,now})).rejects.toThrow('binding');});
 it('retains cap/unknown dates as partial and holds image-only authored items',async()=>{const source=DNESKAI_SOURCES.find(row=>row.id==='openai-blog')!,env={MARKETING_DNESKAI_SOURCE_URL:'https://quorum.example/source',MARKETING_DNESKAI_SOURCE_SECRET:'s'.repeat(32)},fetcher=vi.fn<typeof fetch>(async()=>json({schemaVersion:'dneskai-feed/1',sources:[{sourceId:source.id,status:'partial',errorCode:null,items:[{externalId:'test',title:'',summary:'',url:'https://example.test',publishedAt:null,fetchedAt:now.toISOString()}]}]}));const result=await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher,signal,now});expect(result.complete).toBe(false);expect(result.items[0]).toMatchObject({status:'held',reason:'collection-empty-source-text',targetDate:null});});
 it.each(['http://example.test/news','https://example.test/news#fragment','https://user:password@example.test/news','javascript:alert(1)','/relative','not a URL','https://example.test/'+ 'a'.repeat(2048)])('retains valid feed items but does not advance completeness after unsafe URL',async url=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='hn-frontpage')!,env={MARKETING_DNESKAI_SOURCE_URL:'https://quorum.example/source',MARKETING_DNESKAI_SOURCE_SECRET:'s'.repeat(32)},valid={externalId:'valid-test',title:'OFFLINE TEST valid news',summary:'Public summary',url:'https://example.test/news',publishedAt:now.toISOString(),fetchedAt:now.toISOString()},fetcher=vi.fn<typeof fetch>(async()=>json({schemaVersion:'dneskai-feed/1',sources:[{sourceId:source.id,status:'ok',errorCode:null,items:[{...valid,externalId:'invalid-test',url},valid]}]}));
  const result=await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher,signal,now});expect(result.items.map(item=>item.externalId)).toEqual(['valid-test']);expect(result).toMatchObject({complete:false,errorCode:'collection-source-invalid-url'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('retains source errors and cap/unknown date evidence when filtering URLs',async()=>{
  const source={...DNESKAI_SOURCES.find(row=>row.id==='hn-frontpage')!,maxItems:2},env={MARKETING_DNESKAI_SOURCE_URL:'https://quorum.example/source',MARKETING_DNESKAI_SOURCE_SECRET:'s'.repeat(32)},valid={externalId:'test',title:'OFFLINE TEST',summary:'Public summary',url:'https://example.test/news',publishedAt:null,fetchedAt:now.toISOString()};
  for(const status of ['partial','error']){const result=await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher:async()=>json({schemaVersion:'dneskai-feed/1',sources:[{sourceId:source.id,status,errorCode:status==='error'?'upstream-failure':null,items:[valid,{...valid,externalId:'bad',url:'http://example.test'}]}]}),signal,now});expect(result.items).toHaveLength(1);expect(result.complete).toBe(false);expect(result.errorCode).toBe(status==='error'?'collection-source-error':'collection-source-invalid-url');}
 });
 it.each([400,404,402,422,500])('exposes only static HTTP %i and allowlisted machine error without retry',async status=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!,fetcher=vi.fn<typeof fetch>(async()=>json({unused:'PRIVATE source text',error:{type:status===404?'actor-not-found':'invalid-input',message:'PRIVATE token and URL must never escape',details:{token:'PRIVATE'}}}));fetcher.mockResolvedValueOnce(Response.json({error:{type:status===404?'actor-not-found':'invalid-input',message:'PRIVATE token and URL must never escape'}},{status}));
  await expect(startDneskaiInstagram(source,'2026-10-12T00:00:00Z',{env:apifyEnv,fetcher,signal})).rejects.toThrow(`provider-http-${status}-${status===404?'actor-not-found':'invalid-input'}`);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['unknown','oversized','malformed'])('keeps HTTP status but discards %s diagnostic body',async kind=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!,body=kind==='malformed'?'not-json':JSON.stringify({error:{type:kind==='unknown'?'PRIVATE-unknown-machine-value':'invalid-input',message:kind==='oversized'?'PRIVATE'.repeat(4000):'PRIVATE'}}),fetcher=vi.fn<typeof fetch>(async()=>new Response(body,{status:400}));
  try{await startDneskaiInstagram(source,'2026-10-12T00:00:00Z',{env:apifyEnv,fetcher,signal});throw new Error('expected rejection');}catch(error){expect((error as Error).message).toBe('provider-http-400');}expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each([
  ['2026-10-06T21:09:06.897873+00:00','2026-10-06T21:09:06.897Z'],
  ['2026-10-06T23:09:06.897873+02:00','2026-10-06T21:09:06.897Z'],
  ['2026-10-06T16:09:06-05:00','2026-10-06T21:09:06.000Z'],
 ])('converts persisted watermark %s to the pinned actor UTC input',async(since,expected)=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!;
  // Official input schema, build 0.0.813, read 2026-10-13. Offset suffixes are not accepted.
  const actorDatePattern=/^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T[0-2]\d:[0-5]\d(:[0-5]\d)?(\.\d+)?Z?)?$|^(\d+)\s*(minute|hour|day|week|month|year)s?$/;
  expect(actorDatePattern.test(since)).toBe(false);
  const fetcher=vi.fn<typeof fetch>(async(_url,init)=>{
   const input=JSON.parse(String(init?.body));expect(input.onlyPostsNewerThan).toBe(expected);
   expect(actorDatePattern.test(input.onlyPostsNewerThan)).toBe(true);
   expect(Math.abs(Date.parse(input.onlyPostsNewerThan)-Date.parse(since))).toBeLessThan(1);
   return json({data:registration});
  });
  await startDneskaiInstagram(source,since,{env:apifyEnv,fetcher,signal});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it.each(['not-a-date','2026-02-30T12:00:00Z','2026-10-06T21:00:00'])('rejects invalid or unzoned watermark %s before a paid request',async since=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!,fetcher=vi.fn<typeof fetch>();
  await expect(startDneskaiInstagram(source,since,{env:apifyEnv,fetcher,signal})).rejects.toThrow('collection-instagram-input-invalid');expect(fetcher).not.toHaveBeenCalled();
 });
 it('starts one capped pinned async official actor, then polls exact registered run and preserves bounded media URLs',async()=>{const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!,fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({data:{...registration,status:'RUNNING',usageTotalUsd:null}})).mockResolvedValueOnce(json({data:registration})).mockResolvedValueOnce(json([{id:'post-test',shortCode:'test',caption:'OFFLINE TEST public caption',timestamp:'2026-10-13T20:20:00Z',url:'https://www.instagram.com/p/test/',ownerUsername:'mosseri',displayUrl:'https://cdn.example.test/a.jpg',images:['https://cdn.example.test/b.jpg'],childPosts:[{displayUrl:'https://cdn.example.test/c.jpg'}]}]));await startDneskaiInstagram(source,'2026-10-12T00:00:00Z',{env:apifyEnv,fetcher,signal});const startUrl=fetcher.mock.calls[0][0];expect(new URL(String(startUrl)).origin).toBe('https://api.apify.com');expect(new URL(String(startUrl)).pathname).toBe('/v2/actors/apify~instagram-scraper/runs');expect(Object.fromEntries(new URL(String(startUrl)).searchParams)).toEqual({build:'1.2.3',waitForFinish:'0',timeout:'120',restartOnError:'false',maxItems:'10',maxTotalChargeUsd:'0.04'});expect(startUrl).toContain('waitForFinish=0');expect(startUrl).toContain('maxTotalChargeUsd=0.04');expect(startUrl).toContain('restartOnError=false');expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer test-only-token');const result=await pollDneskaiInstagram(source,registration,'2026-10-12T00:00:00Z',{env:apifyEnv,fetcher,signal,now});expect(result.running).toBe(false);if(!result.running)expect(result.items[0].mediaUrls).toHaveLength(3);expect(fetcher.mock.calls.every(call=>String(call[0]).startsWith('https://api.apify.com/'))).toBe(true);});
 it('accepts explicit coauthorship on the exact requested profile and still filters an old pinned post',async()=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!;
  // Synthetic public-shaped rows reproduce the observed actor structure without copying live captions or profile media.
  const post={id:'collaborative-test',shortCode:'test',caption:'OFFLINE TEST collaborative public caption',timestamp:'2026-10-12T12:00:00Z',url:'https://www.instagram.com/p/test/',ownerUsername:'test_creator',inputUrl:source.url,coauthorProducers:[{username:'mosseri',id:'123',full_name:'TEST ONLY',profile_pic_url:'https://example.test/never-fetch.jpg'}]};
  const old={...post,id:'pinned-test',timestamp:'2025-10-12T12:00:00Z',ownerUsername:'mosseri',coauthorProducers:null};
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({data:registration})).mockResolvedValueOnce(json([old,post]));
  const result=await pollDneskaiInstagram(source,registration,'2026-10-11T00:00:00Z',{env:apifyEnv,fetcher,signal,now});
  expect(result.running).toBe(false);if(!result.running){expect(result.items.map(item=>item.externalId)).toEqual(['collaborative-test']);expect(result.complete).toBe(true);expect(result.run.usageTotalUsd).toBe(0.01);expect(result.items[0]).not.toHaveProperty('coauthorProducers');}
  const fields=new URL(String(fetcher.mock.calls[1][0])).searchParams.get('fields')!.split(',');expect(fields).toContain('inputUrl');expect(fields).toContain('coauthorProducers');expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('records the post owner and item type so credit and caption-only handling need no second request',async()=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!;
  const base={shortCode:'test',caption:'OFFLINE TEST public caption',timestamp:'2026-10-12T12:00:00Z',url:'https://www.instagram.com/p/test/'};
  const rows=[{...base,id:'reel-test',ownerUsername:'mosseri',type:'Video',productType:'clips',displayUrl:'https://cdn.example.test/cover.jpg'},
   {...base,id:'carousel-test',ownerUsername:'test_creator',inputUrl:source.url,coauthorProducers:[{username:'mosseri'}],type:'Sidecar',childPosts:[{type:'Image',displayUrl:'https://cdn.example.test/1.jpg'},{type:'Video',displayUrl:'https://cdn.example.test/2.jpg'}]},
   {...base,id:'image-test',ownerUsername:'mosseri',type:'Image'},{...base,id:'unknown-test',ownerUsername:'mosseri'}];
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({data:registration})).mockResolvedValueOnce(json(rows));
  const result=await pollDneskaiInstagram(source,registration,'2026-10-11T00:00:00Z',{env:apifyEnv,fetcher,signal,now});
  expect(result.running).toBe(false);
  if(!result.running)expect(Object.fromEntries(result.items.map(item=>[item.externalId,item.instagram]))).toEqual({'reel-test':{ownerUsername:'mosseri',mediaType:'video'},'carousel-test':{ownerUsername:'test_creator',mediaType:'carousel',containsVideo:true},'image-test':{ownerUsername:'mosseri',mediaType:'image'},'unknown-test':{ownerUsername:'mosseri'}});
  const fields=new URL(String(fetcher.mock.calls[1][0])).searchParams.get('fields')!.split(',');expect(fields).toEqual(expect.arrayContaining(['type','productType','ownerUsername']));
  // The detail is additive: the candidate id and content hash are those of the same post without it.
  if(!result.running){const reel=result.items[0];const plain=candidate(source.id,'reel-test',reel.title,reel.text,reel.url,reel.publishedAt,reel.fetchedAt,reel.mediaUrls);expect([reel.id,reel.contentHash]).toEqual([plain.id,plain.contentHash]);expect(plain).not.toHaveProperty('instagram');}
 });
 it.each(['missing-input','foreign-input','query-input','non-profile-input','missing-coauthors','foreign-coauthor','case-mismatch','mentions-only','tags-only','too-many','invalid-username'])('rejects collaborative %s evidence without weakening source binding',async mutation=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!;
  const post:Record<string,unknown>={id:'collaborative-test',shortCode:'test',caption:'OFFLINE TEST public caption @mosseri',timestamp:'2026-10-12T12:00:00Z',url:'https://www.instagram.com/p/test/',ownerUsername:'test_creator',inputUrl:source.url,coauthorProducers:[{username:'mosseri'}]};
  if(mutation==='missing-input')delete post.inputUrl;
  if(mutation==='foreign-input')post.inputUrl='https://www.instagram.com/another_profile/';
  if(mutation==='query-input')post.inputUrl=source.url+'?profile=mosseri';
  if(mutation==='non-profile-input')post.inputUrl=post.url;
  if(mutation==='missing-coauthors')post.coauthorProducers=null;
  if(mutation==='foreign-coauthor')post.coauthorProducers=[{username:'another_profile'}];
  if(mutation==='case-mismatch')post.coauthorProducers=[{username:'Mosseri'}];
  if(mutation==='mentions-only'){delete post.coauthorProducers;post.mentions=['mosseri'];}
  if(mutation==='tags-only'){delete post.coauthorProducers;post.taggedUsers=[{username:'mosseri'}];}
  if(mutation==='too-many')post.coauthorProducers=Array.from({length:21},()=>({username:'mosseri'}));
  if(mutation==='invalid-username')post.coauthorProducers=[{username:'@mosseri'}];
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({data:registration})).mockResolvedValueOnce(json([post]));
  await expect(pollDneskaiInstagram(source,registration,'2026-10-11T00:00:00Z',{env:apifyEnv,fetcher,signal,now})).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('keeps exact-cap collaborative results incomplete and marks them for the cursor to move',async()=>{
  const source={...DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!,maxItems:1};
  const post=(timestamp:string)=>[{id:'test',shortCode:'test',caption:'OFFLINE TEST public caption',timestamp,url:'https://www.instagram.com/p/test/',ownerUsername:'test_creator',inputUrl:source.url,coauthorProducers:[{username:'mosseri'}]}];
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({data:registration})).mockResolvedValueOnce(json(post('2026-10-12T12:00:00Z')));
  const result=await pollDneskaiInstagram(source,registration,'2026-10-11T00:00:00Z',{env:apifyEnv,fetcher,signal,now});expect(result.running).toBe(false);if(!result.running)expect(result).toMatchObject({complete:false,errorCode:'collection-source-item-cap'});
  // A full page with nothing inside the window gives the cursor nothing to move to.
  fetcher.mockResolvedValueOnce(json({data:registration})).mockResolvedValueOnce(json(post('2026-10-10T12:00:00Z')));
  const stale=await pollDneskaiInstagram(source,registration,'2026-10-11T00:00:00Z',{env:apifyEnv,fetcher,signal,now});if(!stale.running)expect(stale).toMatchObject({complete:false,errorCode:'collection-source-partial',items:[]});
 });
 it('distinguishes a cap-only feed read from other partial results and dates undated items by fetch time',async()=>{
  const source=DNESKAI_SOURCES.find(row=>row.id==='openai-blog')!,env={MARKETING_DNESKAI_SOURCE_URL:'https://quorum.example/source',MARKETING_DNESKAI_SOURCE_SECRET:'s'.repeat(32)};
  const item=(i:number,publishedAt:string|null=now.toISOString())=>({externalId:`cap-${i}`,title:`OFFLINE capped item ${i}`,summary:'Public summary',url:`https://example.test/cap-${i}`,publishedAt,fetchedAt:now.toISOString()});
  const respond=(status:string,errorCode:string|null,items:unknown[])=>vi.fn<typeof fetch>(async()=>json({schemaVersion:'dneskai-feed/1',sources:[{sourceId:source.id,status,errorCode,items}]}));
  const full=Array.from({length:source.maxItems},(_,i)=>item(i));
  for(const code of ['item-cap','item-cap,upstream-cap','upstream-cap'])expect(await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher:respond('partial',code,full),signal,now})).toMatchObject({complete:false,errorCode:'collection-source-item-cap'});
  for(const [code,items] of [['item-cap,unknown-date',[...full.slice(1),item(99,null)]],['duplicate-item,item-cap',full],['unknown-date',[item(1,null)]]] as const)expect(await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher:respond('partial',code,[...items]),signal,now})).toMatchObject({complete:false,errorCode:'collection-source-partial'});
  expect((await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher:respond('error','fetch-failed',[]),signal,now})).errorCode).toBe('collection-source-error');
  const undated=await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher:respond('partial','unknown-date',[item(1,null)]),signal,now});
  expect(undated.items[0]).toMatchObject({publishedAt:now.toISOString(),fetchedAt:now.toISOString(),dateEstimated:true,status:'new'});
  expect((await collectDneskaiFeed(source,'2026-10-12T00:00:00Z',{env,fetcher:respond('ok',null,[item(2)]),signal,now})).items[0]).not.toHaveProperty('dateEstimated');
 });
 it('keeps up to ten carousel media references per candidate',()=>{expect(candidate('instagram:mosseri','m','OFFLINE title','OFFLINE text','https://www.instagram.com/p/m/',now.toISOString(),now.toISOString(),Array.from({length:14},(_,i)=>`https://cdn.example.test/${i}.jpg`)).mediaUrls).toHaveLength(10);});
 it('does not load datasets with unknown or over-budget costs or a forged run',async()=>{const source=DNESKAI_SOURCES.find(row=>row.id==='instagram:mosseri')!;for(const patch of [{usageTotalUsd:null},{usageTotalUsd:0.1}]){const fetcher=vi.fn<typeof fetch>(async()=>json({data:{...registration,...patch}}));const result=await pollDneskaiInstagram(source,registration,'2026-10-12T00:00:00Z',{env:apifyEnv,fetcher,signal,now});expect(result.running).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);}const fetcher=vi.fn<typeof fetch>(async()=>json({data:{...registration,id:'foreign'}}));await expect(pollDneskaiInstagram(source,registration,now.toISOString(),{env:apifyEnv,fetcher,signal,now})).rejects.toThrow('binding');});
 it('binds every documented Jev field reference to the submitted state, including batch indexes',()=>{
  const request=jevRequest([row(),{...row(),id:'second-test'}],[{id:'history-test',title:'Earlier event',text:'Earlier public excerpt'}]);
  for(const [key,value]of Object.entries(request.questions)){
   const question=value as {instructions:string;criteria?:Record<string,string|null>};
   const references=[...question.instructions.matchAll(/`([^`]+)`/g)].map(match=>match[1]);
   expect(references.length).toBeGreaterThan(0);
   for(const reference of references){
    const parts=reference.replace(/\[(\d+)\]/g,'.$1').split('.');
    const resolved=parts.reduce<unknown>((current,part)=>(current as Record<string,unknown>)?.[part],request.state);
    expect(resolved,reference).toBeDefined();
   }
   expect(references).toContain(`items[${key.split('_').at(-1)}]`);
   if(key.startsWith('relevance')){expect(question.criteria?.true).toBeTruthy();expect(question.criteria?.false).toBeTruthy();}
  }
 });
 it('uses pinned official Jev schema and known usage cost, compact history and supported duplicate binding',async()=>{const items=[row()],history=[{id:'prior-test',title:'A prior event',text:'Prior public source text'}],request=jevRequest(items,history),response=jevResponse(request);(response.answers.duplicate_0 as {choice:string;probabilities:Record<string,number>}).choice='h0';(response.answers.duplicate_0 as {probabilities:Record<string,number>}).probabilities={none:0,uncertain:0,h0:1};const fetcher=vi.fn<typeof fetch>(async()=>json(response));const result=await classifyDneskaiCandidates(items,history,{env:{TYPESAFE_API_KEY:'test-only'},fetcher,signal});expect(result.items[0]).toMatchObject({status:'duplicate',duplicateOf:'prior-test',targetDate:null});expect(result.costUsd).toBeCloseTo(0.000042);expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).model).toBe('jev-1.13.0');});
 it.each(['sum','missing','winner','unsupported','model','usage'])('holds malformed Jev %s response',async mutation=>{const items=[row()],request=jevRequest(items,[]),response=jevResponse(request);const category=response.answers.category_0 as {choice:string;probabilities:Record<string,number>};if(mutation==='sum')category.probabilities['ai-news']=0.2;if(mutation==='missing')delete category.probabilities.other;if(mutation==='winner'){category.choice='other';}if(mutation==='unsupported')category.choice='truth';if(mutation==='model')response.model='jev-latest';if(mutation==='usage')response.usage.input_tokens=64001;await expect(classifyDneskaiCandidates(items,[],{env:{TYPESAFE_API_KEY:'test-only'},fetcher:async()=>json(response),signal})).rejects.toThrow();});
 it('keeps uncertain interpretation held and refuses absent credentials before HTTP',async()=>{const items=[row()],response=jevResponse(jevRequest(items,[]));(response.answers.relevance_0 as {noul:number}).noul=0.8;const result=await classifyDneskaiCandidates(items,[],{env:{TYPESAFE_API_KEY:'test-only'},fetcher:async()=>json(response),signal});expect(result.items[0].status).toBe('held');const fetcher=vi.fn();await expect(classifyDneskaiCandidates(items,[],{env:{},fetcher,signal})).rejects.toThrow('unconfigured');expect(fetcher).not.toHaveBeenCalled();});
 it('accepts uncertain on-topic taxonomy without turning it into uncertain relevance',async()=>{
  const items=[row()],response=jevResponse(jevRequest(items,[]));
  response.answers.category_0={type:'choice',choice:'ai-news',confidence:0.28,probabilities:{'ai-news':0.4,'tech-news':0.3,marketing:0,tool:0.1,'ai-project':0.2,other:0}};
  const result=await classifyDneskaiCandidates(items,[],{env:{TYPESAFE_API_KEY:'test-only'},fetcher:async()=>json(response),signal});
  expect(result.items[0]).toMatchObject({status:'new',reason:null,targetDate:null});
  expect(result.diagnostics[0]).toMatchObject({inScopeProbability:1,categoryConfidence:0.28,failedChecks:[]});
  expect(items[0]).toEqual(row());
 });
 it.each([
  ['category',0.2,0.99,1],['duplicate',0,0.99,0.89],['relevance',0,0.84,1],
  ['category-duplicate-relevance',0.2,0.84,0.89],
 ] as const)('keeps %s uncertainty held with a specific diagnostic',async(reason,other,relevance,unique)=>{
  const items=[row()],response=jevResponse(jevRequest(items,[]));
  response.answers.category_0={type:'choice',choice:'ai-news',confidence:0.95,probabilities:{'ai-news':1-other,'tech-news':0,marketing:0,tool:0,'ai-project':0,other}};
  response.answers.relevance_0={type:'noul',noul:relevance};
  response.answers.duplicate_0={type:'choice',choice:'none',confidence:0.95,probabilities:{none:unique,uncertain:1-unique}};
  const result=await classifyDneskaiCandidates(items,[],{env:{TYPESAFE_API_KEY:'test-only'},fetcher:async()=>json(response),signal});
  expect(result.items[0]).toMatchObject({status:'held',reason:'collection-review-'+reason});
  expect(result.diagnostics[0].failedChecks).toEqual(reason.split('-'));
 });
 it('rejects clearly unrelated content, but leaves ambiguous promotion held',async()=>{
  const items=[row()],response=jevResponse(jevRequest(items,[]));
  response.answers.category_0={type:'choice',choice:'other',confidence:1,probabilities:{'ai-news':0,'tech-news':0,marketing:0,tool:0,'ai-project':0,other:1}};
  response.answers.relevance_0={type:'noul',noul:0.04};
  const result=await classifyDneskaiCandidates(items,[],{env:{TYPESAFE_API_KEY:'test-only'},fetcher:async()=>json(response),signal});
  expect(result.items[0]).toMatchObject({status:'rejected',reason:'collection-editorial-out-of-scope'});
 });
 it.each([0.99,1.01,0.98,1.02])('handles rounded distribution sum %s without accepting malformed distributions',async sum=>{
  const items=[row()],response=jevResponse(jevRequest(items,[]));
  response.answers.category_0={type:'choice',choice:'ai-news',confidence:0.8,probabilities:{'ai-news':0.9,'tech-news':sum-0.9,marketing:0,tool:0,'ai-project':0,other:0}};
  const result=classifyDneskaiCandidates(items,[],{env:{TYPESAFE_API_KEY:'test-only'},fetcher:async()=>json(response),signal});
  if(sum===0.99||sum===1.01)expect((await result).items[0].status).toBe('new');
  else await expect(result).rejects.toThrow('collection-jev-schema-invalid');
 });
 it('binds duplicate options to real prior state paths and never compares with future items',()=>{
  const request=jevRequest([row(),row(1)],[{id:'history',title:'Prior event',text:'Public excerpt'}]);
  const first=request.questions.duplicate_0 as {criteria:Record<string,string>};
  const second=request.questions.duplicate_1 as {criteria:Record<string,string>};
  expect(first.criteria.h0).toBe('`history[0]`');expect(first.criteria).not.toHaveProperty('c0');
  expect(second.criteria.c0).toBe('`items[0]`');expect(second.criteria).not.toHaveProperty('c1');
 });

});
