/** A negative-only transport check for an already server-verified workspace.
 * Decoding a claim never authenticates a user: PostgREST still verifies the JWT
 * and RLS still authorizes every row. A changed/missing REST identity can only
 * retire the old workspace, never grant or switch its owner. */
export function ownerRestIdentityMatches(input: RequestInfo | URL, init: RequestInit | undefined, backend: string | undefined, origin: string, ownerId: string | undefined): boolean {
 if (!backend) return true;
 let url: URL, base: URL;
 try {
  url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
  base = new URL(backend);
 } catch { return false; }
 const rest = `${base.pathname.replace(/\/$/, '')}/rest/v1`;
 if (url.origin !== base.origin || (url.pathname !== rest && !url.pathname.startsWith(`${rest}/`))) return true;
 try {
  // Fetch replaces Request headers when init.headers is supplied; it does not
  // merge the two sets. Inspect the authority that will actually be sent.
  const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
  const authorization = headers.get('authorization');
  if (!ownerId || !authorization || authorization.length > 65_536) return false;
  const bearer = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/i.exec(authorization);
  if (!bearer) return false;
  const payload = bearer[2].replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0));
  const claims: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return typeof claims === 'object' && claims !== null && 'sub' in claims && claims.sub === ownerId;
 } catch { return false; }
}
