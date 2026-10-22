import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoDneskaiWorkspaceApi, resetDemoDneskaiWorkspace } from '@/lib/demo/dneskai-workspace-demo';
import { createDeckDraft, dneskaiEditRequest } from '@/lib/marketing/dneskai-deck-editor';
import { POST } from '@/app/api/dev-preview/dneskai-render/route';
import fixtures from '@/lib/demo/dneskai-preview-assets.json';
vi.mock('server-only', () => ({}));
const url='https://own.example/api/dev-preview/dneskai-render';
const request=(value:unknown,origin='https://own.example')=>new Request(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
const deck=()=>({schemaVersion:'dneskai-slides/1',format:'single-image',slides:fixtures.decks.b.map(item=>item.slide)});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();resetDemoDneskaiWorkspace();});
describe('fixture-only renderer',()=>{
 it('is unavailable in ordinary production and refuses cross-origin, malformed and unknown-image input',async()=>{
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('NEXT_E2E','');
  expect((await POST(request(deck()))).status).toBe(404);
  vi.stubEnv('NEXT_E2E','1');
  expect((await POST(request(deck(),'https://evil.example'))).status).toBe(403);
  expect((await POST(request({...deck(),extra:true}))).status).toBe(400);
  const bad=structuredClone(deck());bad.slides[0]!.images[0]!.assetSha256='0'.repeat(64);
  expect((await POST(request(bad))).status).toBe(400);
 });
 it('renders exact fixture bytes at full size and changes their digest after a text edit',async()=>{
  const first=await POST(request(deck()));expect(first.status).toBe(200);
  const original=await first.json();expect(original).toMatchObject({ready:true,assets:[{width:1080,height:1350}]});
  const changed=structuredClone(deck());changed.slides[0]!.headline='Krátký ukázkový titulek';
  const edited=await(await POST(request(changed))).json();
  expect(edited.ready).toBe(true);expect(edited.assets[0].sha256).not.toBe(original.assets[0].sha256);
  expect(edited.assets[0].url).toMatch(/^data:image\/jpeg;base64,/);
 });
});

it('renders a saved demo version whose assets never attached, even with no deck changes', async()=>{
 resetDemoDneskaiWorkspace();
 vi.stubGlobal('fetch',async (_input:unknown,init:RequestInit)=>POST(new Request(url,{...init,headers:{Origin:'https://own.example','Content-Type':'application/json'}})));
 const read=await demoDneskaiWorkspaceApi.loadReview('fixture');
 const post=read.posts.find(item=>item.title==='Co stojí jeden dotaz')!;
 expect(post.assets).toEqual([]);
 const result=await demoDneskaiWorkspaceApi.edit(dneskaiEditRequest(post,createDeckDraft(post)));
 expect(result.ready).toBe(true);
 const saved=(await demoDneskaiWorkspaceApi.loadReview('fixture')).posts.find(item=>item.id===result.id)!;
 expect(saved.assets).toHaveLength(saved.deck!.slides.length);
 expect(saved.assets.every(asset=>asset.width===1080&&asset.height===1350)).toBe(true);
});
