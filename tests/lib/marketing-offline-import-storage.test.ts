import { afterEach,describe,it,expect,vi } from 'vitest';
import { createMarketingAssetStorage } from '@/lib/marketing/worker-runtime';
import { offlineImportSha } from '@/lib/marketing/offline-import-validation';
import type { createAdminClient } from '@/lib/supabase/admin';
vi.mock('server-only',()=>({}));
afterEach(()=>vi.unstubAllEnvs());
describe('private upload deadline after awaited bucket check',()=>{
 it('does not start an upload when deadline aborts during getBucket',async()=>{
  const owner='11111111-1111-4111-8111-111111111111';vi.stubEnv('MARKETING_OWNER_ID',owner);
  const abort=new AbortController(),upload=vi.fn();
  const db={storage:{getBucket:async()=>{abort.abort();return{data:{public:false},error:null};},from:()=>({upload})}} as unknown as ReturnType<typeof createAdminClient>;
  const storage=createMarketingAssetStorage(db,owner,new Date(Date.now()+3600000).toISOString(),{signal:abort.signal});
  const bytes=Buffer.from('OFFLINE TRANSPORT ONLY'),sha=offlineImportSha(bytes);
  await expect(storage.put({key:`marketing/devshark/22222222-2222-4222-8222-222222222222/${'a'.repeat(64)}/1-${sha}.jpg`,bytes,sha256:sha,contentType:'image/jpeg',metadata:{revisionId:'22222222-2222-4222-8222-222222222222'}})).rejects.toMatchObject({code:'worker-timeout'});
  expect(upload).not.toHaveBeenCalled();
 });
});
