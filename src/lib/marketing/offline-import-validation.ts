import { createHash } from 'node:crypto';
import { z } from 'zod';
import { parseSourcePacket, sourceUsable, SourcePacketSchema, type SourcePacket } from './contracts';
import { contentHash } from './hashes';
import { sevenDayMarketingWindow } from './weekly-planning';

export const OFFLINE_IMPORT_MAX_BODY = 4 * 1024 * 1024;
export const OFFLINE_IMPORT_MAX_FILES = 12;
export const OFFLINE_IMPORT_MAX_FILE_BYTES = 2560 * 1024;
export const OFFLINE_IMPORT_HOLD = 'offline-import-review-required';
export const OFFLINE_IMPORT_ERROR_CODES = ['offline-import-disabled','offline-import-invalid','offline-import-too-large','offline-import-path-invalid','offline-import-file-mismatch','offline-import-source-unavailable','offline-import-source-changed','offline-import-entry-unavailable','offline-import-account-unavailable','offline-import-storage-unavailable','offline-import-conflict','offline-import-save-failed'] as const;
export class MarketingOfflineImportError extends Error {
  constructor(readonly code: typeof OFFLINE_IMPORT_ERROR_CODES[number]) { super(code); }
}
export const OfflineImportRoleSchema = z.enum(['carousel','thread-question','thread-answer','story-question','story-options','story-answer']);
export type OfflineImportRole = z.infer<typeof OfflineImportRoleSchema>;
export type MarketingOfflineImportReceipt = {schemaVersion:'marketing-offline-import/1';manifestSha256:string;identityHash:string;role:OfflineImportRole;templateSha256:string;sourceContentHash:string;assetHashes:string[];svgHashes:string[];holdCode:typeof OFFLINE_IMPORT_HOLD;templateApproved:false;providerCalls:0};
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const OfflineImportInputSchema = z.strictObject({
  campaignId:z.uuid(),entryId:z.uuid(),entryVersion:z.number().int().positive(),date:z.iso.date(),role:OfflineImportRoleSchema,
  manifestBase64:z.string().min(1).max(512 * 1024),manifestSha256:hash,source:SourcePacketSchema,
  files:z.array(z.strictObject({file:z.string().min(1).max(160),base64:z.string().min(1).max(OFFLINE_IMPORT_MAX_BODY)})).max(OFFLINE_IMPORT_MAX_FILES),
});
export type OfflineImportInput = z.infer<typeof OfflineImportInputSchema>;
const proof = z.object({file:z.string(),sha256:hash,bytes:z.number().int().positive()});
const image = proof.extend({width:z.literal(1080),height:z.union([z.literal(1350),z.literal(1920)]),svg:proof,status:z.literal('draft'),alt:z.string().max(1000).optional(),role:z.enum(['question','options','answer']).optional(),templateApproved:z.literal(false).optional()});
const text = proof.extend({role:z.enum(['question','answer']),format:z.literal('thread'),title:z.string().min(1).max(300),utf8Bytes:z.number().int().positive().max(500),codepoints:z.number().int().positive().max(500),status:z.literal('draft')});
const manifestSchema = z.object({
  schemaVersion:z.literal('devshark-private-weekly-drafts/1'),status:z.literal('draft'),
  week:z.object({startsOn:z.iso.date(),endsOn:z.iso.date(),timeZone:z.literal('Europe/Prague')}),
  counts:z.object({sourceItems:z.literal(7),instagramPosts:z.literal(7),instagramJpegs:z.literal(28),threadsPosts:z.literal(14),storyJpegs:z.literal(21),logicalDeliverables:z.literal(42)}),
  requiresFreshSourceRecheck:z.literal(true),sourceApproval:z.literal(false),readyRevisionPersisted:z.literal(false),published:z.literal(false),providerCalls:z.literal(0),modelCalls:z.literal(0),storageCalls:z.literal(0),
  stories:z.object({templateApproved:z.literal(false)}),
  days:z.array(z.object({date:z.iso.date(),sourceId:z.string(),sourceRevision:z.string(),contentHash:hash,sourceObservedAt:z.iso.datetime({offset:true}),category:z.string(),caption:z.string().min(1).max(2200),instagram:z.object({status:z.literal('draft'),templateVersion:z.string().min(1).max(200),templateSha256:hash,slides:z.array(image).length(4)}),threads:z.array(text).length(2),stories:z.array(image).length(3)})).length(7),
});
export const offlineImportSha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fail(code: typeof OFFLINE_IMPORT_ERROR_CODES[number]): never { throw new MarketingOfflineImportError(code); }
export function decodeOfflineBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('offline-import-invalid');
  const bytes=Buffer.from(value,'base64');
  if(bytes.toString('base64')!==value)fail('offline-import-invalid');
  return bytes;
}
export function offlineImportSlot(role: OfflineImportRole): string {
  return ({carousel:'ig','thread-question':'threads-question','thread-answer':'threads-answer','story-question':'story-1','story-options':'story-2','story-answer':'story-3'} as const)[role];
}
export function assertOfflineSource(source: SourcePacket, now: Date) {
  if(source.brand!=='devshark'||source.kind!=='question'||source.locale!=='en'||!sourceUsable(source,now)||contentHash(source.content)!==source.contentHash||Date.parse(source.observedAt)>now.getTime()+60000)fail('offline-import-source-unavailable');
}
export function assertOfflineSourceBinding(expected:SourcePacket,current:SourcePacket) {
  for(const key of ['brand','kind','sourceId','sourceRevision','canonicalUrl','locale','contentHash'] as const)if(expected[key]!==current[key])fail('offline-import-source-changed');
  if(contentHash(current.content)!==expected.contentHash)fail('offline-import-source-changed');
}
/** No uploaded SVG, HTML, path or URL is executed or dereferenced. Unknown manifest prose is discarded. */
export function validateMarketingOfflineImport(value: unknown, now=new Date()) {
  try {
    const input=OfflineImportInputSchema.parse(value),source=parseSourcePacket(input.source);assertOfflineSource(source,now);
    const manifestBytes=decodeOfflineBase64(input.manifestBase64);
    if(manifestBytes.length>256*1024)fail('offline-import-too-large');
    if(offlineImportSha(manifestBytes)!==input.manifestSha256)fail('offline-import-file-mismatch');
    const manifest=manifestSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes)));
    const dates=sevenDayMarketingWindow(manifest.week.startsOn).dates;
    if(new Date(`${dates[0]}T00:00:00Z`).getUTCDay()!==0||manifest.week.endsOn!==dates[6]||manifest.days.some((day,i)=>day.date!==dates[i])||new Set(manifest.days.map(day=>day.sourceId)).size!==7)fail('offline-import-invalid');
    const day=manifest.days.find(day=>day.date===input.date);
    if(!day||day.sourceId!==source.sourceId||day.sourceRevision!==source.sourceRevision||day.contentHash!==source.contentHash||day.category!==source.content.category)fail('offline-import-source-changed');
    if(day.threads[0].role!=='question'||day.threads[1].role!=='answer'||day.stories.some((story,i)=>story.role!==['question','options','answer'][i]||story.templateApproved!==false))fail('offline-import-invalid');
    const correct=source.content.options.indexOf(source.content.answer??'');
    if(correct<0||source.content.options.filter(option=>option===source.content.answer).length!==1)fail('offline-import-invalid');
    const question=`${source.content.body}\n\n${source.content.options.map((option,i)=>`${String.fromCharCode(65+i)}. ${option}`).join('\n')}\n\n${source.canonicalUrl}`;
    const answer=`Answer: ${String.fromCharCode(65+correct)}.\n\n${source.content.explanation}`;
    if(source.content.code&&!source.content.body.includes(source.content.code))fail('offline-import-invalid');
    if([question,answer].some(copy=>copy.length>500||[...copy].length>500||Buffer.byteLength(copy,'utf8')>500))fail('offline-import-invalid');
    const format=input.role==='carousel'?'carousel':input.role.startsWith('thread-')?'thread':'story';
    const index=input.role==='story-question'?0:input.role==='story-options'?1:2;
    const descriptors=format==='carousel'?day.instagram.slides:format==='story'?[day.stories[index]]:[];
    const thread=format==='thread'?day.threads[input.role==='thread-question'?0:1]:null;
    const expectedFiles=new Map<string,z.infer<typeof proof>>();
    function add(file:z.infer<typeof proof>, expected:string){
      if(file.file!==expected||!/^\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\.(?:jpg|svg|txt)$/.test(file.file))fail('offline-import-path-invalid');
      expectedFiles.set(file.file,file);
    }
    descriptors.forEach((asset,i)=>{const n=format==='carousel'?i+1:index+1;const prefix=format==='carousel'?'instagram':'story';if(asset.width!==1080||asset.height!==(format==='story'?1920:1350))fail('offline-import-invalid');add(asset,`${input.date}/${prefix}-${n}.jpg`);add(asset.svg,`${input.date}/${prefix}-${n}.svg`);});
    if(thread)add(thread,`${input.date}/threads-${thread.role}.txt`);
    if(input.files.length!==expectedFiles.size||new Set(input.files.map(file=>file.file)).size!==input.files.length)fail('offline-import-file-mismatch');
    const files=new Map<string,Buffer>();let total=0;
    for(const file of input.files){const expected=expectedFiles.get(file.file);if(!expected)fail('offline-import-path-invalid');const bytes=decodeOfflineBase64(file.base64);total+=bytes.length;if(total>OFFLINE_IMPORT_MAX_FILE_BYTES)fail('offline-import-too-large');if(bytes.length!==expected.bytes||offlineImportSha(bytes)!==expected.sha256)fail('offline-import-file-mismatch');files.set(file.file,bytes);}
    const caption=thread?(input.role==='thread-question'?question:answer):day.caption;
    if(thread&&(files.get(thread.file)!.toString('utf8')!==caption||thread.bytes!==Buffer.byteLength(caption)||thread.utf8Bytes!==Buffer.byteLength(caption)||thread.codepoints!==[...caption].length||thread.title!==source.content.title))fail('offline-import-file-mismatch');
    // Story provenance describes its own SVG bytes, never the carousel approval digest.
    const templateSha256=format==='story'?contentHash({layout:'offline-story-svg/1',width:1080,height:1920,role:input.role,svgSha256:descriptors[0].svg.sha256}):day.instagram.templateSha256;
    return {input,source,format,caption,descriptors,files,templateSha256,templateVersion:format==='story'?'devshark-offline-story/1':day.instagram.templateVersion,identityHash:contentHash({campaignId:input.campaignId,entryId:input.entryId,entryVersion:input.entryVersion,role:input.role,manifestSha256:input.manifestSha256,sourceRevision:source.sourceRevision,contentHash:source.contentHash})};
  } catch(error){if(error instanceof MarketingOfflineImportError)throw error;throw new MarketingOfflineImportError('offline-import-invalid');}
}
