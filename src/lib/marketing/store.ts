import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseContentRevision, parseSourcePacket, revisionReadiness, sourceUsable, type ContentRevision } from './contracts';
import { contentHash, revisionHash } from './hashes';

type Database = ReturnType<typeof createAdminClient>;
export async function ingestSource(db:Database,ownerId:string,value:unknown,brand:string|null) {
 const packet=parseSourcePacket(value);
 if(brand!==packet.brand) throw new Error('source-brand-mismatch');
 if(contentHash(packet.content)!==packet.contentHash) throw new Error('source-hash-mismatch');
 if(Date.parse(packet.observedAt)>Date.now()+60000) throw new Error('source-time-invalid');
 const {data,error}=await db.rpc('marketing_ingest_source',{p_owner:ownerId,p_packet:packet});
 if(error) throw new Error('source-save-failed');
 return {id:data,usable:sourceUsable(packet)};
}
export async function saveRevision(db:Database,ownerId:string,value:unknown,options:{id?:string;replacesId?:string|null;slides?:unknown[]}={}) {
 const revision=parseContentRevision(value);
 const ready=revisionReadiness(revision).length===0;
 const {data,error}=await db.rpc('marketing_save_revision',{p_owner:ownerId,p_id:options.id??randomUUID(),p_revision:revision,p_hash:revisionHash(revision),p_ready:ready,p_slides:options.slides??[],p_replace:options.replacesId??null});
 if(error) throw new Error('revision-save-failed');
 return {id:data,ready};
}
export async function sourceReferences(db:Database,ownerId:string,revision:ContentRevision) {
 const {data,error}=await db.from('marketing_sources').select('packet').eq('user_id',ownerId).eq('brand',revision.brand).in('source_id',revision.sources.map(s=>s.sourceId));
 if(error) throw new Error('sources-unavailable');
 return (data??[]).map(row=>parseSourcePacket(row.packet));
}
