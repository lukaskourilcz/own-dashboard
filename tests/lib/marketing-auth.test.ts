import { describe,expect,it } from 'vitest';
import { authenticateAutomation,signAutomationBody } from '@/lib/marketing/automation-auth';
const secret='a'.repeat(40);const now=Date.now();
const env={MARKETING_OWNER_ID:'11111111-1111-4111-8111-111111111111',MARKETING_DEVSHARK_SECRET:secret};
describe('marketing integration access',()=>{
 it('binds a signed producer to its owner and brand',()=>{
  const body='{"action":"source"}';const req=new Request('https://example.com',{method:'POST',headers:signAutomationBody(body,secret,now),body});
  expect(authenticateAutomation(req,body,env,now)).toEqual({ownerId:env.MARKETING_OWNER_ID,brand:'devshark',role:'source'});
  expect(authenticateAutomation(req,body+' ',env,now)).toBeNull();
  expect(authenticateAutomation(req,body,env,now+301000)).toBeNull();
 });
});
