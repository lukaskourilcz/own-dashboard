'use client';
import { useState,useSyncExternalStore } from 'react';
import { OfflineDraftImport } from '@/components/marketing/offline-import';
import Image from 'next/image';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useDict,useLang } from '@/lib/i18n';
import { WeeklyMarketingCalendar } from '@/components/marketing/weekly-calendar';
import { MarketingDiagnostics } from '@/components/marketing/marketing-diagnostics';
import { WeeklyResults } from '@/components/marketing/weekly-results';
import { MarketingJobHealthSummary } from '@/components/marketing/job-health';
import { KnowledgeLibrary } from '@/components/marketing/knowledge-library';
import { KnowledgeImport } from '@/components/marketing/knowledge-import';
import { CalendarImport } from '@/components/marketing/calendar-import';
import { useGuardedNavigation } from '@/components/navigation-guard';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { pragueScheduledAt,pragueLocalInput } from '@/lib/marketing/clock';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { qk } from '@/lib/queries/keys';
import { EMPTY_MARKETING_STATE,loadMarketingState,marketingDecision } from '@/lib/marketing/client';
import type { MarketingRevisionRow } from '@/lib/marketing/contracts';

const subscribeUrl=(notify:()=>void)=>{window.addEventListener('popstate',notify);return()=>window.removeEventListener('popstate',notify);};
const urlSnapshot=()=>window.location.search;
const serverUrlSnapshot=()=>'';

