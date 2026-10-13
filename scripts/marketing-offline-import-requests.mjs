/** Private offline request preparation only. Does not call Auth, Storage, models or an API.
 * --bundle /private/final --packets /private/packets.json --entries /private/owned-calendar-entries.json --output /private/new-folder
 * entries must be an exact owner-exported array, not inferred titles or a generic calendar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const slots={ig:'carousel','threads-question':'thread-question','threads-answer':'thread-answer','story-1':'story-question','story-2':'story-options','story-3':'story-answer'};
export function prepareOfflineImportRequests(options){
  const bundle=fs.realpathSync(options.bundle),manifestBytes=fs.readFileSync(path.join(bundle,'manifest.json'));
  const manifest=JSON.parse(manifestBytes),packets=JSON.parse(fs.readFileSync(options.packets,'utf8')),entries=JSON.parse(fs.readFileSync(options.entries,'utf8'));
  assert.ok(manifest.schemaVersion==='devshark-private-weekly-drafts/1'&&manifest.days.length===7&&manifest.published===false&&manifest.sourceApproval===false&&manifest.stories.templateApproved===false,'draft-bundle-required');
  assert.ok(Array.isArray(packets)&&packets.length===7&&Array.isArray(entries)&&entries.length===42,'seven-packets-and-42-exact-entries-required');
  const requests=entries.map(entry=>{
    const role=slots[entry.original?.slot],day=manifest.days.find(day=>day.date===entry.date);
    const source=packets.find(source=>source.sourceId===entry.original?.sourceId);
    assert.ok(role&&day&&source&&day.sourceId===source.sourceId&&entry.original.contentHash===source.contentHash&&entry.original.sourceRevision===source.sourceRevision&&day.contentHash===source.contentHash&&day.sourceRevision===source.sourceRevision&&entry.generation_version>0&&entry.campaign_id&&entry.id,'exact-owned-slot-source-required');
    const index=role==='story-question'?0:role==='story-options'?1:2;
    const descriptors=role==='carousel'?day.instagram.slides.flatMap(asset=>[asset,asset.svg]):role.startsWith('thread-')?[day.threads[role==='thread-question'?0:1]]:[day.stories[index],day.stories[index].svg];
    const files=descriptors.map(descriptor=>{
      assert.match(descriptor.file,/^\d{4}-\d{2}-\d{2}\/[a-z0-9-]+\.(jpg|svg|txt)$/,'relative-artifact-path-required');
      const file=fs.realpathSync(path.join(bundle,descriptor.file));assert.ok(file.startsWith(bundle+path.sep),'artifact-must-stay-in-bundle');
      const bytes=fs.readFileSync(file);assert.ok(bytes.length===descriptor.bytes&&sha(bytes)===descriptor.sha256,'artifact-hash-mismatch');
      return{file:descriptor.file,base64:bytes.toString('base64')};
    });
    const request={campaignId:entry.campaign_id,entryId:entry.id,entryVersion:entry.generation_version,date:entry.date,role,manifestBase64:manifestBytes.toString('base64'),manifestSha256:sha(manifestBytes),source,files};
    const json=JSON.stringify(request);assert.ok(Buffer.byteLength(json)<=4*1024*1024,'request-exceeds-4-MiB');
    assert.ok(files.reduce((size,file)=>size+Buffer.from(file.base64,'base64').length,0)<=2560*1024,'artifact-bytes-exceed-2.5-MiB');
    return{file:`${entry.date}-${role}.json`,json};
  });
  assert.ok(new Set(requests.map(request=>request.file)).size===42&&new Set(entries.map(entry=>entry.id)).size===42,'duplicate-owned-slot');
  const output=path.resolve(options.output),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});const resolved=path.join(fs.realpathSync(path.dirname(output)),path.basename(output));
  assert.ok(resolved!==repo&&!resolved.startsWith(repo+path.sep)&&!fs.existsSync(resolved),'new-private-output-outside-repo-required');
  fs.mkdirSync(resolved,{mode:0o700});for(const request of requests)fs.writeFileSync(path.join(resolved,request.file),request.json,{mode:0o600,flag:'wx'});
  return{requests:42,providerCalls:0,storageCalls:0,apiCalls:0,ready:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args=process.argv.slice(2),options={};for(let i=0;i<args.length;i+=2){assert.ok(['--bundle','--packets','--entries','--output'].includes(args[i])&&args[i+1]&&!options[args[i].slice(2)],'invalid-options');options[args[i].slice(2)]=args[i+1];}assert.ok(Object.keys(options).length===4,'four-options-required');console.log(prepareOfflineImportRequests(options));}
  catch{console.error('offline-import-request-preparation-failed');process.exitCode=1;}
}
