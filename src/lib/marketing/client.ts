import type { MarketingRevisionRow, PublicationRow } from './contracts';
import type { MarketingSourceSummary } from './source-summary';
import { type MarketingJobHealth } from './job-health';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';
import { MARKETING_STATE_MAX_BYTES, MarketingStateEnvelopeSchema } from './state-contracts';
export type MarketingState={
 revisions:Array<MarketingRevisionRow & {ready:boolean;offline_import_receipt?:{schemaVersion?:string;holdCode?:string}|null}>;
 campaigns:Array<{id:string;brand:string;name:string;starts_on:string;ends_on:string;source_hash:string;status:string}>;
 entries:Array<{id:string;campaign_id:string;date:string;local_time:string|null;bound_source_id:string|null;brand?:string;title:string;kind:string;platform:string;status:string;needs_review:boolean}>;
 publications:Array<PublicationRow & {revision_id:string}>;
 accounts:Array<{brand:string;platform:string;remote_account_id:string;handle:string;enabled:boolean;verified_at:string|null}>;
 sources:Array<{id:string;brand:string;source_id:string;packet:MarketingSourceSummary;eligible:boolean}>;
 sourceHistory:MarketingSourceSummary[];
 jobs:Array<{id:string;status:string;errorCode:string|null;createdAt:string;brand:string|null;costUsd:number|null}>;
 jobHealth?:MarketingJobHealth[];
 diagnostics:{sampleSize:number;firstApprovalRate:number|null};
};
export const EMPTY_MARKETING_STATE:MarketingState={revisions:[],campaigns:[],entries:[],publications:[],accounts:[],sources:[],sourceHistory:[],jobs:[],jobHealth:[],diagnostics:{sampleSize:0,firstApprovalRate:null}};
export async function loadMarketingState(parent: AbortSignal, ownerId: string): Promise<MarketingState> {
 const retirement = new AbortController();
 const signal = AbortSignal.any([parent, retirement.signal, AbortSignal.timeout(35_000)]);
 const discard = (response: Response) => { if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
 let response: Response | undefined;
 try {
  signal.throwIfAborted(); z.uuid().parse(ownerId);
  await Promise.resolve(); signal.throwIfAborted();
  const pending = fetch('/api/marketing/state', { cache: 'no-store', redirect: 'error', signal, headers: { 'x-own-dashboard-owner': ownerId } });
  void pending.then(value => { if (signal.aborted) discard(value); }, () => undefined);
  response = await awaitWithSignal(pending, signal); signal.throwIfAborted();
  if (response.redirected || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new Error();
  const value: unknown = JSON.parse(await boundedResponseText(response, response.status === 200 ? MARKETING_STATE_MAX_BYTES : 4096, signal));
  if (response.status !== 200) throw new Error();
  const { ownerId: receivedOwner, ...state } = MarketingStateEnvelopeSchema.parse(value);
  if (receivedOwner !== ownerId) throw new Error();
  signal.throwIfAborted(); return state;
 } catch {
  if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw new Error('marketing-unavailable');
 } finally { retirement.abort(); if (response) discard(response); }
}
export async function marketingDecision(input:unknown){
 const response=await fetch('/api/marketing/revisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
 if(!response.ok)throw new Error('decision-failed');
 return response.json();
}
