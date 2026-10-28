import { afterEach, expect, it, vi } from 'vitest';
import { listMetaTokenMetadata } from '@/lib/marketing/meta-credentials';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const row={account_id:id,brand:'dneskai',platform:'instagram',expires_at:'2026-11-01T10:00:00Z',refreshed_at:'2026-09-01T10:00:00Z',scopes:['instagram_business_basic'],login_mode:'instagram'};
function database(rows:unknown[],transform:(value:Record<string,unknown>)=>unknown=value=>value){
 const rpc=vi.fn((name:string)=>{const pending=Promise.resolve({data:name==='marketing_account_token_metadata'?rows:transform({ownerId:owner,count:rows.length,tokens:rows}),error:null});const query={retry:()=>query,abortSignal:()=>query,then:pending.then.bind(pending)};return query;});return {db:{rpc} as never,rpc};
}
afterEach(()=>vi.restoreAllMocks());
it('does not begin a metadata read after the original scheduler lifetime retires',async()=>{
 const caller=new AbortController();caller.abort();const {db,rpc}=database([row]);await expect(listMetaTokenMetadata(db,owner,caller.signal)).rejects.toMatchObject({code:'credential-store-unavailable'});expect(rpc).not.toHaveBeenCalled();
});
it.each([{rows:[row,row]},{rows:[row,{...row,account_id:'33333333-3333-4333-8333-333333333333'}]},{rows:[{...row,platform:'threads'}]}])('refuses duplicate or mode/tuple-inconsistent metadata: %#',async({rows})=>{
 const {db}=database(rows);await expect(listMetaTokenMetadata(db,owner)).rejects.toMatchObject({code:'credential-store-unavailable'});
});
it('does not release a late metadata response into a retired scheduler',async()=>{
 let release!:(value:unknown)=>void;const waiting=new Promise(resolve=>{release=resolve;}),rpc=vi.fn(()=>{const query={retry:()=>query,abortSignal:()=>query,then:waiting.then.bind(waiting)};return query;}),caller=new AbortController();
 const pending=listMetaTokenMetadata({rpc} as never,owner,caller.signal).catch(error=>error);caller.abort();release({data:[row],error:null});expect(await pending).toMatchObject({code:'credential-store-unavailable'});
});

it.each([{ownerId:'33333333-3333-4333-8333-333333333333'},{count:0},{count:2},{count:null},{tokens:null},{unexpected:'TEST_ONLY_FORBIDDEN_FIELD'}])('refuses a foreign, partial or extended complete receipt: %#',async patch=>{
 const {db}=database([row],value=>({...value,...patch}));await expect(listMetaTokenMetadata(db,owner)).rejects.toMatchObject({code:'credential-store-unavailable'});
});
it('normalizes UUID spelling before duplicate identity and scheduler comparisons',async()=>{
 const key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',{db}=database([{...row,account_id:key.toUpperCase()}]);expect((await listMetaTokenMetadata(db,owner))[0].accountId).toBe(key);
 const duplicate=database([{...row,brand:'devshark',account_id:key.toUpperCase()},{...row,account_id:key}]);await expect(listMetaTokenMetadata(duplicate.db,owner)).rejects.toMatchObject({code:'credential-store-unavailable'});
});
it('bounds an uncooperative metadata read under its original fifteen-second allowance',async()=>{
 const timeout=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(timeout.signal);
 const waiting=new Promise(()=>{}),rpc=vi.fn(()=>{const query={retry:()=>query,abortSignal:()=>query,then:waiting.then.bind(waiting)};return query;}),pending=listMetaTokenMetadata({rpc} as never,owner).catch(error=>error);
 await vi.waitFor(()=>expect(rpc).toHaveBeenCalledOnce());timeout.abort();expect(await pending).toMatchObject({code:'credential-store-unavailable'});expect(AbortSignal.timeout).toHaveBeenCalledWith(15000);
});
it('accepts an exact empty receipt without inventing an unavailable credential',async()=>{expect(await listMetaTokenMetadata(database([]).db,owner)).toEqual([]);});

it('contains thrown private read failures without preserving their diagnostic',async()=>{
 const rpc=vi.fn(()=>{throw Error('TEST_ONLY_PRIVATE_METADATA_DETAIL');});await expect(listMetaTokenMetadata({rpc} as never,owner)).rejects.toMatchObject({code:'credential-store-unavailable',message:'credential-store-unavailable'});expect(rpc).toHaveBeenCalledOnce();
});
