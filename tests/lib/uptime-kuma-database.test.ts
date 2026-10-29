import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
import {recordUptimeKumaEvent} from '@/lib/uptime-kuma';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const instant='2026-10-27T12:00:00Z';
let db:PGlite,service:SupabaseClient,privateOwner:SupabaseClient;
const event=(id:number,down=true,time='2026-10-27T11:00:00.000Z',name='Synthetic monitor')=>({monitorId:id,monitor:name,observedAt:time,down});
const write=(value:ReturnType<typeof event>,actor=owner)=>recordUptimeKumaEvent(service,actor,value,new AbortController().signal);
const counts=async(id:number)=>({notifications:(await db.query<{kind:string;dismissed_at:Date|null}>('select kind,dismissed_at from notifications where user_id=$1 and source_id=$2 order by kind',[owner,`uptime-kuma:${id}`])).rows,logs:(await db.query('select status,detail from cron_runs where user_id=$1 and name=$2',[owner,`Synthetic ${id}`])).rows});
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant});await db.query('insert into auth.users(id) values($1)',[other]);
 const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));
 const client=(token:string)=>createClient('https://example.supabase.co',token,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});
 service=client('TEST-ONLY-service');privateOwner=client('TEST-ONLY-owner');
},60_000);
afterAll(async()=>{await db?.close();});
it('records one initial down transaction and suppresses exact/newer repeated downs',async()=>{
 const first=await write(event(101,true,undefined,'Synthetic 101'));expect(first.outcome).toBe('recorded');
 expect((await write(event(101,true,undefined,'Synthetic 101'))).outcome).toBe('unchanged');
 expect((await write(event(101,true,'2026-10-27T11:01:00.000Z','Synthetic 101'))).outcome).toBe('unchanged');
 const saved=await counts(101);expect(saved.notifications).toHaveLength(1);expect(saved.logs).toEqual([{status:'failure',detail:'Its monitor received no heartbeat in time.'}]);
 expect((await db.query('select observed_at from dashboard_private.uptime_kuma_monitors where monitor_id=101')).rows[0]).toMatchObject({observed_at:new Date('2026-10-27T11:01:00.000Z')});
});
it('orders stale and equal-time conflicting facts without reopening a recovered alert',async()=>{
 await write(event(102,true));await write(event(102,false,'2026-10-27T11:02:00.000Z'));
 for(const time of ['2026-10-27T11:01:00.000Z','2026-10-27T11:02:00.000Z']){const result=await write(event(102,true,time));expect(result).toMatchObject({status:1,outcome:'stale'});}
 const rows=(await counts(102)).notifications;expect(rows).toHaveLength(2);expect(rows.find(row=>row.kind==='cron_heartbeat_down')?.dismissed_at).not.toBeNull();
});
it('resolves all matching stable-id alerts after rename without touching namesakes or legacy alerts',async()=>{
 await write(event(103,true,undefined,'Synthetic namesake'));await write(event(104,true,undefined,'Synthetic namesake'));
 await db.query("insert into notifications(user_id,kind,source_type,source_id,title) values($1,'cron_heartbeat_down','cron','uptime-kuma:103','Synthetic old duplicate'),($1,'cron_heartbeat_down','cron','Synthetic namesake','Synthetic legacy identity')",[owner]);
 expect((await write(event(103,false,'2026-10-27T11:03:00.000Z','Synthetic renamed'))).outcome).toBe('recorded');
 expect((await db.query("select source_id from notifications where kind='cron_heartbeat_down' and dismissed_at is null and source_id in('uptime-kuma:103','uptime-kuma:104','Synthetic namesake') order by source_id")).rows).toEqual([{source_id:'Synthetic namesake'},{source_id:'uptime-kuma:104'}]);
 const rows=(await counts(103)).notifications;expect(rows.filter(row=>row.kind==='cron_heartbeat_down')).toHaveLength(2);expect(rows.filter(row=>row.kind==='cron_heartbeat_up')).toHaveLength(1);
});
it('tracks initial recovery without inventing a down/recovery announcement',async()=>{
 expect((await write(event(105,false))).outcome).toBe('unchanged');expect((await counts(105)).notifications).toEqual([]);
});
it('does not announce a recovery after the owner already dismissed the alert',async()=>{
 await write(event(106,true));await db.query("update notifications set dismissed_at=now() where source_id='uptime-kuma:106'");
 expect((await write(event(106,false,'2026-10-27T11:01:00.000Z'))).outcome).toBe('unchanged');expect((await counts(106)).notifications).toHaveLength(1);
});
it('rolls back the initial state and notification when cron-log insertion fails',async()=>{
 await db.exec("create function public.reject_synthetic_kuma_log() returns trigger language plpgsql as $$begin if new.name='Synthetic rollback' then raise exception 'Synthetic log unavailable'; end if;return new;end $$;create trigger reject_synthetic_kuma_log before insert on cron_runs for each row execute function public.reject_synthetic_kuma_log();");
 try{await expect(write(event(107,true,undefined,'Synthetic rollback'))).rejects.toThrow('Heartbeat recording unconfirmed');expect((await counts(107)).notifications).toEqual([]);expect((await db.query('select monitor_id from dashboard_private.uptime_kuma_monitors where monitor_id=107')).rows).toEqual([]);}
 finally{await db.exec('drop trigger reject_synthetic_kuma_log on cron_runs;drop function public.reject_synthetic_kuma_log();');}
 expect((await write(event(107,true,undefined,'Synthetic rollback'))).outcome).toBe('recorded');
});
it('rolls back recovery dismissal and state when its notification cannot be inserted',async()=>{
 await write(event(108,true));
 await db.exec("create function public.reject_synthetic_kuma_recovery() returns trigger language plpgsql as $$begin if new.source_id='uptime-kuma:108' and new.kind='cron_heartbeat_up' then raise exception 'Synthetic recovery unavailable'; end if;return new;end $$;create trigger reject_synthetic_kuma_recovery before insert on notifications for each row execute function public.reject_synthetic_kuma_recovery();");
 try{await expect(write(event(108,false,'2026-10-27T11:01:00.000Z'))).rejects.toThrow('Heartbeat recording unconfirmed');expect((await counts(108)).notifications).toEqual([{kind:'cron_heartbeat_down',dismissed_at:null}]);expect((await db.query('select status from dashboard_private.uptime_kuma_monitors where monitor_id=108')).rows).toEqual([{status:0}]);}
 finally{await db.exec('drop trigger reject_synthetic_kuma_recovery on notifications;drop function public.reject_synthetic_kuma_recovery();');}
});
it('keeps owner identities independent and enforces existing notification RLS',async()=>{
 await write(event(109,true),other);expect((await privateOwner.from('notifications').select('id').eq('source_id','uptime-kuma:109')).data).toEqual([]);
 expect((await write(event(109,true))).outcome).toBe('recorded');expect((await privateOwner.from('notifications').select('id').eq('source_id','uptime-kuma:109')).data).toHaveLength(1);
});
it('denies public/authenticated execution and private state access',async()=>{
 const args={p_owner:owner,p_monitor_id:110,p_name:'Synthetic private',p_observed_at:instant,p_status:0};
 expect((await privateOwner.rpc('record_uptime_kuma_event',args)).error).not.toBeNull();
 expect((await db.query("select has_function_privilege('anon','public.record_uptime_kuma_event(uuid,bigint,text,timestamptz,integer)','EXECUTE') anon,has_function_privilege('authenticated','public.record_uptime_kuma_event(uuid,bigint,text,timestamptz,integer)','EXECUTE') authenticated,has_table_privilege('authenticated','dashboard_private.uptime_kuma_monitors','SELECT') readable")).rows).toEqual([{anon:false,authenticated:false,readable:false}]);
});
it.each([{p_monitor_id:0},{p_monitor_id:9007199254740992},{p_status:2},{p_name:' '},{p_name:'Synthetic\nmonitor'},{p_observed_at:'infinity'},{p_observed_at:'2026-10-27T12:05:00.001Z'}])('refuses invalid service arguments %j',async invalid=>{
 const reply=await service.rpc('record_uptime_kuma_event',{p_owner:owner,p_monitor_id:111,p_name:'Synthetic',p_observed_at:instant,p_status:0,...invalid});expect(reply.error).not.toBeNull();expect((await db.query('select monitor_id from dashboard_private.uptime_kuma_monitors where monitor_id=111')).rows).toEqual([]);
});

