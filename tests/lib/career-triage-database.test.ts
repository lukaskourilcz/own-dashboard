import {createClient} from '@supabase/supabase-js';
import {expect,it} from 'vitest';
import {createMigratedDatabase} from '../helpers/supabase-pglite';
import {SupabaseEmulator} from '../helpers/supabase-emulator';
it('does not remove a permanent deletion marker when an older window clears its previous shortlist',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',instant='2026-10-26T12:00:00Z',db=await createMigratedDatabase({owner,instant});
 try{
  const emulator=new SupabaseEmulator(db,'https://example.supabase.co',{service:'TEST-ONLY-service',users:{[owner]:'TEST-ONLY-owner'}},()=>new Date(instant));
  const client=createClient('https://example.supabase.co','TEST-ONLY-owner',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>emulator.fetch(input,init)}});
  const listing=(await db.query<{id:string,last_seen_at:string}>("insert into job_listings(source,external_id,title,url,role) values('remotive','synthetic-stale-triage','Synthetic React role','https://remotive.com/remote-jobs/synthetic-stale-triage','frontend') returning id,to_jsonb(last_seen_at)#>>'{}' last_seen_at")).rows[0];
  const old=await client.from('job_user_state').insert({user_id:owner,listing_id:listing.id,state:'shortlisted'}).select().single();expect(old.error).toBeNull();
  await client.from('job_user_state').upsert({user_id:owner,listing_id:listing.id,state:'deleted'},{onConflict:'user_id,listing_id'});
  const stale=await client.rpc('apply_career_triage',{p_expected_owner:owner,p_changes:[{id:crypto.randomUUID(),listingId:listing.id,url:'https://remotive.com/remote-jobs/synthetic-stale-triage',lastSeenAt:listing.last_seen_at,next:null,expected:{id:old.data.id,state:old.data.state,createdAt:old.data.created_at,updatedAt:old.data.updated_at}}]});expect(stale.error).not.toBeNull();
  const legacy=await client.from('job_user_state').delete().eq('id',old.data.id);expect(legacy.error).not.toBeNull();
  const overwrite=await client.from('job_user_state').upsert({user_id:owner,listing_id:listing.id,state:'shortlisted'},{onConflict:'user_id,listing_id'});expect(overwrite.error).not.toBeNull();
  expect((await db.query('select state from job_user_state where listing_id=$1',[listing.id])).rows).toEqual([{state:'deleted'}]);
 }finally{await db.close();}
},60_000);

it('retains an intentional owner deletion cascade but refuses a raw listing cascade over its marker',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',db=await createMigratedDatabase({owner,instant:'2026-10-26T12:00:00Z'});
 try{
  await db.query('insert into auth.users(id) values($1)',[other]);
  const listing=(await db.query<{id:string}>("insert into job_listings(source,external_id,title,url,role) values('remotive','synthetic-owner-cascade','Synthetic React role','https://remotive.com/remote-jobs/synthetic-owner-cascade','frontend') returning id")).rows[0];
  await db.query("insert into job_user_state(user_id,listing_id,state) values($1,$2,'deleted')",[other,listing.id]);
  await expect(db.query('delete from job_listings where id=$1',[listing.id])).rejects.toThrow('Career triage changed');
  await db.query('delete from auth.users where id=$1',[other]);
  expect((await db.query('select id from job_user_state where user_id=$1',[other])).rows).toHaveLength(0);
  expect((await db.query('select id from job_listings where id=$1',[listing.id])).rows).toHaveLength(1);
 }finally{await db.close();}
},60_000);
