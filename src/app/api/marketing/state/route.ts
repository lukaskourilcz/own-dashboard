import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
export async function GET() {
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user) return NextResponse.json({error:'unauthorized'},{status:401});
 const result=await Promise.all([
  db.from('marketing_revisions').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100),
  db.from('marketing_campaigns').select('id,brand,name,starts_on,ends_on,source_hash,status').eq('user_id',user.id).neq('status','archived').limit(10),
  db.from('marketing_calendar_entries').select('*').eq('user_id',user.id).order('date').limit(1000),
  db.from('marketing_publications').select('*').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100),
  db.from('marketing_accounts').select('*').eq('user_id',user.id).limit(4),
  db.from('marketing_sources').select('id,brand,source_id,source_revision,eligible,observed_at,packet').eq('user_id',user.id).order('observed_at',{ascending:false}).limit(100),
  db.from('marketing_jobs').select('id,status,error_code,result,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(100),
  db.from('marketing_events').select('revision_id,kind,created_at').eq('user_id',user.id).in('kind',['approved','returned','skipped']).order('created_at',{ascending:false}).limit(100),
  db.from('marketing_source_history').select('packet').eq('user_id',user.id).order('recorded_at',{ascending:false}).limit(200),
 ]);
 if(result.some(r=>r.error)) return NextResponse.json({error:'marketing-unavailable'},{status:503});
 const jobs=(result[6].data??[]).map(job=>({id:job.id,status:job.status,errorCode:job.error_code,createdAt:job.created_at,brand:job.result?.revision?.brand??null,costUsd:job.result?.usage?.estimatedCostUsd??null}));
 const first=new Map<string,string>();for(const event of [...(result[7].data??[])].reverse()){if(event.revision_id&&!first.has(event.revision_id))first.set(event.revision_id,event.kind);}
 const reviewed=[...first.values()].filter(kind=>kind!=='skipped');
 const diagnostics={sampleSize:reviewed.length,firstApprovalRate:reviewed.length?reviewed.filter(kind=>kind==='approved').length/reviewed.length:null};
 return NextResponse.json({revisions:result[0].data,campaigns:result[1].data,entries:result[2].data,publications:result[3].data,accounts:result[4].data,sources:result[5].data,sourceHistory:(result[8].data??[]).map(row=>row.packet),jobs,diagnostics},{headers:{'Cache-Control':'private, no-store'}});
}
