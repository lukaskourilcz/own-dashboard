import { describe,it,expect,vi } from 'vitest';
import { manualCollectionExpiry } from '@/lib/marketing/dneskai-manual';
import { DneskaiCollectInput } from '@/lib/marketing/dneskai-collection';
vi.mock('server-only',()=>({}));
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',run='33333333-3333-4333-8333-333333333333';
const scope={version:'dneskai-manual/1',ownerId:owner,projectId:project,runId:run,startsAt:'2026-10-13T20:00:00Z',expiresAt:'2026-10-13T21:00:00Z'};
const env={VERCEL_ENV:'production',MARKETING_OWNER_ID:owner,MARKETING_DNESKAI_MANUAL_RUN:JSON.stringify(scope)};
const now=new Date('2026-10-13T20:30:00Z');
describe('single registered production collection authority',()=>{
 it('grants only the exact production owner/project/run during its bounded window',()=>{
  expect(manualCollectionExpiry(owner,project,run,env,now)).toBe(Date.parse(scope.expiresAt));
  for(const args of [[project,project,run],[owner,owner,run],[owner,project,project],[owner,project,undefined]] as const)expect(manualCollectionExpiry(args[0],args[1],args[2],env,now)).toBeNull();
  for(const environment of [{...env,VERCEL_ENV:'preview'},{...env,MARKETING_OWNER_ID:project},{...env,MARKETING_DNESKAI_MANUAL_RUN:''},{...env,MARKETING_DNESKAI_MANUAL_RUN:'bad-json'}])expect(manualCollectionExpiry(owner,project,run,environment,now)).toBeNull();
 });
 it.each(['before','expired','invalid-date','too-long','reversed','budget-override'])('rejects %s without a fallback grant',kind=>{
  const changed={...scope,...(kind==='too-long'?{expiresAt:'2026-10-14T21:00:00Z'}:{}),...(kind==='reversed'?{expiresAt:scope.startsAt}:{}),...(kind==='budget-override'?{budgetUsd:100}:{})};
  const clock=kind==='before'?new Date('2026-10-13T19:59:59Z'):kind==='expired'?new Date(scope.expiresAt):kind==='invalid-date'?new Date(NaN):now;
  expect(manualCollectionExpiry(owner,project,run,{...env,MARKETING_DNESKAI_MANUAL_RUN:JSON.stringify(changed)},clock)).toBeNull();
 });
 it('requires an existing run and disallows mixed or caller-defined authority',()=>{
  expect(DneskaiCollectInput.safeParse({projectId:project,runId:run,manual:true}).success).toBe(true);
  for(const body of [{projectId:project,manual:true},{projectId:project,runId:run,manual:true,pilot:true},{projectId:project,runId:run,manual:true,expiresAt:scope.expiresAt}])expect(DneskaiCollectInput.safeParse(body).success).toBe(false);
 });
});
