/** Manual synthetic native-frame profile. Run from Node 22; no provider/network call or encoding.
 * A unique temporary Vitest fixture is removed in finally. Pass an output JSON path to retain a new sample. */
import {randomUUID} from 'node:crypto';
import {writeFileSync,unlinkSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=resolve(root,process.argv[2]??'docs/reports/app-wide-audit-2026-10-23/reel-frame-resource-after.json');
const path=resolve(root,'tests/lib/app-audit-frame-'+randomUUID()+'.test.ts');
const source="import sharp from 'sharp';\nimport {createHash} from 'node:crypto';\nimport {writeFileSync,readFileSync} from 'node:fs';\nimport {it,vi,expect} from 'vitest';\nimport {composeDneskaiReelFrame,renderDneskaiReel} from '@/lib/marketing/dneskai-reel-render';\nit('records synthetic native frame identity and active pipeline evidence',async()=>{\n const slide=await sharp({create:{width:1080,height:1350,channels:3,background:'#2050e0'}}).jpeg({quality:92}).toBuffer();\n const frame=await composeDneskaiReelFrame(slide);let active=0,peak=0;const original=sharp.prototype.toBuffer;\n const spy=vi.spyOn(sharp.prototype,'toBuffer').mockImplementation(function(this:sharp.Sharp,...args:unknown[]){active++;peak=Math.max(peak,active);return Promise.resolve(original.apply(this,args as never)).finally(()=>active--);} as never);\n const warning=vi.spyOn(console,'warn').mockImplementation(()=>{}),started=performance.now();\n try{await expect(renderDneskaiReel({slides:Array.from({length:10},()=>slide),audio:null,ffmpegPath:process.execPath})).rejects.toHaveProperty('code','reel-encode-failed');}\n finally{spy.mockRestore();warning.mockRestore();}\n const output={sourceSha256:createHash('sha256').update(readFileSync('src/lib/marketing/dneskai-reel-render.ts')).digest('hex'),inputSha256:createHash('sha256').update(slide).digest('hex'),frameSha256:createHash('sha256').update(frame).digest('hex'),frameBytes:frame.length,peakActiveToBuffer:peak,framePassMs:performance.now()-started,maxRSSKiB:process.resourceUsage().maxRSS,scope:'synthetic ten-slide composition; Node rejects FFmpeg flags and skips encoding; no external connection'};\n writeFileSync(__AUDIT_OUTPUT__,JSON.stringify(output,null,2)+'\\n');\n},30000);\n";
writeFileSync(path,source.replace('__AUDIT_OUTPUT__',JSON.stringify(output)),{flag:'wx'});
try{
 const result=spawnSync(process.execPath,[resolve(root,'node_modules/vitest/vitest.mjs'),'run',path,'--maxWorkers=1'],{cwd:root,timeout:60000,encoding:'utf8'});
 if(result.status!==0){process.stderr.write(result.stdout??'');process.stderr.write(result.stderr??'');throw new Error('Native frame sample failed');}
 console.log('Native frame sample saved; no encoding or external connection.');
}finally{unlinkSync(path);}
