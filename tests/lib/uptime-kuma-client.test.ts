import {expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {recordUptimeKumaEvent} from '@/lib/uptime-kuma';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const event=()=>({monitorId:3,monitor:'Synthetic monitor',observedAt:'2026-10-27T11:00:00.000Z',down:true});
const receipt=()=>({ownerId:owner,monitorId:3,observedAt:'2026-10-27T11:00:00+00:00',status:0,outcome:'recorded'});
function harness(data:unknown,error:unknown=null){
 const retry=vi.fn(),abort=vi.fn().mockResolvedValue({data,error});const builder={retry:(value:boolean)=>{retry(value);return builder;},abortSignal:abort};
 const rpc=vi.fn().mockReturnValue(builder);return{client:{rpc} as unknown as SupabaseClient,rpc,retry,abort};
}
it('projects only captured facts, disables retries and confirms the exact stored receipt',async()=>{
 const h=harness(receipt()),signal=new AbortController().signal;
 expect(await recordUptimeKumaEvent(h.client,owner,event(),signal)).toEqual(receipt());expect(h.rpc).toHaveBeenCalledExactlyOnceWith('record_uptime_kuma_event',{p_owner:owner,p_monitor_id:3,p_name:'Synthetic monitor',p_observed_at:'2026-10-27T11:00:00.000Z',p_status:0});expect(h.retry).toHaveBeenCalledExactlyOnceWith(false);expect(h.abort).toHaveBeenCalledExactlyOnceWith(signal);
});
it.each([null,[],{},[{...receipt()}],{...receipt(),ownerId:other},{...receipt(),monitorId:4},{...receipt(),status:1},{...receipt(),observedAt:'2026-10-27T11:01:00Z'},{...receipt(),future_private:'Discarded synthetic field'},{...receipt(),outcome:'success'}])('refuses incomplete/foreign/mismatched receipt %j',async data=>{
 const h=harness(data);await expect(recordUptimeKumaEvent(h.client,owner,event(),new AbortController().signal)).rejects.toThrow('Heartbeat recording unconfirmed');expect(h.rpc).toHaveBeenCalledOnce();
});
it('accepts a current newer state only as an explicitly stale outcome',async()=>{
 const h=harness({...receipt(),status:1,observedAt:'2026-10-27T11:01:00Z',outcome:'stale'});expect((await recordUptimeKumaEvent(h.client,owner,event(),new AbortController().signal)).outcome).toBe('stale');
 const older=harness({...receipt(),observedAt:'2026-10-27T10:59:00Z',outcome:'stale'});await expect(recordUptimeKumaEvent(older.client,owner,event(),new AbortController().signal)).rejects.toThrow();
});
it('does not accept a positive-looking receipt alongside a database error',async()=>{
 const h=harness(receipt(),{code:'503'});await expect(recordUptimeKumaEvent(h.client,owner,event(),new AbortController().signal)).rejects.toThrow();
});
it('ignores a late uncooperative receipt after cancellation without retrying',async()=>{
 const h=harness(null),controller=new AbortController();let finish!:(value:unknown)=>void;h.abort.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const pending=recordUptimeKumaEvent(h.client,owner,event(),controller.signal);controller.abort();await expect(pending).rejects.toThrow();finish({data:receipt(),error:null});await Promise.resolve();expect(h.rpc).toHaveBeenCalledOnce();
});
it('refuses an already-aborted lifetime before reaching the SDK',async()=>{
 const h=harness(receipt()),controller=new AbortController();controller.abort();await expect(recordUptimeKumaEvent(h.client,owner,event(),controller.signal)).rejects.toThrow();expect(h.rpc).not.toHaveBeenCalled();
});

it('captures the original transition before a caller changes its input object',async()=>{
 const h=harness(null),input=event();let finish!:(value:unknown)=>void;h.abort.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));const pending=recordUptimeKumaEvent(h.client,owner,input,new AbortController().signal);input.down=false;input.monitorId=4;input.observedAt='2026-10-27T11:01:00.000Z';finish({data:receipt(),error:null});expect((await pending).status).toBe(0);expect(h.rpc.mock.calls[0][1].p_monitor_id).toBe(3);
});