export function MarketingPanel({isPreview=false,liveCalendarImport=false,liveState=false,onOpenKnowledge}:{isPreview?:boolean;liveCalendarImport?:boolean;liveState?:boolean;onOpenKnowledge:()=>void}){
 const navigate=useGuardedNavigation();const t=useDict().marketingWorkspace;const {lang}=useLang();const qc=useQueryClient();const owner=useOwnerPreferences();
 const [view,setView]=useState<'review'|'calendar'|'knowledge'|'results'>('review');
 const queryString=useSyncExternalStore(subscribeUrl,urlSnapshot,serverUrlSnapshot);
 const requestedBrand=new URLSearchParams(queryString).get('brand');
 const [selectedBrand,setBrand]=useState<'all'|'dneskai'|'devshark'|null>(null);
 const brand=selectedBrand??(requestedBrand==='dneskai'||requestedBrand==='devshark'?requestedBrand:'all');const [busy,setBusy]=useState<string|null>(null);const [message,setMessage]=useState('');
 const [loadedAssets,setLoadedAssets]=useState<Set<string>>(()=>new Set());
 const [editMode,setEditMode]=useState<'edit'|'returned'>('edit');
 const [editing,setEditing]=useState<MarketingRevisionRow|null>(null);const [caption,setCaption]=useState('');const [schedule,setSchedule]=useState('');const [feedback,setFeedback]=useState('');
 const readEnabled=!isPreview||liveState;
 const query=useQuery({queryKey:qk.marketingState,queryFn:({signal})=>{if(!owner)throw new Error('marketing-unavailable');const original=owner.capture();return loadMarketingState(AbortSignal.any([signal,original.signal]),original.ownerId);},enabled:readEnabled&&!!owner,initialData:readEnabled?undefined:EMPTY_MARKETING_STATE,staleTime:30000,refetchOnWindowFocus:false,retry:false});
 const data=query.data??EMPTY_MARKETING_STATE;
 const revisions=data.revisions.filter(r=>brand==='all'||r.revision.brand===brand);
 const mutationsDisabled=isPreview||query.isError||query.isFetching||!owner;
 const publicationRevisions=view==='results'?new Map(revisions.map(row=>[row.id,row])):null;
 const publications=publicationRevisions?data.publications.filter(row=>publicationRevisions.has(row.revision_id)):[];
 const statuses:Record<string,string>={review:t.reviewState,approved:t.approved,published:t.published,returned:t.returned,skipped:t.skipped,superseded:t.superseded,publishing:t.publishing,claimed:t.publishing,reconciliation:t.reconciliation,failed:t.errorState,queued:t.queued,cancelled:t.cancelled};
 const status=(key:string)=>Object.hasOwn(statuses,key)?statuses[key]:t.needsReview;
 async function decide(input:unknown,id:string){if(mutationsDisabled)return;setBusy(id);setMessage('');try{await marketingDecision(input);await qc.invalidateQueries({queryKey:qk.marketingState});setEditing(null);setMessage(t.saved);}catch{setMessage(t.failed);}finally{setBusy(null);}}
 return <div data-testid="marketing-workspace">
  <PageHeader title={t.title} description={t.description} action={<Button variant="outline" className="min-w-24" aria-busy={query.isFetching} disabled={!readEnabled||query.isFetching||!owner} onClick={()=>void query.refetch()}>{query.isFetching?t.refreshing:t.refresh}</Button>}/>
  <div className="mb-4 flex flex-wrap items-center gap-2">
   <div role="tablist" aria-label={t.title} className="flex max-w-full gap-1 overflow-x-auto">
    {(['review','calendar','knowledge','results'] as const).map(key=><Button key={key} id={`marketing-tab-${key}`} role="tab" aria-controls={`marketing-panel-${key}`} tabIndex={view===key?0:-1} aria-selected={view===key} onKeyDown={e=>{const keys=['review','calendar','knowledge','results'] as const;let next=keys.indexOf(key);if(e.key==='ArrowRight')next=(next+1)%4;else if(e.key==='ArrowLeft')next=(next+3)%4;else if(e.key==='Home')next=0;else if(e.key==='End')next=3;else return;e.preventDefault();navigate(()=>{setView(keys[next]);document.getElementById(`marketing-tab-${keys[next]}`)?.focus();});}} variant={view===key?'default':'ghost'} onClick={()=>navigate(()=>setView(key))}>{t[key]}</Button>)}
   </div>
   <label className="ml-auto text-xs text-foreground-muted"><span className="sr-only">{t.account}</span><select className="h-11 rounded-md border border-border bg-surface px-3 text-foreground md:h-8" value={brand} onChange={e=>setBrand(e.target.value==='dneskai'||e.target.value==='devshark'?e.target.value:'all')}><option value="all">{t.all}</option><option value="dneskai">DNESKAi</option><option value="devshark">devShark</option></select></label>
  </div>
  {isPreview&&<p className="mb-3 text-xs text-foreground-muted">{t.preview}</p>}
  {message&&<p role="status" className="mb-4 text-sm">{message}</p>}
  {readEnabled&&!owner?<p role="alert">{t.unavailable}</p>:<>
  {query.isError&&<p role="alert" className="mb-4 rounded-md border border-border bg-surface p-3 text-xs">{query.data?t.retainedState:t.unavailable}{query.data&&<span className="mt-1 block text-foreground-muted">{t.lastChecked}: <time dateTime={new Date(query.dataUpdatedAt).toISOString()}>{new Intl.DateTimeFormat(lang==='cs'?'cs-CZ':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Prague'}).format(new Date(query.dataUpdatedAt))}</time></span>}</p>}
  {query.isPending&&readEnabled?<p role="status">{t.loading}</p>:query.data&&<div role="tabpanel" aria-busy={query.isFetching} id={`marketing-panel-${view}`} aria-labelledby={`marketing-tab-${view}`}>
  {view==='review'&&<OfflineDraftImport lang={lang} disabled={mutationsDisabled} onImported={()=>void qc.invalidateQueries({queryKey:qk.marketingState})}/>}
  {view==='review'&&<MarketingJobHealthSummary jobs={(data.jobHealth??[]).filter(job=>brand==='all'||job.brand===brand)} lang={lang} disabled={!readEnabled||!owner} refreshing={query.isFetching} onRefresh={()=>void query.refetch()}/>}
  {view==='review'&&(revisions.filter(r=>['review','returned','approved'].includes(r.status)).length===0?<EmptyState title={t.empty} description={t.emptyDescription}/>:<div className="space-y-5">{revisions.filter(r=>['review','returned','approved'].includes(r.status)).map(row=>{
   const r=row.revision;const activeCampaign=!row.campaign_id||data.campaigns.some(c=>c.id===row.campaign_id&&c.status==='active');const currentSources=r.sources.every(ref=>data.sources.some(item=>item.brand===r.brand&&item.source_id===ref.sourceId&&item.packet.sourceRevision===ref.sourceRevision&&item.packet.contentHash===ref.contentHash&&item.eligible&&(item.packet.expiresAt===null||Date.parse(item.packet.expiresAt)>Date.now())));const verified=data.accounts.some(a=>a.brand===r.brand&&a.platform===r.account.platform&&a.remote_account_id===r.account.id&&a.verified_at);
   return <article key={row.id} className="overflow-hidden rounded-lg border border-border bg-surface">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3"><div className="min-w-0"><p className="text-xs font-semibold text-foreground-muted">{r.brand==='dneskai'?'DNESKAi':'devShark'} · {r.account.platform} · @{r.account.handle}</p><h2 className="break-words text-sm font-semibold">{r.title}</h2></div><span className="text-xs">{status(row.status)}</span></header>
    <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
     <div className="flex gap-3 overflow-x-auto pb-2" aria-label={r.title}>{r.assets.length?r.assets.map((asset,index)=><figure key={asset.sha256} className="w-64 shrink-0"><Image unoptimized src={asset.url} alt={asset.alt} width={asset.width} height={asset.height} className="h-auto w-full rounded border border-border" onLoad={()=>setLoadedAssets(previous=>new Set(previous).add(asset.sha256))} onError={()=>setLoadedAssets(previous=>{const next=new Set(previous);next.delete(asset.sha256);return next;})}/><figcaption className="mt-1 text-xs text-foreground-muted">{index+1}/{r.assets.length}</figcaption></figure>):<p className="text-sm text-foreground-muted">{t.notReady}</p>}</div>
     <div className="min-w-0 space-y-3">{row.offline_import_receipt?.holdCode==='offline-import-review-required'&&<p className="text-xs text-foreground-muted">{lang==='cs'?'Importovaný návrh je připravený k prohlédnutí. Před schválením je potřeba dokončit ověření grafické šablony a podkladů; úprava popisku tuto kontrolu nenahrazuje.':'The imported draft is available to review. Template and source verification must be completed before approval; editing the caption does not complete that check.'}</p>}{r.format==='story'&&<p className="text-xs text-foreground-muted">{lang==='cs'?'Stories publikují pouze schválený obrázek. Text níže slouží ke kontrole a neposílá se jako samostatný popisek.':'Stories publish only the approved image. The text below is review metadata and is not sent as a separate caption.'}</p>}<p className="whitespace-pre-wrap break-words text-sm">{r.caption}</p><dl className="space-y-1 text-xs"><div><dt className="inline text-foreground-muted">{t.account}: </dt><dd className="inline">@{r.account.handle} · {r.account.platform}</dd></div><div><dt className="inline text-foreground-muted">{t.schedule}: </dt><dd className="inline"><time dateTime={r.scheduledAt}>{new Intl.DateTimeFormat(lang==='cs'?'cs-CZ':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:r.timeZone}).format(new Date(r.scheduledAt))}</time></dd></div></dl><details><summary className="cursor-pointer text-xs font-medium">{t.source}</summary><ul className="mt-2 space-y-2 text-xs">{r.sources.map(ref=>{const source=data.sourceHistory.find(packet=>packet.sourceId===ref.sourceId&&packet.brand===r.brand&&packet.sourceRevision===ref.sourceRevision&&packet.contentHash===ref.contentHash)??data.sources.find(item=>item.source_id===ref.sourceId&&item.brand===r.brand&&item.packet.sourceRevision===ref.sourceRevision&&item.packet.contentHash===ref.contentHash)?.packet;return <li key={ref.sourceId}>{source?<a className="break-words underline" href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.content.title}</a>:ref.sourceId}{source?.content.evidence.length?<ul className="mt-1 space-y-1 text-foreground-muted">{source.content.evidence.map(evidence=><li key={evidence.url}><a href={evidence.url} target="_blank" rel="noreferrer" className="underline">{evidence.title}</a><p>{evidence.excerpt}</p></li>)}</ul>:null}</li>;})}</ul></details>{!verified&&<p className="text-xs text-foreground-muted">{t.noAccount}</p>}{!activeCampaign&&<p className="text-xs text-foreground-muted">{lang==='cs'?'Plán není aktivní. Tato verze se nepublikuje.':'Campaign is inactive. This revision will not publish.'}</p>}{!currentSources&&<p className="text-xs text-foreground-muted">{t.changedSource}</p>}</div>
    </div>
    <footer className="flex flex-wrap gap-2 border-t border-border px-4 py-3"><Button disabled={mutationsDisabled||busy===row.id||!row.ready||!verified||!currentSources||!activeCampaign||!r.assets.every(asset=>loadedAssets.has(asset.sha256))||row.status!=='review'} onClick={()=>void decide({action:'approve',id:row.id,expectedHash:row.content_hash},row.id)}>{t.approve}</Button><Button variant="outline" disabled={mutationsDisabled||busy===row.id} onClick={()=>{setEditMode('edit');setEditing(row);setCaption(r.caption);setSchedule(pragueLocalInput(r.scheduledAt));setFeedback('');}}>{t.edit}</Button><Button variant="ghost" disabled={mutationsDisabled||busy===row.id} onClick={()=>{setEditMode('returned');setEditing(row);setCaption('');setFeedback('');}}>{t.return}</Button><Button variant="ghost" disabled={mutationsDisabled||busy===row.id} onClick={()=>void decide({action:'skipped',id:row.id},row.id)}>{t.skip}</Button></footer>
   </article>;
  })}</div>)}
  {view==='calendar'&&<CalendarImport disabled={(isPreview&&!liveCalendarImport)||query.isError||query.isFetching||!owner} onImported={()=>void qc.invalidateQueries({queryKey:qk.marketingState})}/>}
  {view==='calendar'&&(data.campaigns.length===0?<EmptyState title={t.noCalendar}/>:<WeeklyMarketingCalendar state={data} brand={brand} lang={lang} disabled={mutationsDisabled} busy={busy} onChanged={()=>void qc.invalidateQueries({queryKey:qk.marketingState})} onActivate={async c=>{if(mutationsDisabled)return;setBusy(c.id);try{const response=await fetch('/api/marketing/campaigns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:c.id,expectedHash:c.source_hash})});if(!response.ok)throw new Error();await qc.invalidateQueries({queryKey:qk.marketingState});setMessage(t.saved);}catch{setMessage(t.failed);}finally{setBusy(null);}}}/>)}
  {view==='knowledge'&&<div className="space-y-4"><KnowledgeImport disabled={mutationsDisabled} onImported={()=>{void qc.invalidateQueries({queryKey:qk.marketingState});void qc.invalidateQueries({queryKey:qk.marketingKnowledge});}}/><KnowledgeLibrary disabled={mutationsDisabled}/><Button variant="outline" onClick={onOpenKnowledge}>{t.openKnowledge}</Button></div>}
  {view==='results'&&<WeeklyResults revisions={data.revisions} publications={data.publications} brand={brand} lang={lang}/>}
  {view==='results'&&<MarketingDiagnostics state={data} lang={lang}/>}
  {view==='results'&&publications.length>0&&<section aria-label={t.loadedReceipts}><h2 className="mb-2 text-sm font-semibold">{t.loadedReceipts}</h2><div className="divide-y divide-border">{publications.map(p=><div key={p.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{publicationRevisions?.get(p.revision_id)?.revision.title} · {p.platform}</span><span>{status(p.status)} {p.remote_url&&<a href={p.remote_url} target="_blank" rel="noreferrer" className="underline">{t.openPost}</a>}</span></div>)}</div></section>}
  </div>}
  </>}
  {editing&&owner&&<form onSubmit={e=>{e.preventDefault();if(mutationsDisabled)return;try{const iso=editMode==='edit'?pragueScheduledAt(schedule.slice(0,10),schedule.slice(11,16)):'';void decide(editMode==='edit'?{action:'edit',id:editing.id,caption,scheduledAt:iso}:{action:'returned',id:editing.id,feedback},editing.id);}catch{setMessage(t.failed);}}} className="mt-5 space-y-3 rounded-lg border border-border bg-surface p-4">
   <h2 className="text-sm font-semibold">{editing.revision.title}</h2>
   {editMode==='edit'?<><label className="block text-xs">{t.caption}<Textarea className="mt-1" disabled={mutationsDisabled||busy===editing.id} value={caption} onChange={e=>setCaption(e.target.value)} required maxLength={2200}/></label><label className="block text-xs">{t.schedule}<Input type="datetime-local" className="mt-1" disabled={mutationsDisabled||busy===editing.id} value={schedule} onChange={e=>setSchedule(e.target.value)} required/></label></>:<label className="block text-xs">{t.feedback}<Textarea className="mt-1" disabled={mutationsDisabled||busy===editing.id} value={feedback} onChange={e=>setFeedback(e.target.value)} maxLength={2000}/></label>}
   <div className="flex gap-2"><Button disabled={mutationsDisabled||busy===editing.id}>{editMode==='edit'?t.save:t.return}</Button><Button type="button" variant="ghost" onClick={()=>setEditing(null)}>{t.cancel}</Button></div>
  </form>}
 </div>;
}
