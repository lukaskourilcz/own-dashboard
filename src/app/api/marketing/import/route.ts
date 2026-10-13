import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { readFullMarketingCalendar } from '@/lib/marketing/calendar-source';
import { fetchWithGitHubAuth } from '@/lib/github-token';
import { BrandSchema } from '@/lib/marketing/contracts';
import { planCampaignImport } from '@/lib/marketing/campaign-import';
const Input=z.union([z.strictObject({plan:z.unknown(),startsOn:z.iso.date(),apply:z.boolean()}),z.strictObject({source:z.literal('repository'),brand:BrandSchema,startsOn:z.iso.date(),apply:z.boolean(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/).optional()})]);
export async function POST(request:Request){
 const csrf=rejectCrossOrigin(request);if(csrf)return csrf;
 const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
 try{
  const input=Input.parse(await request.json());
  const {data,error}=await db.from('ai_links').select('id,title').eq('user_id',user.id).eq('record_type','idea').limit(1000);if(error)throw error;
  const plan='plan' in input?input.plan:await readFullMarketingCalendar(fetchWithGitHubAuth,input.brand);
  const prepared=planCampaignImport(plan,input.startsOn,data??[]);
  if('source' in input&&input.apply&&input.expectedHash!==prepared.campaign.source_hash)return NextResponse.json({error:'calendar-source-changed'},{status:409});
  if(!input.apply)return NextResponse.json(prepared);
  const {data:id,error:saveError}=await createAdminClient().rpc('marketing_import_campaign',{p_owner:user.id,p_campaign:prepared.campaign,p_entries:prepared.entries});if(saveError)throw saveError;
  return NextResponse.json({id,report:prepared.report});
 }catch{return NextResponse.json({error:'calendar-import-failed'},{status:400});}
}
