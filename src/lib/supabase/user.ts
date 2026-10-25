import type { createClient } from './client';
import { awaitWithSignal } from '@/lib/abortable';
type BrowserClient = ReturnType<typeof createClient>;
export type UserIdentityScope = { ownerId: string; signal: AbortSignal };

/** Verify a user with an eight-second wait bound. An error never authorizes a
 * cached user. Captured-intent callers additionally pass their original owner
 * and lifetime; legacy callers still need that separate adoption. This bounds
 * the result, not an SDK transport that ignores cancellation. */
export async function currentUserId(supabase: BrowserClient, scope?: UserIdentityScope): Promise<string | null> {
 const expectedOwner = scope?.ownerId, parent = scope?.signal;
 const signal = AbortSignal.any([AbortSignal.timeout(8_000), ...(parent ? [parent] : [])]);
 try {
  signal.throwIfAborted();
  if (scope && (typeof expectedOwner !== 'string' || !expectedOwner.trim() || expectedOwner.length > 128)) return null;
  const result = await awaitWithSignal(supabase.auth.getUser(), signal); signal.throwIfAborted();
  const id = result.data?.user?.id;
  if (result.error || typeof id !== 'string' || !id.trim() || id !== id.trim() || id.length > 128 || (expectedOwner !== undefined && id !== expectedOwner)) return null;
  return id;
 } catch {
  if (parent?.aborted) throw new DOMException('Request aborted', 'AbortError');
  return null;
 }
}
