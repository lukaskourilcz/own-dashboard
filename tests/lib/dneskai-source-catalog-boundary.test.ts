import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/marketing/dneskai/source-list/route';
import { readDneskaiSourceRows, dneskaiTableCatalog } from '@/lib/marketing/dneskai-source-catalog';
import { dneskaiSourceSeedRows } from '@/lib/marketing/dneskai-source-list';
import { tickDneskaiCollection } from '@/lib/marketing/dneskai-collection';
import type { DneskaiCollectionStore } from '@/lib/marketing/dneskai-store';

const mocks=vi.hoisted(()=>({read:vi.fn(),rpc:vi.fn(),project:vi.fn(),filters:[] as unknown[][]}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/marketing/dneskai-store',()=>({requireDneskaiProject:mocks.project}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}}})},rpc:mocks.rpc,
 from:(table:string)=>{const b:Record<string,unknown>={};for(const method of ['select','eq','in','order','retry','abortSignal'])b[method]=(...args:unknown[])=>{mocks.filters.push([table,method,...args]);return b;};b.limit=(limit:number)=>{mocks.filters.push([table,'limit',limit]);return mocks.read(table).then((result:{data:unknown[]|null;error:unknown;count?:number|null})=>({...result,count:result.count===undefined?(result.data?.length??null):result.count}));};return b;}})}));
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
const url=`https://fixture.invalid/api/marketing/dneskai/source-list?projectId=${project}`;
const row=dneskaiSourceSeedRows()[0]!;
const stored=()=>({source_id:row.sourceId,kind:row.kind,topic:row.topic,handle_or_url:row.handleOrUrl,name:row.name,tier:row.tier,weekdays:row.weekdays,max_items:row.maxItems,enabled:row.enabled});
beforeEach(()=>{vi.clearAllMocks();mocks.filters.length=0;vi.stubEnv('DNESKAI_SOURCES_TABLE_ENABLED','true');mocks.read.mockResolvedValue({data:[],error:null});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it('keeps an empty editable list empty without seeding or even reading unused history',async()=>{
 const response=await GET(new Request(url));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({editable:true,items:[],notice:null});
 expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.read).toHaveBeenCalledTimes(1);expect(mocks.read).toHaveBeenCalledWith('marketing_dneskai_sources');
});
it('reads history only for visible source identities and keeps owner/project filters',async()=>{
 mocks.read.mockImplementation(async(table:string)=>({data:table==='marketing_dneskai_sources'?[stored()]:[{source_id:row.sourceId,last_success_at:'2026-10-24T18:00:00Z',item_count:4,status:'ok'}],error:null}));
 const response=await GET(new Request(url));expect(response.status).toBe(200);expect((await response.json()).items[0]).toMatchObject({row,lastItems:4,lastReadAt:'2026-10-24T18:00:00Z'});
 expect(mocks.filters).toContainEqual(['marketing_dneskai_source_states','in','source_id',[row.sourceId]]);expect(mocks.filters).toContainEqual(['marketing_dneskai_source_states','limit',2]);
 for(const table of ['marketing_dneskai_sources','marketing_dneskai_source_states'])for(const [field,value]of[['user_id',owner],['project_id',project]])expect(mocks.filters).toContainEqual([table,'eq',field,value]);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('does not turn a failed source read into the registry or seed it',async()=>{
 mocks.read.mockResolvedValue({data:null,error:{message:'synthetic private upstream error'}});
 const response=await GET(new Request(url));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'sources-unavailable'});expect(mocks.rpc).not.toHaveBeenCalled();
});
it('refuses a server-capped catalog instead of claiming the returned prefix is complete',async()=>{
 mocks.read.mockResolvedValue({data:[stored()],error:null,count:2});
 const response=await GET(new Request(url));expect(response.status).toBe(503);expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each(['error','bad-date','foreign-source'])('does not report a misleading never-read state when history is %s',async(kind)=>{
 mocks.read.mockImplementation(async(table:string)=>table==='marketing_dneskai_sources'?{data:[stored()],error:null}:kind==='error'?{data:null,error:{message:'private'}}:{data:[{source_id:kind==='foreign-source'?'unknown':row.sourceId,last_success_at:'impossible',item_count:1,status:'ok'}],error:null});
 const response=await GET(new Request(url));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'sources-unavailable'});
});
function database(data:unknown,error:unknown=null) {
 const query:Record<string,unknown>={};for(const method of ['select','eq','order','retry','abortSignal'])query[method]=()=>query;query.limit=async()=>({data,error,count:Array.isArray(data)?data.length:null});return {from:()=>query};
}
it.each([null,[null],[{...stored(),max_items:21}],[stored(),stored()],Array.from({length:121},()=>stored())])('refuses incomplete, malformed, duplicate or overflowing catalogs (%#)',async(data)=>{
 await expect(readDneskaiSourceRows(database(data),owner,project)).rejects.toThrow('sources-unavailable');
});
it('expires a stalled catalog read instead of falling back to enabled sources',async()=>{
 const deadline=new AbortController();vi.spyOn(AbortSignal,'timeout').mockImplementation(()=>deadline.signal);
 const db=database([]);const b=db.from() as Record<string,unknown>;b.limit=()=>new Promise(()=>{});db.from=()=>b;
 const failed=expect(readDneskaiSourceRows(db,owner,project)).rejects.toMatchObject({name:'AbortError'});deadline.abort('synthetic private reason');await failed;
});
it.each(['empty','unavailable'])('refuses %s settings before any collection admission or provider work',async(kind)=>{
 const admit=vi.fn(),claim=vi.fn(),provider=vi.fn();
 const store={catalog:async()=>{if(kind==='unavailable')throw Error('sources-unavailable');return dneskaiTableCatalog([]);},admit,claim} as unknown as DneskaiCollectionStore;
 await expect(tickDneskaiCollection(owner,{projectId:project},{store,env:{MARKETING_DNESKAI_COLLECTION_ENABLED:'true'},now:()=>new Date('2026-10-26T21:00:30Z'),feed:provider,startInstagram:provider,jev:provider})).rejects.toThrow(kind==='empty'?'collection-no-enabled-sources':'sources-unavailable');
 expect(admit).not.toHaveBeenCalled();expect(claim).not.toHaveBeenCalled();expect(provider).not.toHaveBeenCalled();
});
