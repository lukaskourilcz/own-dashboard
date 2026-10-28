import { afterEach, expect, it, vi } from 'vitest';
import { refreshInstagramToken } from '@/lib/marketing/meta-credentials';
vi.mock('server-only', () => ({}));
const owner='11111111-1111-4111-8111-111111111111', id='22222222-2222-4222-8222-222222222222';
const account={id,user_id:owner,brand:'dneskai' as const,platform:'instagram' as const},now=new Date('2026-10-28T10:00:00Z');
const scopes=['instagram_business_basic','instagram_business_content_publish'];
const token={access_token:'TEST-ONLY-STORED-TOKEN-00000001',expires_at:'2026-11-01T10:00:00Z',refreshed_at:'2026-09-01T10:00:00Z',scopes,login_mode:'instagram'};
const body={access_token:'TEST-ONLY-RENEWED-TOKEN-00000001',expires_in:5184000};
function database(read:()=>Promise<unknown>=async()=>({data:[token],error:null}), saved?:unknown) {
 const rpc=vi.fn((name:string,args:Record<string,unknown>)=>{
  const pending=name==='marketing_read_account_token'?read():Promise.resolve({data:saved??{accountId:id,token:{expiresAt:args.p_expires_at,refreshedAt:now.toISOString(),scopes,loginMode:'instagram'}},error:null});
  const query={retry:()=>query,abortSignal:()=>query,then:pending.then.bind(pending)};return query;
 });return {db:{rpc} as never,rpc};
}
afterEach(()=>vi.restoreAllMocks());
it('starts no store or provider work after original refresh retirement',async()=>{
 const caller=new AbortController();caller.abort('TEST_ONLY_PRIVATE_REASON');const {db,rpc}=database(),fetcher=vi.fn(async()=>Response.json(body));
 expect(await refreshInstagramToken(db,owner,account,{now,env:{},fetcher,signal:caller.signal})).toMatchObject({status:'uncertain'});
 expect(rpc).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
it('does not start provider work after cancellation during the original private read',async()=>{
 let release!:(value:unknown)=>void;const waiting=new Promise(resolve=>{release=resolve;}),{db,rpc}=database(()=>waiting),caller=new AbortController(),fetcher=vi.fn(async()=>Response.json(body));
 const pending=refreshInstagramToken(db,owner,account,{now,env:{},fetcher,signal:caller.signal});await vi.waitFor(()=>expect(rpc).toHaveBeenCalledOnce());caller.abort();release({data:[token],error:null});await pending;
 expect(fetcher).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledOnce();
});
it('does not persist a provider response delivered after original retirement',async()=>{
 const caller=new AbortController(),{db,rpc}=database(),fetcher=vi.fn(async()=>{caller.abort();return Response.json(body);});
 expect(await refreshInstagramToken(db,owner,account,{now,env:{},fetcher,signal:caller.signal})).toMatchObject({status:'uncertain'});
 expect(rpc.mock.calls.map(([name])=>name)).toEqual(['marketing_read_account_token']);
});
it('bounds a successful JSON prefix before parsing or storing a renewed credential',async()=>{
 const {db,rpc}=database(),fetcher=vi.fn(async()=>new Response(JSON.stringify(body)+' '.repeat(1024*1024),{headers:{'Content-Type':'application/json'}}));
 expect(await refreshInstagramToken(db,owner,account,{now,env:{},fetcher})).toMatchObject({status:'uncertain',code:'refresh-response-invalid'});
 expect(rpc).toHaveBeenCalledOnce();
});
it.each([
 {accountId:'33333333-3333-4333-8333-333333333333',token:{expiresAt:'2026-12-27T10:00:00Z',refreshedAt:now.toISOString(),scopes,loginMode:'instagram'}},
 {accountId:id,token:{expiresAt:'infinity',refreshedAt:now.toISOString(),scopes,loginMode:'instagram'}},
 {accountId:id,token:{expiresAt:'2026-12-27T10:00:00Z',refreshedAt:'infinity',scopes,loginMode:'instagram'}},
 {accountId:id,token:{expiresAt:'2026-12-27T10:00:00Z',refreshedAt:now.toISOString(),scopes,loginMode:'facebook'}},
])('keeps a foreign or malformed save receipt unconfirmed: %#',async saved=>{
 const {db}=database(undefined,saved),fetcher=vi.fn(async()=>Response.json(body));
 expect(await refreshInstagramToken(db,owner,account,{now,env:{},fetcher})).toMatchObject({status:'uncertain',code:'refresh-store-failed'});
});

it.each([{expires_at:'infinity'},{refreshed_at:'not-a-date'},{scopes:[scopes[0],scopes[0]]}])('refuses malformed private metadata before any provider request: %#',async patch=>{
 const {db}=database(async()=>({data:[{...token,...patch}],error:null})),fetcher=vi.fn(async()=>Response.json(body));
 expect(await refreshInstagramToken(db,owner,account,{now,env:{},fetcher})).toMatchObject({status:'held',code:'credential-store-unavailable'});expect(fetcher).not.toHaveBeenCalled();
});
it('captures the account, clock and renewal configuration before the private read waits',async()=>{
 let release!:(value:unknown)=>void;const waiting=new Promise(resolve=>{release=resolve;});
 const selected={...account},clock=new Date(now),env={MARKETING_META_APP_ID:'12345',MARKETING_META_APP_SECRET:'TEST_ONLY_ORIGINAL_APP_SECRET',MARKETING_DNESKAI_INSTAGRAM_API_VERSION:'v24.0'};
 const saved={accountId:id,token:{expiresAt:'2026-12-27T10:00:00Z',refreshedAt:now.toISOString(),scopes,loginMode:'facebook'}};
 const {db,rpc}=database(()=>waiting,saved),fetcher=vi.fn<typeof fetch>(async()=>Response.json(body));
 const pending=refreshInstagramToken(db,owner,selected,{now:clock,env,fetcher});
 selected.id='33333333-3333-4333-8333-333333333333';clock.setUTCFullYear(2099);env.MARKETING_META_APP_ID='99999';env.MARKETING_META_APP_SECRET='TEST_ONLY_REPLACEMENT_APP_SECRET';env.MARKETING_DNESKAI_INSTAGRAM_API_VERSION='v99.0';
 release({data:[{...token,login_mode:'facebook'}],error:null});expect(await pending).toMatchObject({status:'refreshed',accountId:id});
 const url=new URL(String(fetcher.mock.calls[0]?.[0]));expect(url.pathname).toBe('/v24.0/oauth/access_token');expect(url.searchParams.get('client_id')).toBe('12345');expect(url.searchParams.get('client_secret')).toBe('TEST_ONLY_ORIGINAL_APP_SECRET');
 expect(rpc).toHaveBeenLastCalledWith('marketing_store_account_token',expect.objectContaining({p_account:id}));
});
it('bounds the whole renewal while an injected provider never settles',async()=>{
 const timeouts=new Map<number,AbortController>();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const scope=new AbortController();timeouts.set(ms,scope);return scope.signal;});
 const {db,rpc}=database(),fetcher=vi.fn(()=>new Promise<Response>(()=>{}));
 const pending=refreshInstagramToken(db,owner,account,{now,env:{},fetcher});await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());timeouts.get(25000)!.abort();
 expect(await pending).toMatchObject({status:'uncertain',code:'refresh-request-uncertain'});expect(rpc).toHaveBeenCalledOnce();
});
it('does not confirm a write acknowledgement delivered after original retirement',async()=>{
 const caller=new AbortController(),{db,rpc}=database(),original=rpc.getMockImplementation()!;
 rpc.mockImplementation((name,args)=>{if(name!=='marketing_store_account_token')return original(name,args);const pending:Promise<unknown>=Promise.resolve().then(()=>{caller.abort();return {data:{accountId:id,token:{expiresAt:'2026-12-27T10:00:00Z',refreshedAt:now.toISOString(),scopes,loginMode:'instagram'}},error:null};});const query={retry:()=>query,abortSignal:()=>query,then:pending.then.bind(pending)};return query;});
 expect(await refreshInstagramToken(db,owner,account,{now,env:{},fetcher:async()=>Response.json(body),signal:caller.signal})).toMatchObject({status:'uncertain',code:'refresh-store-failed'});
 expect(rpc).toHaveBeenCalledTimes(2);
});
