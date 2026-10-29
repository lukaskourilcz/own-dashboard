import { expect, it } from 'vitest';
import { ownerRestIdentityMatches as matches } from '@/lib/owner-rest-identity';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const backend = 'https://backend.example/proxy/', origin = 'https://dashboard.example';
const rest = `${backend}rest/v1/notes?select=*`;
const token = (claims: unknown) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.TEST-ONLY`;
const headers = (id = owner) => ({ Authorization: `Bearer ${token({ sub: id, user_metadata: { id: other } })}` });
it.each([rest, `${backend}rest/v1`, `${backend}rest/v1/rpc/synthetic`])('checks table and RPC authority at %s', url => {
 expect(matches(url, { headers: headers() }, backend, origin, owner)).toBe(true);
 expect(matches(url, { headers: headers(other) }, backend, origin, owner)).toBe(false);
});
it('uses effective Request headers and full init replacement', () => {
 const request = new Request(rest, { headers: headers() });
 expect(matches(request, undefined, backend, origin, owner)).toBe(true);
 expect(matches(request, { headers: headers(other) }, backend, origin, owner)).toBe(false);
 expect(matches(request, { headers: {} }, backend, origin, owner)).toBe(false);
 expect(matches(new Request(rest, { headers: headers(other) }), { headers: new Headers(headers()) }, backend, origin, owner)).toBe(true);
 expect(matches(new URL(rest), { headers: [['authorization', `bearer ${token({ sub: owner })}`]] }, backend, origin, owner)).toBe(true);
});
it.each([undefined, '', 'Bearer public-key', 'Basic synthetic', 'Bearer e30.bad.BAD', `Bearer ${token(null)}`, `Bearer ${token([])}`, `Bearer ${token({ user_metadata: { sub: owner } })}`, `Bearer ${token({ sub: other, user_metadata: { sub: owner } })}`, `Bearer ${token({ sub: 123 })}`, `Bearer e30.${'A'.repeat(65_536)}.TEST`, 'Bearer e30._w.TEST'])('refuses absent, malformed, oversized or foreign REST claims (%#)', authorization => {
 expect(matches(rest, { headers: authorization === undefined ? {} : { authorization } }, backend, origin, owner)).toBe(false);
});
it.each(['/api/calendar/events', '/auth/signout', '/brand/mark.svg', 'https://elsewhere.example/rest/v1/notes', `${backend}rest/v10/notes`, `${backend}rest/v1-extra`, `${backend}auth/v1/user`, `${backend}storage/v1/object/upload/sign/synthetic`, `${backend}functions/v1/synthetic`])('does not reinterpret other endpoints or signed storage authority: %s', url => {
 expect(matches(url, { headers: { Authorization: 'Bearer narrow-synthetic-upload' } }, backend, origin, owner)).toBe(true);
});
it('ignores user metadata, handles UTF-8 claims and never accepts a missing server owner', () => {
 const init = { headers: { authorization: `Bearer ${token({ sub: owner, user_metadata: { name: 'Český účet', sub: other } })}` } };
 expect(matches(rest, init, backend, origin, owner)).toBe(true); expect(matches(rest, init, backend, origin, undefined)).toBe(false);
});
