import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({user:vi.fn(),create:vi.fn(),project:vi.fn(),review:vi.fn(),costs:vi.fn(),media:vi.fn(),admin:vi.fn(),spend:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase/server',()=>({createClient:m.create}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:m.admin}));
vi.mock('@/lib/marketing/dneskai-store',()=>({requireDneskaiProject:m.project}));
vi.mock('@/lib/marketing/dneskai-workspace-read',()=>({DNESKAI_COST_RANGES:['1d','2d','3d','4d','5d','6d','7d'],readDneskaiWorkspace:m.review,readDneskaiCosts:m.costs}));
vi.mock('@/lib/marketing/dneskai-media',()=>({readDneskaiMedia:m.media}));
import {GET as review} from '@/app/api/marketing/dneskai/review/route';
import {GET as costs} from '@/app/api/marketing/dneskai/costs/route';
import {GET as media} from '@/app/api/marketing/dneskai/media/route';
const owner='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222';
const identity={data:{user:{id:owner}},error:null};
const routes=[['review',review,m.review,'dneskai-workspace-unavailable'],['costs',costs,m.costs,'dneskai-costs-unavailable'],['media',media,m.media,'media-unavailable']]as const;
const request=(kind:string,signal?:AbortSignal)=>new Request(`https://own.example/api/marketing/dneskai/${kind}?projectId=${project}`,{signal});
beforeEach(()=>{
 vi.resetAllMocks();m.user.mockResolvedValue(identity);m.create.mockResolvedValue({auth:{getUser:m.user}});m.project.mockResolvedValue({id:project,user_id:owner});
 m.review.mockResolvedValue({schemaVersion:'TEST_ONLY_REVIEW'});m.costs.mockResolvedValue({schemaVersion:'TEST_ONLY_COSTS'});m.media.mockResolvedValue({schemaVersion:'TEST_ONLY_MEDIA'});m.spend.mockResolvedValue({data:0,error:null});
 m.admin.mockImplementation(()=>({rpc:()=>{const query={retry:()=>query,abortSignal:()=>query,then:(resolve:(value:unknown)=>unknown,reject:(error:unknown)=>unknown)=>Promise.resolve(m.spend()).then(resolve,reject)};return query;}}));
});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
for(const [kind,route,read,unavailable]of routes)describe(`${kind} read admission`,()=>{
 it('refuses an auth error accompanying a cached user before any owned read',async()=>{
  m.user.mockResolvedValue({data:identity.data,error:{status:401,message:'PRIVATE_AUTH_DETAIL'}});
  const result=await route(request(kind));expect(result.status).toBe(401);expect(await result.json()).toEqual({error:'unauthorized'});expect(m.project).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();expect(m.admin).not.toHaveBeenCalled();
 });
 it('distinguishes an auth outage from sign-in without leaking diagnostics',async()=>{
  m.user.mockResolvedValue({data:identity.data,error:{status:500,message:'PRIVATE_AUTH_DETAIL'}});
  const result=await route(request(kind));expect(result.status).toBe(503);expect(await result.json()).toEqual({error:unavailable});expect(m.project).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });
 it('contains a rejected authentication wait',async()=>{
  m.user.mockRejectedValue(Error('PRIVATE_AUTH_DETAIL'));const result=await route(request(kind));expect(result.status).toBe(503);expect(await result.json()).toEqual({error:unavailable});expect(read).not.toHaveBeenCalled();
 });
 it('refuses a retired request before creating a client',async()=>{
  const controller=new AbortController();controller.abort('PRIVATE_ABORT_REASON');const result=await route(request(kind,controller.signal));expect(result.status).toBe(503);expect(await result.json()).toEqual({error:unavailable});expect(m.create).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });
 it('does not start later reads after cancellation during authentication',async()=>{
  let finish!:(value:typeof identity)=>void;m.user.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const controller=new AbortController();const pending=route(request(kind,controller.signal));
  await vi.waitFor(()=>expect(m.user).toHaveBeenCalledOnce());controller.abort();
  try{const result=await Promise.race([pending,new Promise<'pending'>(resolve=>setTimeout(()=>resolve('pending'),80))]);expect(result).not.toBe('pending');if(result!=='pending'){expect(result.status).toBe(503);expect(await result.json()).toEqual({error:unavailable});}}
  finally{finish(identity);await pending;}
  expect(m.project).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });
 it('keeps a confirmed missing session distinct',async()=>{
  m.user.mockResolvedValue({data:{user:null},error:null});const result=await route(request(kind));expect(result.status).toBe(401);expect(m.project).not.toHaveBeenCalled();
 });
 it('keeps a project read outage distinct from confirmed absence',async()=>{
  m.project.mockRejectedValueOnce(Error('collection-project-read-unavailable'));
  let result=await route(request(kind));expect(result.status).toBe(503);expect(await result.json()).toEqual({error:unavailable});expect(read).not.toHaveBeenCalled();
  m.project.mockRejectedValueOnce(Error('collection-project-unavailable'));
  result=await route(request(kind));expect(result.status).toBe(404);expect(await result.json()).toEqual({error:'project-unavailable'});expect(read).not.toHaveBeenCalled();
 });
 it('starts no later work after retirement during the project read',async()=>{
  const controller=new AbortController();m.project.mockImplementationOnce(async()=>{controller.abort();return{id:project,user_id:owner};});
  const result=await route(request(kind,controller.signal));expect(result.status).toBe(503);expect(read).not.toHaveBeenCalled();expect(m.admin).not.toHaveBeenCalled();
 });
 it('does not return a successful late owned read after caller retirement',async()=>{
  let finish!:(value:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const controller=new AbortController(),pending=route(request(kind,controller.signal));
  await vi.waitFor(()=>expect(read).toHaveBeenCalledOnce());controller.abort();
  try{const result=await Promise.race([pending,new Promise<'pending'>(resolve=>setTimeout(()=>resolve('pending'),80))]);expect(result).not.toBe('pending');if(result!=='pending'){expect(result.status).toBe(503);expect(await result.json()).toEqual({error:unavailable});}}
  finally{finish({schemaVersion:'TEST_ONLY_LATE_RESULT'});await pending;}
 });
 it('counts earlier auth/project/spend waits against the original response allowance',async()=>{
  vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;});
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  m.user.mockImplementationOnce(async()=>{await wait(9000);return identity;});m.project.mockImplementationOnce(async()=>{await wait(4000);return{id:project,user_id:owner};});
  m.spend.mockImplementationOnce(async()=>{await wait(2000);return{data:0,error:null};});
  let finish!:(value:unknown)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));let settled=false;
  const pending=route(request(kind)).then(value=>{settled=true;return value;});
  await vi.advanceTimersByTimeAsync(24_999);expect(read).toHaveBeenCalledOnce();expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);const result=await pending;expect(result.status).toBe(503);expect(await result.json()).toEqual({error:unavailable});finish({schemaVersion:'TEST_ONLY_LATE_RESULT'});await Promise.resolve();
 });
});

it('keeps unreadable spend unknown without discarding confirmed costs',async()=>{
 m.spend.mockResolvedValueOnce({data:null,error:{message:'PRIVATE_SPEND_DETAIL'}});const result=await costs(request('costs'));expect(result.status).toBe(200);
 expect(m.costs.mock.calls[0]![4]).toMatchObject({spentUsd:null,code:'dneskai-daily-generation-budget-unavailable'});
});
it('does not admit costs after retirement during the service spend read',async()=>{
 const controller=new AbortController();m.spend.mockImplementationOnce(async()=>{controller.abort();return{data:0,error:null};});const result=await costs(request('costs',controller.signal));expect(result.status).toBe(503);expect(m.costs).not.toHaveBeenCalled();
});
