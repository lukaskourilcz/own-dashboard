import {readFileSync} from 'node:fs';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
import {loadDneskaiNicheSounds} from '@/lib/marketing/dneskai-audio-niche';
import {nicheOwner as owner,nicheNow as now,nicheSourceIds,nicheSourceId,nicheCandidate} from '../helpers/dneskai-niche-fixtures';
vi.mock('server-only',()=>({}));
const other='99999999-9999-4999-8999-999999999999',migration='20261027030141_complete_dneskai_niche_audio_read.sql';
let db:PGlite,service:SupabaseClient,privateOwner:SupabaseClient;
const flags={DNESKAI_SOURCES_TABLE_ENABLED:'false'};
const args=(project:string)=>({p_owner:owner,p_project:project,p_source_ids:nicheSourceIds,p_since:'2026-10-20T12:00:00Z',p_until:now.toISOString()});
async function seed(count=1,actor=owner,connection:PGlite=db){
 const project=crypto.randomUUID();await connection.query('insert into projects(id,user_id,name,slug) values($1,$2,$3,$4)',[project,actor,'Synthetic niche project',`synthetic-${project}`]);
 const run=(await connection.query<{id:string}>("insert into marketing_dneskai_runs(user_id,project_id,date,target_date,status) values($1,$2,'2026-10-27','2026-10-28','complete') returning id",[actor,project])).rows[0].id;
 const items=Array.from({length:count},(_,index)=>nicheCandidate(index));
 if(count)await add(project,run,actor,items,undefined,connection);
 return{project,run};
}
async function add(project:string,run:string,actor:string,items:unknown[],created='2026-10-27T11:00:00Z',connection:PGlite=db){
 await connection.query(`insert into marketing_dneskai_candidates(id,user_id,project_id,run_id,candidate,canonical_url_hash,normalized_text_hash,content_hash,status,created_at)
  select value->>'id',$1,$2,$3,value,md5('url:'||(value->>'id')),md5('text:'||(value->>'id')),value->>'contentHash','new',$5 from jsonb_array_elements($4::jsonb)`,[actor,project,run,JSON.stringify(items),created]);
}
beforeAll(async()=>{
 db=await createMigratedDatabase({owner,instant:now});await db.query('insert into auth.users(id) values($1)',[other]);
 const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>now);
 const client=(token:string)=>createClient('https://example.supabase.co',token,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});
 service=client('TEST-ONLY-service');privateOwner=client('TEST-ONLY-owner');
},60_000);
afterAll(async()=>{await db?.close();});
it('ranks every record beyond the old 500/REST prefixes without downloading full articles',async()=>{
 const f=await seed(1201);await db.query("update marketing_dneskai_candidates set candidate=jsonb_set(candidate,'{text}',to_jsonb(repeat('Synthetic private article ',400))) where project_id=$1",[f.project]);
 expect((await loadDneskaiNicheSounds(service,owner,f.project,now,flags))[0]).toMatchObject({reels:1201,plays:120100});
 const reply=await service.rpc('read_dneskai_niche_audio',args(f.project));expect(reply.error).toBeNull();expect(reply.data.rows).toHaveLength(1201);expect(Object.keys(reply.data.rows[0]).sort()).toEqual(['createdAt','externalId','id','instagram','sourceId']);expect(JSON.stringify(reply.data)).not.toContain('Synthetic private article');
 const full=(await db.query<{bytes:number}>('select octet_length(jsonb_agg(candidate)::text)::int bytes from marketing_dneskai_candidates where project_id=$1',[f.project])).rows[0].bytes;expect(Buffer.byteLength(JSON.stringify(reply.data))).toBeLessThan(full/10);
});
it('captures inclusive seven-day boundaries, excludes future instants and unrelated sources',async()=>{
 const f=await seed(0);await add(f.project,f.run,owner,[nicheCandidate(1)],'2026-10-20T12:00:00Z');await add(f.project,f.run,owner,[nicheCandidate(2)],now.toISOString());await add(f.project,f.run,owner,[nicheCandidate(3)],'2026-10-20T11:59:59.999999Z');await add(f.project,f.run,owner,[nicheCandidate(4)],'2026-10-27T12:00:00.000001Z');await add(f.project,f.run,owner,[{...nicheCandidate(5),sourceId:'synthetic-untracked'}]);
 expect((await loadDneskaiNicheSounds(service,owner,f.project,now,flags))[0].reels).toBe(2);
});
it('preserves distinct-reel policy and original/muted exclusions',async()=>{
 const f=await seed(0),items=[nicheCandidate(1),{...nicheCandidate(2),externalId:'reel-1'},nicheCandidate(3),nicheCandidate(4)];items[2].instagram.music.originalAudio=true;items[3].instagram.music.muted=true;await add(f.project,f.run,owner,items);
 expect((await loadDneskaiNicheSounds(service,owner,f.project,now,flags))[0]).toMatchObject({reels:1,plays:100});
});
it('excludes future top-level/nested data while preserving unknown optional labels',async()=>{
 const f=await seed(0),candidate=nicheCandidate(0);const music={audioId:candidate.instagram.music.audioId,originalAudio:false,muted:false};await add(f.project,f.run,owner,[{...candidate,future_private:'Synthetic excluded top-level',instagram:{...candidate.instagram,future_private:'Synthetic excluded Instagram',music:{...music,future_private:'Synthetic excluded music'}}}]);
 const result=await loadDneskaiNicheSounds(service,owner,f.project,now,flags);expect(result[0]).toMatchObject({title:null,artist:null,reels:1});const receipt=await service.rpc('read_dneskai_niche_audio',args(f.project));expect(JSON.stringify(receipt.data)).not.toContain('future_private');
});
it.each([{plays:-1},{plays:'100'},{music:{audioId:'123',title:'Synthetic incomplete',artist:null,originalAudio:false}},{music:null}])('refuses malformed ranking facts rather than silently dropping them: %j',async instagram=>{
 const f=await seed(0),candidate=nicheCandidate(0);await add(f.project,f.run,owner,[{...candidate,instagram:{...candidate.instagram,...instagram}}]);await expect(loadDneskaiNicheSounds(service,owner,f.project,now,flags)).rejects.toThrow('audio-niche-unavailable');
});
it('accepts the complete 10,000-record bound and refuses a 10,001st matching record',async()=>{
 const f=await seed(10000);expect((await loadDneskaiNicheSounds(service,owner,f.project,now,flags))[0].reels).toBe(10000);await add(f.project,f.run,owner,[nicheCandidate(10000)]);await expect(loadDneskaiNicheSounds(service,owner,f.project,now,flags)).rejects.toThrow('audio-niche-unavailable');const reply=await service.rpc('read_dneskai_niche_audio',args(f.project));expect(reply.error?.code).toBe('54000');
},60_000);
it('bounds legacy oversized metadata before returning it through the API',async()=>{
 const f=await seed();await db.query("update marketing_dneskai_candidates set candidate=jsonb_set(candidate,'{instagram,music,title}',to_jsonb(repeat('x',10485761))) where project_id=$1",[f.project]);expect((await service.rpc('read_dneskai_niche_audio',args(f.project))).error?.code).toBe('54000');
});
it('denies foreign/missing projects and public/authenticated execution',async()=>{
 const f=await seed(1,other);
 expect((await service.rpc('read_dneskai_niche_audio',args(f.project))).error?.code).toBe('42501');
 const missing=await service.rpc('read_dneskai_niche_audio',args(crypto.randomUUID()));
 expect(missing.error?.code).toBe('42501');
 expect((await privateOwner.rpc('read_dneskai_niche_audio',args(f.project))).error).not.toBeNull();
 expect((await privateOwner.from('marketing_dneskai_candidates').select('id').eq('project_id',f.project)).data).toEqual([]);
 expect((await db.query("select has_function_privilege('anon','public.read_dneskai_niche_audio(uuid,uuid,text[],timestamptz,timestamptz)','EXECUTE') allowed")).rows).toEqual([{allowed:false}]);
});
it.each([{p_source_ids:[nicheSourceId,nicheSourceId]},{p_source_ids:[null]},{p_source_ids:Array.from({length:121},(_,index)=>`source-${index}`)},{p_since:'infinity'},{p_since:'2026-10-19T12:00:00Z'},{p_until:'2026-10-27T12:06:00Z'}])('refuses malformed service bounds %j',async patch=>{const f=await seed();expect((await service.rpc('read_dneskai_niche_audio',{...args(f.project),...patch})).error?.code).toBe('22023');});
it('preserves candidates and restores its schema on transactional upgrade rollback',async()=>{
 const upgrade=await createMigratedDatabase({owner,instant:now,beforeMigration:migration});
 try{await seed(1,owner,upgrade);const before=JSON.stringify((await upgrade.query('select * from marketing_dneskai_candidates order by id')).rows);await upgrade.exec('begin;'+readFileSync(`supabase/migrations/${migration}`,'utf8'));expect(JSON.stringify((await upgrade.query('select * from marketing_dneskai_candidates order by id')).rows)).toBe(before);await upgrade.exec('rollback;');expect((await upgrade.query("select to_regprocedure('public.read_dneskai_niche_audio(uuid,uuid,text[],timestamptz,timestamptz)') present")).rows).toEqual([{present:null}]);}finally{await upgrade.close();}
},60_000);

it('distinguishes an SQL-null array member from the literal source name null through the actual SDK',async()=>{
 const f=await seed();expect((await service.rpc('read_dneskai_niche_audio',{...args(f.project),p_source_ids:[null]})).error?.code).toBe('22023');
 const valid=await service.rpc('read_dneskai_niche_audio',{...args(f.project),p_source_ids:['null']});expect(valid.error).toBeNull();expect(valid.data.sourceIds).toEqual(['null']);expect(valid.data.rows).toEqual([]);
});

it('returns blank stored labels as unknown without rewriting the candidate',async()=>{const f=await seed(0),candidate=nicheCandidate(0);candidate.instagram.music.title='  ';candidate.instagram.music.artist=' ';await add(f.project,f.run,owner,[candidate]);expect((await loadDneskaiNicheSounds(service,owner,f.project,now,flags))[0]).toMatchObject({title:null,artist:null});expect((await db.query<{title:string}>("select candidate#>>'{instagram,music,title}' title from marketing_dneskai_candidates where project_id=$1",[f.project])).rows).toEqual([{title:'  '}]);});
