import { describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { authenticateAutomation,signAutomationBody } from '@/lib/marketing/automation-auth';
import { authenticateN8n } from '@/lib/marketing/http';
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

const starts=Date.parse('2026-10-13T09:11:07Z');
const expires=Date.parse('2026-10-15T09:10:00Z');
const pilotEnv:Record<string,string|undefined>={...env,MARKETING_N8N_SECRET:secret,
 MARKETING_PILOT_OWNER_ID:env.MARKETING_OWNER_ID,MARKETING_PILOT_STARTS_AT:new Date(starts).toISOString(),MARKETING_PILOT_EXPIRES_AT:new Date(expires).toISOString()};
const body='{"action":"source"}';
function signed(at:number,credential=secret){return new Request('https://example.test/api/marketing/automation',{method:'POST',headers:signAutomationBody(body,credential,at),body});}
function n8n(credential=secret){return new Request('https://example.test/api/marketing/n8n',{headers:{Authorization:`Bearer ${credential}`,Cookie:'deployment=test-only'}});}
describe('bounded marketing pilot key admission',()=>{
 it.each([[starts-1,false],[starts,true],[expires-1,true],[expires,false],[expires+1,false]])('enforces exact start/end boundary at %i', (at,allowed)=>{
  expect(authenticateN8n(n8n(),pilotEnv,new Date(at))).toBe(allowed?env.MARKETING_OWNER_ID:null);
  expect(authenticateAutomation(signed(at),body,pilotEnv,at)).toEqual(allowed?{ownerId:env.MARKETING_OWNER_ID,brand:'devshark',role:'source'}:null);
 });
 it.each([
  {MARKETING_PILOT_OWNER_ID:env.MARKETING_OWNER_ID,MARKETING_PILOT_STARTS_AT:undefined,MARKETING_PILOT_EXPIRES_AT:undefined},
  {MARKETING_PILOT_OWNER_ID:undefined,MARKETING_PILOT_STARTS_AT:new Date(starts).toISOString(),MARKETING_PILOT_EXPIRES_AT:undefined},
  {MARKETING_PILOT_OWNER_ID:undefined,MARKETING_PILOT_STARTS_AT:undefined,MARKETING_PILOT_EXPIRES_AT:new Date(expires).toISOString()},
  {MARKETING_PILOT_OWNER_ID:'not-a-uuid'},
  {MARKETING_PILOT_STARTS_AT:'yesterday'},
  {MARKETING_PILOT_EXPIRES_AT:''},
  {MARKETING_PILOT_EXPIRES_AT:new Date(starts).toISOString()},
  {MARKETING_PILOT_EXPIRES_AT:new Date(starts+48*3600000+1).toISOString()},
  {MARKETING_PILOT_OWNER_ID:'22222222-2222-4222-8222-222222222222'},
 ])('rejects partial, malformed or foreign pilot configuration %j',(patch)=>{
  const values={...pilotEnv,...patch};
  expect(authenticateN8n(n8n(),values,new Date(starts))).toBeNull();
  expect(authenticateAutomation(signed(starts),body,values,starts)).toBeNull();
 });
 it.each([
  ['MARKETING_DNESKAI_SECRET','dneskai','source'],['MARKETING_DEVSHARK_SECRET','devshark','source'],
  ['MARKETING_WORKER_SECRET',null,'worker'],['MARKETING_PUBLISH_SECRET',null,'publisher'],
 ] as const)('preserves %s role/brand only during the active pilot', (name,brand,role)=>{
  const credential=`test-only-${name}`.repeat(2);const values={...pilotEnv,MARKETING_DEVSHARK_SECRET:undefined,[name]:credential};
  expect(authenticateAutomation(signed(starts,credential),body,values,starts)).toEqual({ownerId:env.MARKETING_OWNER_ID,brand,role});
  expect(authenticateAutomation(signed(expires,credential),body,values,expires)).toBeNull();
 });
 it('preserves ordinary authentication when every pilot variable is absent',()=>{
  const values={...env,MARKETING_N8N_SECRET:secret,VERCEL_ENV:'production'};
  expect(authenticateN8n(n8n(),values,new Date(expires+86400000))).toBe(env.MARKETING_OWNER_ID);
  expect(authenticateAutomation(signed(expires+86400000),body,values,expires+86400000)).toEqual({ownerId:env.MARKETING_OWNER_ID,brand:'devshark',role:'source'});
 });
 it('does not admit wrong keys or tampered signatures through a valid pilot',()=>{
  expect(authenticateN8n(n8n('wrong-secret'),pilotEnv,new Date(starts))).toBeNull();
  expect(authenticateAutomation(signed(starts),body+' ',pilotEnv,starts)).toBeNull();
  expect(authenticateAutomation(signed(starts,'wrong-secret'),body,pilotEnv,starts)).toBeNull();
 });
 it('rejects invalid clocks rather than bypassing date comparisons',()=>{
  expect(authenticateN8n(n8n(),pilotEnv,new Date(NaN))).toBeNull();
  expect(authenticateAutomation(signed(starts),body,pilotEnv,NaN)).toBeNull();
 });
});
