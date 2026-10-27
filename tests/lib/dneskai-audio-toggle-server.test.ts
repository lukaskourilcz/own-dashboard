import {createClient} from '@supabase/supabase-js';
import {afterEach,expect,it,vi} from 'vitest';
import {setDneskaiAudioTrackEnabled} from '@/lib/marketing/dneskai-audio';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',id='33333333-3333-4333-8333-333333333333',version='2026-10-27T10:00:00.000001Z';
const receipt=()=>({kind:'saved',ownerId:owner,id,expectedVersion:version,requestedEnabled:false,updatedAt:'2026-10-27T10:00:00.000002Z'});
const db=(fetcher:typeof fetch)=>createClient('https://toggle-server.supabase.co','TEST-ONLY-service',{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false}});
afterEach(()=>vi.restoreAllMocks());
it.each([{...receipt(),ownerId:id},{...receipt(),id:owner},{...receipt(),expectedVersion:'2026-10-27T10:00:00.000000Z'},{...receipt(),requestedEnabled:true},{...receipt(),updatedAt:version},{...receipt(),extra:true},{kind:'changed',ownerId:owner,id,expectedVersion:version,requestedEnabled:false,updatedAt:version}])('refuses an unconfirmed service response: %#',async value=>{
 const fetcher=vi.fn(async()=>Response.json(value));await expect(setDneskaiAudioTrackEnabled(db(fetcher),owner,id,false,version)).rejects.toHaveProperty('code','audio-track-write-failed');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('bounds a stalled RPC once without exposing its timeout reason',async()=>{
 const controller=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);const fetcher=vi.fn(()=>new Promise<Response>(()=>{}));const result=setDneskaiAudioTrackEnabled(db(fetcher),owner,id,false,version).catch(error=>error);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));controller.abort('TEST_ONLY_PRIVATE_REASON');expect(await result).toMatchObject({code:'audio-track-write-failed',message:'audio-track-write-failed'});expect(fetcher).toHaveBeenCalledTimes(1);
});
it('starts no request for an already retired original scope',async()=>{
 const controller=new AbortController();controller.abort('TEST_ONLY_PRIVATE_REASON');const fetcher=vi.fn();await expect(setDneskaiAudioTrackEnabled(db(fetcher),owner,id,false,version,controller.signal)).rejects.toMatchObject({name:'AbortError',message:'Request aborted'});expect(fetcher).not.toHaveBeenCalled();
});
