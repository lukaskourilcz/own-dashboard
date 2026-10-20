import 'server-only';
import { z } from 'zod';
import sharp from 'sharp';
import type { createAdminClient } from '@/lib/supabase/admin';
import { parseContentRevision, parseSourcePacket } from './contracts';
import { contentHash, revisionHash } from './hashes';
import { pragueScheduledAt } from './clock';
import { refreshSource } from './source-refresh';
import { ingestSource } from './store';
import { createMarketingAssetStorage } from './worker-runtime';
import { currentMarketingTemplate } from './render';
import { marketingPilotConfiguration } from './pilot';
import { previewPilotRetired } from './preview-pilot';
import { assertOfflineSource, assertOfflineSourceBinding, offlineImportSlot, validateMarketingOfflineImport, OFFLINE_IMPORT_HOLD, MarketingOfflineImportError, type MarketingOfflineImportReceipt } from './offline-import-validation';

type Database=ReturnType<typeof createAdminClient>;
type Environment=Record<string,string|undefined>;
function reject(code:ConstructorParameters<typeof MarketingOfflineImportError>[0]):never {throw new MarketingOfflineImportError(code);}
export function assertMarketingOfflineImportConfiguration(ownerId:string,env:Environment=process.env,now=new Date()) {
  if(previewPilotRetired('offline-import',env)||env.MARKETING_OFFLINE_IMPORT_ENABLED!=='true'||!z.uuid().safeParse(ownerId).success||ownerId!==env.MARKETING_OWNER_ID)reject('offline-import-disabled');
  try{const pilot=marketingPilotConfiguration(ownerId,env,now);if(!pilot)reject('offline-import-disabled');return pilot;}catch{reject('offline-import-disabled');}
}
export async function importMarketingOfflineDraft(db:Database,ownerId:string,value:unknown,options:{env?:Environment;now?:Date;clock?:()=>Date;refresh?:typeof refreshSource;storage?:ReturnType<typeof createMarketingAssetStorage>;inspectJpeg?:(bytes:Buffer)=>Promise<{width?:number;height?:number;format?:string;orientation?:number;pages?:number}>;signal?:AbortSignal}={}){
  const env=options.env??process.env,clock=options.clock??(options.now?()=>options.now!:()=>new Date()),now=clock();
  const pilot=assertMarketingOfflineImportConfiguration(ownerId,env,now);
  const prepared=validateMarketingOfflineImport(value,now),{input,source,format}=prepared;
  const {data:entry,error:entryError}=await db.from('marketing_calendar_entries').select('id,user_id,campaign_id,date,local_time,kind,platform,status,generation_version,original,bound_source_id').eq('user_id',ownerId).eq('id',input.entryId).maybeSingle();
  const {data:campaign,error:campaignError}=await db.from('marketing_campaigns').select('id,user_id,brand,status,starts_on,ends_on,time_zone').eq('user_id',ownerId).eq('id',input.campaignId).maybeSingle();
  const original=entry?.original;
  if(entryError||campaignError||!entry||!campaign||entry.campaign_id!==input.campaignId||campaign.brand!=='devshark'||campaign.status==='archived'||campaign.time_zone!=='Europe/Prague'||entry.generation_version!==input.entryVersion||entry.date!==input.date||entry.kind!==format||entry.platform!==(format==='thread'?'threads':'instagram')||!['planned','blocked'].includes(entry.status)||input.date<campaign.starts_on||input.date>campaign.ends_on||original?.slot!==offlineImportSlot(input.role)||original?.sourceId!==source.sourceId||original?.sourceRevision!==source.sourceRevision||original?.contentHash!==source.contentHash)reject('offline-import-entry-unavailable');
  let scheduledAt:string;try{scheduledAt=pragueScheduledAt(entry.date,entry.local_time);}catch{reject('offline-import-entry-unavailable');}
  if(Date.parse(scheduledAt)<=now.getTime())reject('offline-import-entry-unavailable');
  const {data:account,error:accountError}=await db.from('marketing_accounts').select('id,remote_account_id,handle,verified_at').eq('user_id',ownerId).eq('brand','devshark').eq('platform',format==='thread'?'threads':'instagram').maybeSingle();
  if(accountError||!account?.verified_at||!account.remote_account_id||!account.handle)reject('offline-import-account-unavailable');
  if(format!=='story'){
    const current=currentMarketingTemplate('devshark');
    if(prepared.templateVersion!==current.version||prepared.templateSha256!==current.templateSha256)reject('offline-import-invalid');
  }
  // Stable entry reservation identity excludes observation time, signed URLs and caller filenames.
  const idHash=contentHash({ownerId,entryId:input.entryId,entryVersion:input.entryVersion});
  const revisionId=`${idHash.slice(0,8)}-${idHash.slice(8,12)}-4${idHash.slice(13,16)}-8${idHash.slice(17,20)}-${idHash.slice(20,32)}`;
  const {data:existing,error:existingError}=await db.from('marketing_offline_imports').select('revision_id,identity_hash').eq('user_id',ownerId).eq('calendar_entry_id',input.entryId).eq('generation_version',input.entryVersion).maybeSingle();
  if(existingError)reject('offline-import-save-failed');
  if(existing){assertMarketingOfflineImportConfiguration(ownerId,env,clock());if(existing.identity_hash!==prepared.identityHash)reject('offline-import-conflict');return{revisionId:existing.revision_id,duplicate:true,ready:false,status:'review' as const,holdCode:OFFLINE_IMPORT_HOLD,providerCalls:0 as const};}
  const remaining=Date.parse(pilot.expiresAt)-clock().getTime();
  if(remaining<=0)reject('offline-import-disabled');
  const signal=AbortSignal.any([AbortSignal.timeout(Math.min(45000,remaining)),...(options.signal?[options.signal]:[])]);
  function assertLiveScope(){assertMarketingOfflineImportConfiguration(ownerId,env,clock());if(signal.aborted)reject('offline-import-disabled');}
  assertLiveScope();
  const scope=await db.rpc('marketing_check_offline_import_scope',{p_owner:ownerId,p_pilot:pilot});
  if(scope.error||scope.data!==true)reject('offline-import-disabled');
  assertLiveScope();
  let fresh;
  try{fresh=parseSourcePacket(await(options.refresh??refreshSource)(source,signal));}catch{reject('offline-import-source-unavailable');}
  assertLiveScope();assertOfflineSource(fresh,clock());assertOfflineSourceBinding(source,fresh);
  assertLiveScope();
  const sourceRecord=await ingestSource(db,ownerId,fresh,'devshark').catch(()=>reject('offline-import-source-unavailable'));
  if(entry.bound_source_id&&entry.bound_source_id!==sourceRecord.id)reject('offline-import-source-changed');
  // CPU-only JPEG decoding. Never execute supplied SVG; its bytes are retained only as a hash proof.
  for(const descriptor of prepared.descriptors){
    try{
      const metadata=await(options.inspectJpeg??(async bytes=>{const image=sharp(bytes,{limitInputPixels:1080*1920,failOn:'warning'});const metadata=await image.metadata();await image.raw().toBuffer();return metadata;}))(prepared.files.get(descriptor.file)!);
      if(metadata.format!=='jpeg'||metadata.width!==descriptor.width||metadata.height!==descriptor.height||(metadata.orientation!==undefined&&metadata.orientation!==1)||(metadata.pages!==undefined&&metadata.pages!==1))throw new Error();
    }catch{reject('offline-import-file-mismatch');}
  }
  const assets=[];
  try{
    // Draft preview links last seven days. This lease does not change the actual future calendar schedule or grant publication readiness.
    const storage=options.storage??createMarketingAssetStorage(db,ownerId,new Date(clock().getTime()+3600000).toISOString(),{now:clock,signal});
    for(const [index,descriptor]of prepared.descriptors.entries()){
      assertLiveScope();
      const stored=await storage.put({key:`marketing/devshark/${revisionId}/${prepared.templateSha256}/${index+1}-${descriptor.sha256}.jpg`,bytes:prepared.files.get(descriptor.file)!,contentType:'image/jpeg',sha256:descriptor.sha256,metadata:{revisionId,templateSha256:prepared.templateSha256,svgSha256:descriptor.svg.sha256,rendererVersion:format==='story'?'offline-story-svg/1':'offline-bundle/1',importManifestSha256:input.manifestSha256,reviewRequired:'true'}});
      assets.push({url:stored.url,sha256:descriptor.sha256,mimeType:'image/jpeg' as const,width:descriptor.width,height:descriptor.height,alt:descriptor.alt??`${source.content.title} (${input.role})`});
    }
  }catch(error){if(error instanceof MarketingOfflineImportError)throw error;reject('offline-import-storage-unavailable');}
  // Authoritative second read after upload; SQL rechecks the persisted source head atomically as well.
  assertLiveScope();
  try{fresh=parseSourcePacket(await(options.refresh??refreshSource)(source,signal));}catch{reject('offline-import-source-unavailable');}
  assertLiveScope();assertOfflineSource(fresh,clock());assertOfflineSourceBinding(source,fresh);
  assertLiveScope();
  await ingestSource(db,ownerId,fresh,'devshark').catch(()=>reject('offline-import-source-unavailable'));
  const revision=parseContentRevision({schemaVersion:'marketing-content/1',brand:'devshark',title:source.content.title,caption:prepared.caption,format,sources:[{sourceId:source.sourceId,sourceRevision:source.sourceRevision,contentHash:source.contentHash}],knowledgeIds:[],assets,account:{id:account.remote_account_id,platform:format==='thread'?'threads':'instagram',handle:account.handle},scheduledAt,timeZone:'Europe/Prague',templateVersion:prepared.templateVersion,promptVersion:'authored-weekly-offline-import/1',model:'none-offline-authored',traceId:null});
  const receipt:MarketingOfflineImportReceipt={schemaVersion:'marketing-offline-import/1',manifestSha256:input.manifestSha256,identityHash:prepared.identityHash,role:input.role,templateSha256:prepared.templateSha256,sourceContentHash:source.contentHash,assetHashes:assets.map(asset=>asset.sha256),svgHashes:prepared.descriptors.map(asset=>asset.svg.sha256),holdCode:OFFLINE_IMPORT_HOLD,templateApproved:false,providerCalls:0};
  assertLiveScope();
  const {data,error}=await db.rpc('marketing_import_offline_revision',{p_owner:ownerId,p_id:revisionId,p_campaign:input.campaignId,p_entry:input.entryId,p_version:input.entryVersion,p_role:input.role,p_identity:prepared.identityHash,p_revision:revision,p_hash:revisionHash(revision),p_receipt:receipt,p_pilot:pilot});
  if(error||!data)reject('offline-import-save-failed');
  return{revisionId:String(data),duplicate:false,ready:false,status:'review' as const,holdCode:OFFLINE_IMPORT_HOLD,providerCalls:0 as const};
}
