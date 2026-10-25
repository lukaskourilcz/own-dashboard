import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { readTextPrefix } from '@/lib/bounded-text';
import { calendarEventInput, calendarDeleteInput } from '@/lib/calendar-event';
import { safeWebUrl } from '@/lib/web-url';

type Scope = { ownerId: string; signal: AbortSignal };
const identifier = z.string().min(1).max(1024).refine(value => !/\p{Cc}/u.test(value));
const created = z.object({ id: identifier, ownerId: z.string(), htmlLink: z.string().max(2000).transform(value => safeWebUrl(value) ?? undefined).optional() }).strict();
const deleted = z.object({ ok: z.literal(true), ownerId: z.string() }).strict();
export class CalendarWriteError extends Error {
 constructor(readonly reason: 'expired' | 'unconfirmed' = 'unconfirmed') { super('Calendar result unconfirmed'); }
}
async function write(scope: Scope, method: 'POST' | 'DELETE', input: unknown) {
 const { ownerId, signal: parent } = scope, lifetime = new AbortController();
 let received: Response | undefined;
 const discardBody = () => { if (received?.body && !received.body.locked) void received.body.cancel().catch(() => undefined); };
 const signal = AbortSignal.any([parent, lifetime.signal, AbortSignal.timeout(25_000)]);
 try {
  signal.throwIfAborted();
  if (!ownerId || ownerId !== ownerId.trim() || ownerId.length > 128) throw new CalendarWriteError();
  const payload = method === 'POST' ? calendarEventInput.parse(input) : calendarDeleteInput.parse(input);
  const body = JSON.stringify(payload);
  if (new TextEncoder().encode(body).byteLength > 65_536) throw new CalendarWriteError();
  const pending = fetch('/api/calendar/event', { method, signal, cache: 'no-store', credentials: 'same-origin', redirect: 'error', headers: { 'content-type': 'application/json', 'x-calendar-owner': ownerId }, body }).then(response => { received = response; if (signal.aborted) discardBody(); return response; });
  const response = await awaitWithSignal(pending, signal);
  const prefix = await awaitWithSignal(readTextPrefix(response, 16_384, signal), signal);
  signal.throwIfAborted(); if (prefix.truncated) throw new CalendarWriteError();
  const value: unknown = JSON.parse(prefix.text);
  if (!response.ok) {
   const reason = z.object({ reason: z.enum(['no-token', 'expired']) }).safeParse(value);
   throw new CalendarWriteError(response.status === 401 && reason.success ? 'expired' : 'unconfirmed');
  }
  const receipt = method === 'POST' ? created.parse(value) : deleted.parse(value);
  if (receipt.ownerId !== ownerId) throw new CalendarWriteError();
  return receipt;
 } catch (error) {
  if (parent.aborted) throw new DOMException('Request aborted', 'AbortError');
  throw error instanceof CalendarWriteError ? error : new CalendarWriteError();
 } finally { lifetime.abort(); discardBody(); }
}

/** One explicit attempt only. An uncertain provider creation is never retried. */
export async function createOwnedCalendarEvent(scope: Scope, input: z.input<typeof calendarEventInput>) {
 return created.parse(await write(scope, 'POST', input));
}
export async function deleteOwnedCalendarEvent(scope: Scope, id: string): Promise<void> {
 if (!identifier.safeParse(id).success) throw new CalendarWriteError();
 deleted.parse(await write(scope, 'DELETE', { id }));
}
