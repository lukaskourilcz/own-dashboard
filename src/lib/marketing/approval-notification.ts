import 'server-only';
import { z } from 'zod';
/** Approval is already committed locally. Notification never authorizes the receiver to publish. */
export async function notifyMarketingApproval(publicationId:string,options:{env?:Record<string,string|undefined>;transport?:typeof fetch}={}):Promise<'notified'|'unconfigured'|'pending'>{
 const env=options.env??process.env;const configured=env.MARKETING_N8N_APPROVAL_WEBHOOK_URL;const secret=env.MARKETING_N8N_WEBHOOK_SECRET;
 if(!configured||!secret||secret.length<32)return 'unconfigured';
 try{
  z.uuid().parse(publicationId);const url=new URL(configured);
  if(url.origin!=='https://bambambaklawa.app.n8n.cloud'||!url.pathname.startsWith('/webhook/')||url.username||url.password||url.search||url.hash)return 'pending';
  const response=await (options.transport??fetch)(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(2000),headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({publicationId})});
  return response.ok?'notified':'pending';
 }catch{return 'pending';}
}
