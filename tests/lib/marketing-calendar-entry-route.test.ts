import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { fetchWithSignal } from '@/lib/abortable';
import { parseSourcePacket } from '@/lib/marketing/contracts';
const m=vi.hoisted(()=>({client:vi.fn(),auth:vi.fn(),rpc:vi.fn(),retry:vi.fn(),signal:vi.fn(),result:vi.fn()}));
vi.mock('server-only',()=>({}));vi.mock('@/lib/supabase/server',()=>({createClient:m.client}));
import { POST } from '@/app/api/marketing/calendar-entries/route';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',sourceId='33333333-3333-4333-8333-333333333333';
const input={id,expectedCampaignHash:'a'.repeat(64),sourceId,date:'2099-10-30',time:'09:00',kind:'thread'};
const request=(options:{headers?:Record<string,string>;body?:string;signal?:AbortSignal}={})=>new Request('https://own.example/api/marketing/calendar-entries',{method:'POST',headers:{Origin:'https://own.example','Content-Type':'application/json',...options.headers},body:options.body??JSON.stringify(input),signal:options.signal});
beforeEach(()=>{vi.clearAllMocks();const query={retry:m.retry,abortSignal:m.signal,then:(resolve:(value:unknown)=>unknown,reject?:(error:unknown)=>unknown)=>Promise.resolve(m.result()).then(resolve,reject)};m.retry.mockReturnValue(query);m.signal.mockReturnValue(query);m.rpc.mockReturnValue(query);m.result.mockResolvedValue({data:null,error:null});m.auth.mockResolvedValue({data:{user:{id:owner}},error:null});m.client.mockResolvedValue({auth:{getUser:m.auth},rpc:m.rpc});});
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();});
it('uses verified original owner admission and one bounded no-retry void RPC',async()=>{
 const original=request({headers:{'x-own-dashboard-owner':owner}}),response=await POST(original);expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true});expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(m.rpc).toHaveBeenCalledExactlyOnceWith('marketing_release_calendar_entry',{p_entry:id,p_hash:input.expectedCampaignHash,p_source:sourceId,p_date:input.date,p_time:input.time,p_kind:input.kind});expect(m.retry).toHaveBeenCalledExactlyOnceWith(false);expect(m.signal.mock.calls[0][0].aborted).toBe(true);expect(original.signal.aborted).toBe(false);
});
it.each([400,401,403,0,429,503])('refuses a cached user accompanying auth error %i',async status=>{m.auth.mockResolvedValue({data:{user:{id:owner}},error:{status,message:'TEST_ONLY_PRIVATE'}});const response=await POST(request());expect(response.status).toBe([400,401,403].includes(status)?401:503);expect(m.rpc).not.toHaveBeenCalled();expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');});
it('contains session-construction failures',async()=>{m.client.mockRejectedValue(Error('TEST_ONLY_PRIVATE'));const response=await POST(request());expect(response.status).toBe(503);expect(m.rpc).not.toHaveBeenCalled();expect(await response.text()).not.toContain('TEST_ONLY_PRIVATE');});
it.each(['invalid','44444444-4444-4444-8444-444444444444'])('refuses invalid or changed original owner %s',async value=>{expect((await POST(request({headers:{'x-own-dashboard-owner':value}}))).status).toBe(value==='invalid'?400:409);expect(m.rpc).not.toHaveBeenCalled();});
it.each(['json','extra','id','source','hash','date','time','expired'])('refuses invalid %s input before SQL admission',async kind=>{
 const patch=kind==='extra'?{extra:true}:kind==='id'?{id:'invalid'}:kind==='source'?{sourceId:'invalid'}:kind==='hash'?{expectedCampaignHash:'invalid'}:kind==='date'?{date:'2099-02-30'}:kind==='time'?{time:'25:00'}:kind==='expired'?{date:'2000-01-01'}:{};
 expect((await POST(request({body:kind==='json'?'{':JSON.stringify({...input,...patch})}))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();
});
it.each(['claimed','actual'])('refuses %s oversized input before SQL admission',async kind=>{const response=await POST(request({headers:kind==='claimed'?{'Content-Length':'5000'}:{},body:kind==='actual'?' '.repeat(4096)+JSON.stringify(input):undefined}));expect(response.status).toBe(413);expect(m.rpc).not.toHaveBeenCalled();});
it('rejects cross-origin and retired requests before session work',async()=>{expect((await POST(request({headers:{Origin:'https://foreign.example'}}))).status).toBe(403);const controller=new AbortController();controller.abort();expect((await POST(request({signal:controller.signal}))).status).toBe(503);expect(m.client).not.toHaveBeenCalled();});
it.each(['auth','write'] as const)('does not confirm a late result after retirement during %s',async phase=>{
 let finish!:(value:unknown)=>void;const producer=phase==='auth'?m.auth:m.result;producer.mockReturnValue(new Promise(resolve=>{finish=resolve;}));const controller=new AbortController(),pending=POST(request({signal:controller.signal}));await vi.waitFor(()=>expect(producer).toHaveBeenCalledOnce());controller.abort();finish(phase==='auth'?{data:{user:{id:owner}},error:null}:{data:null,error:null});const response=await pending;expect(response.status).toBe(503);expect(m.rpc).toHaveBeenCalledTimes(phase==='auth'?0:1);
});
it.each(['database-error','throw','nonvoid'])('keeps admitted %s uncertainty fixed and private',async kind=>{if(kind==='throw')m.result.mockRejectedValue(Error('TEST_ONLY_PRIVATE'));else m.result.mockResolvedValue({data:kind==='nonvoid'?{}:null,error:kind==='database-error'?{code:'XX000',message:'TEST_ONLY_PRIVATE'}:null});const response=await POST(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'calendar-release-unconfirmed'});});
it('retains a known transactional refusal without disclosing its detail',async()=>{m.result.mockResolvedValue({data:null,error:{code:'P0001',message:'TEST_ONLY_PRIVATE'}});const response=await POST(request());expect(response.status).toBe(409);expect(await response.json()).toEqual({error:'calendar-release-unavailable'});});
it.each(['auth','write'] as const)('ends a held %s consumer at its original phase budget',async phase=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(milliseconds=>{const controller=new AbortController();setTimeout(()=>controller.abort(),milliseconds);return controller.signal;});const producer=phase==='auth'?m.auth:m.result;producer.mockReturnValue(new Promise(()=>{}));const pending=POST(request());await vi.waitFor(()=>expect(producer).toHaveBeenCalledOnce());await vi.advanceTimersByTimeAsync(phase==='auth'?10001:15001);expect((await pending).status).toBe(503);expect(m.rpc).toHaveBeenCalledTimes(phase==='auth'?0:1);
});

it('accepts exact input bytes and ends a held body without SQL admission',async()=>{
 expect((await POST(request({body:JSON.stringify(input).padEnd(4096,' ')}))).status).toBe(200);m.rpc.mockClear();
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(milliseconds=>{const controller=new AbortController();setTimeout(()=>controller.abort(),milliseconds);return controller.signal;});const cancel=vi.fn(),original=new Request('https://own.example/api/marketing/calendar-entries',{method:'POST',headers:{Origin:'https://own.example'},body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel}),duplex:'half'} as RequestInit);
 const pending=POST(original);await vi.waitFor(()=>expect(original.body?.locked).toBe(true));await vi.advanceTimersByTimeAsync(5001);const response=await pending;expect(response.status).toBe(408);expect(m.rpc).not.toHaveBeenCalled();expect(cancel).toHaveBeenCalledOnce();expect(original.body?.locked).toBe(false);
});
it('uses the actual authenticated SDK and existing release RPC without publication or unrelated changes',async()=>{
 const db=await createMigratedDatabase({owner,instant:'2099-10-29T00:00:00Z'});const campaign='44444444-4444-4444-8444-444444444444';
 try{
  const packet=parseSourcePacket({schemaVersion:'marketing-source/1',brand:'devshark',kind:'question',sourceId:'source:owned',sourceRevision:'v1',contentHash:'c'.repeat(64),canonicalUrl:'https://example.test/source',locale:'en',observedAt:'2099-10-29T00:00:00Z',expiresAt:null,eligible:true,eligibilityReason:'active',content:{title:'Current source',body:'Authored body',category:'test',difficulty:null,code:null,options:['A','B'],answer:'A',explanation:'Authored explanation',evidence:[],image:null}});
  await db.query(`insert into marketing_campaigns(id,user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash,status)values($1,$2,'devshark','Selected','2099-10-29','2099-11-04','{}',$3,'active')`,[campaign,owner,input.expectedCampaignHash]);
  await db.query(`insert into marketing_sources(id,user_id,brand,source_id,source_revision,content_hash,packet,observed_at,eligible)values($1,$2,'devshark','source:owned','v1',$3,$4,'2099-10-29',true)`,[sourceId,owner,packet.contentHash,JSON.stringify(packet)]);
  await db.query(`insert into marketing_calendar_entries(id,user_id,campaign_id,source_id,date,local_time,kind,platform,title,original,needs_review)values($1,$2,$3,'slot:owned','2099-10-30','10:00','thread','threads','Owned slot','{}',true)`,[id,owner,campaign]);
  const origin='https://slot.supabase.test',emulator=new SupabaseEmulator(db,origin,{service:'TEST-ONLY-SERVICE',users:{[owner]:'TEST-ONLY-OWNER'}});
  m.client.mockImplementation((signal:AbortSignal)=>{const sdk=createClient(origin,'TEST-ONLY-PUBLISHABLE',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchWithSignal(signal,emulator.fetch.bind(emulator)),headers:{Authorization:'Bearer TEST-ONLY-OWNER'}}});vi.spyOn(sdk.auth,'getUser').mockImplementation(()=>m.auth());return sdk;});
  const response=await POST(request({headers:{'x-own-dashboard-owner':owner}}));expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true});expect(emulator.requests).toHaveLength(1);
  expect((await db.query('select bound_source_id,local_time,generation_version,status,needs_review from marketing_calendar_entries where id=$1',[id])).rows[0]).toEqual({bound_source_id:sourceId,local_time:input.time,generation_version:2,status:'planned',needs_review:false});
  expect((await db.query('select count(*)::int count from marketing_publications')).rows[0]).toEqual({count:0});
 }finally{await db.close();}
},120_000);