it('preserves historical name-keyed evidence across upgrade and transaction rollback',async()=>{
 const migration='20261027022446_atomic_uptime_kuma_transitions.sql',upgrade=await createMigratedDatabase({owner,instant,beforeMigration:migration});
 try{
  await upgrade.query("insert into notifications(user_id,kind,source_type,source_id,title,body) values($1,'cron_heartbeat_down','cron','Synthetic legacy monitor','Synthetic historical alert','Synthetic historical detail')",[owner]);
  await upgrade.query("insert into cron_runs(user_id,name,status,source,detail) values($1,'Synthetic legacy monitor','failure','external','Synthetic historical log')",[owner]);
  const snapshot=async()=>JSON.stringify({notifications:(await upgrade.query('select * from notifications order by id')).rows,logs:(await upgrade.query('select * from cron_runs order by id')).rows});
  const before=await snapshot(),sql=readFileSync(`supabase/migrations/${migration}`,'utf8');await upgrade.exec('begin;'+sql);expect(await snapshot()).toBe(before);expect((await upgrade.query('select * from dashboard_private.uptime_kuma_monitors')).rows).toEqual([]);await upgrade.exec('rollback;');expect((await upgrade.query("select to_regclass('dashboard_private.uptime_kuma_monitors') present")).rows).toEqual([{present:null}]);expect(await snapshot()).toBe(before);await upgrade.exec(sql);expect(await snapshot()).toBe(before);
 }finally{await upgrade.close();}
},60_000);
