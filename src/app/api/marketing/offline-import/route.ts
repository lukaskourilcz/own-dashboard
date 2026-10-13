import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { assertMarketingOfflineImportConfiguration, importMarketingOfflineDraft } from '@/lib/marketing/offline-import';
import { OFFLINE_IMPORT_MAX_BODY, MarketingOfflineImportError } from '@/lib/marketing/offline-import-validation';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
  const csrf=rejectCrossOrigin(request);if(csrf)return csrf;
  const db=await createClient(),{data:{user}}=await db.auth.getUser();
  if(!user)return NextResponse.json({error:'unauthorized'},{status:401});
  try{assertMarketingOfflineImportConfiguration(user.id);}catch{return NextResponse.json({error:'offline-import-disabled'},{status:403});}
  try{
    const length=request.headers.get('content-length');
    if(length&&(!/^\d+$/.test(length)||Number(length)>OFFLINE_IMPORT_MAX_BODY))throw new MarketingOfflineImportError('offline-import-too-large');
    if(!request.headers.get('content-type')?.startsWith('application/json')||!request.body)throw new MarketingOfflineImportError('offline-import-invalid');
    const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>OFFLINE_IMPORT_MAX_BODY){await reader.cancel();throw new MarketingOfflineImportError('offline-import-too-large');}chunks.push(value);}}finally{reader.releaseLock();}
    let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new MarketingOfflineImportError('offline-import-invalid');}
    const result=await importMarketingOfflineDraft(createAdminClient(),user.id,value,{signal:AbortSignal.any([request.signal,AbortSignal.timeout(45000)])});
    return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    const code=error instanceof MarketingOfflineImportError?error.code:'offline-import-save-failed';
    const status=code==='offline-import-too-large'?413:code==='offline-import-invalid'||code==='offline-import-path-invalid'||code==='offline-import-file-mismatch'?400:409;
    return NextResponse.json({error:code},{status,headers:{'Cache-Control':'private, no-store'}});
  }
}
