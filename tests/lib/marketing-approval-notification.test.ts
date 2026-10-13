import { describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { notifyMarketingApproval } from '@/lib/marketing/approval-notification';
const id='11111111-1111-4111-8111-111111111111';
const env={MARKETING_N8N_APPROVAL_WEBHOOK_URL:'https://bambambaklawa.app.n8n.cloud/webhook/approval',MARKETING_N8N_WEBHOOK_SECRET:'a'.repeat(32)};
describe('committed approval notification',()=>{
 it('sends only the locally committed publication identity to the exact n8n host',async()=>{const transport=vi.fn<typeof fetch>(async()=>new Response(null,{status:200}));expect(await notifyMarketingApproval(id,{env,transport})).toBe('notified');expect(JSON.parse(transport.mock.calls[0][1]!.body as string)).toEqual({publicationId:id});expect(transport.mock.calls[0][1]!.redirect).toBe('error');});
 it('does not forward integration credentials to arbitrary hosts or redirects',async()=>{const transport=vi.fn();for(const url of ['https://elsewhere.invalid/webhook/approval','https://bambambaklawa.app.n8n.cloud.evil.invalid/webhook/approval','https://name:password@bambambaklawa.app.n8n.cloud/webhook/approval','https://bambambaklawa.app.n8n.cloud/webhook/approval?token=secret'])expect(await notifyMarketingApproval(id,{env:{...env,MARKETING_N8N_APPROVAL_WEBHOOK_URL:url},transport})).toBe('pending');expect(transport).not.toHaveBeenCalled();});
 it('keeps approval independent from absent or failed scheduling',async()=>{expect(await notifyMarketingApproval(id,{env:{}})).toBe('unconfigured');expect(await notifyMarketingApproval(id,{env,transport:vi.fn(async()=>{throw new Error('private transport details');})})).toBe('pending');});
});
