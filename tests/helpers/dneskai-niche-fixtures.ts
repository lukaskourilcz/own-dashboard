import {createHash} from 'node:crypto';
import {DNESKAI_EDUCATION_SOURCES} from '@/lib/marketing/dneskai-registry';
export const nicheOwner='11111111-1111-4111-8111-111111111111',nicheProject='22222222-2222-4222-8222-222222222222';
export const nicheNow=new Date('2026-10-27T12:00:00Z'),nicheSourceId=DNESKAI_EDUCATION_SOURCES[0].id;
export const nicheSourceIds=DNESKAI_EDUCATION_SOURCES.map(source=>source.id).sort();
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const nicheCandidate=(index:number)=>({targetDate:null,id:`synthetic-${index}`,sourceId:nicheSourceId,externalId:`reel-${index}`,title:'Synthetic ranking fixture',text:'Synthetic unused article',url:`https://example.test/reel/${index}`,publishedAt:null,fetchedAt:nicheNow.toISOString(),mediaUrls:[],contentHash:hash(`content-${index}`),category:null,relevance:null,duplicateOf:null,status:'new',reason:null,instagram:{plays:100,music:{audioId:'123',title:'Synthetic sound',artist:'Synthetic artist',originalAudio:false,muted:false}}});
export const nicheRow=(index:number)=>{const candidate=nicheCandidate(index);return{id:candidate.id,createdAt:'2026-10-27T11:00:00Z',sourceId:candidate.sourceId,externalId:candidate.externalId,instagram:candidate.instagram};};
export const nicheSnapshot=(count=1)=>({ownerId:nicheOwner,projectId:nicheProject,sourceIds:[...nicheSourceIds],since:'2026-10-20T12:00:00Z',until:nicheNow.toISOString(),rows:Array.from({length:count},(_,index)=>nicheRow(index))});
