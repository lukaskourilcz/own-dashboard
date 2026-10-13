import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MARKETING_CALENDAR_SOURCES } from '@/lib/marketing-calendars';
import type { GitHubFetch } from '@/lib/stack-detection-server';
import type { MarketingBrand } from './contracts';
export async function readFullMarketingCalendar(fetcher:GitHubFetch,brand:MarketingBrand){
 const source=MARKETING_CALENDAR_SOURCES.find(value=>value.project===brand);
 if(!source)throw new Error('calendar-source-unavailable');
 const commits=await fetcher(`/repos/${source.repo}/commits?path=${encodeURIComponent(source.path)}&per_page=1`,{signal:AbortSignal.timeout(10000)});
 if(!commits.ok)throw new Error('calendar-repository-unavailable');
 const parsed=z.array(z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)})).min(1).max(1).parse(await commits.json());
 const commit=parsed[0].sha;
 const file=await fetcher(`/repos/${source.repo}/contents/${source.path}?ref=${commit}`,{headers:{Accept:'application/vnd.github.raw+json'},signal:AbortSignal.timeout(10000)});
 if(!file.ok||!file.body)throw new Error('calendar-source-unavailable');
 const reader=file.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024*1024){await reader.cancel();throw new Error('calendar-too-large');}chunks.push(value);}
 const raw=Buffer.concat(chunks);const plan=JSON.parse(raw.toString('utf8'));
 return {...plan,_importProvenance:{repository:source.repo,path:source.path,sourceCommit:commit,fileSha256:createHash('sha256').update(raw).digest('hex')}};
}
