import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';
import { boundedResponseText } from '@/lib/bounded-response';
import { CalendarImportSelectionSchema as selection, CalendarImportPreviewSchema as previewSchema, CalendarImportSavedSchema as savedSchema, calendarImportEndDate } from './calendar-import-contracts';

export type CalendarImportSelection = z.infer<typeof selection>;
export type CalendarImportPreview = z.infer<typeof previewSchema>;
export type CalendarImportScope = { ownerId: string; signal: AbortSignal };
export class CalendarImportError extends Error {
  constructor(readonly reason: 'changed' | 'unavailable' | 'unconfirmed' | 'invalid-source') { super('Calendar import unavailable'); }
}
function confirmPreview(value: unknown, scope: CalendarImportScope, intent: CalendarImportSelection) {
  const parsed = previewSchema.parse(value);
  if (parsed.ownerId !== scope.ownerId || parsed.campaign.brand !== intent.brand || parsed.campaign.starts_on !== intent.startsOn
    || parsed.campaign.ends_on !== calendarImportEndDate(intent.startsOn)) throw new Error();
  return parsed;
}
/** One original caller/response budget. No automatic retry or unbounded JSON. */
async function request<T>(scope: CalendarImportScope, body: object, apply: boolean, confirm: (value: unknown) => T): Promise<T> {
  const retirement = new AbortController();
  const signal = AbortSignal.any([scope.signal, retirement.signal, AbortSignal.timeout(65_000)]);
  const discard = (response: Response) => { if (response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); };
  let response: Response | undefined;
  try {
    signal.throwIfAborted(); z.uuid().parse(scope.ownerId);
    await Promise.resolve(); signal.throwIfAborted();
    const pending = fetch('/api/marketing/import', { method: 'POST', cache: 'no-store', redirect: 'error', signal, headers: { 'Content-Type': 'application/json', 'x-own-dashboard-owner': scope.ownerId }, body: JSON.stringify(body) });
    void pending.then(value => { if (signal.aborted) discard(value); }, () => undefined);
    response = await awaitWithSignal(pending, signal); signal.throwIfAborted();
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new Error();
    const value: unknown = JSON.parse(await boundedResponseText(response, response.status === 200 ? 1_100_000 : 4096, signal));
    if (response.status !== 200) {
      const error = z.strictObject({ error: z.string() }).safeParse(value);
      const changed = response.status === 409 && error.success && ['calendar-source-changed', 'calendar-import-preview-changed', 'calendar-import-owner-changed'].includes(error.data.error);
      const invalidSource = response.status === 400 && error.success && error.data.error === 'calendar-import-plan-invalid';
      throw new CalendarImportError(changed ? 'changed' : invalidSource ? 'invalid-source' : apply ? 'unconfirmed' : 'unavailable');
    }
    const result = confirm(value); signal.throwIfAborted(); return result;
  } catch (error) {
    if (response) discard(response);
    if (scope.signal.aborted) throw new DOMException('Request aborted', 'AbortError');
    throw error instanceof CalendarImportError ? error : new CalendarImportError(apply ? 'unconfirmed' : 'unavailable');
  } finally { retirement.abort(); }
}
export function previewCalendarImport(scope: CalendarImportScope, input: CalendarImportSelection) {
  const intent = selection.parse(input);
  return request(scope, { source: 'repository', ...intent, apply: false }, false, value => confirmPreview(value, scope, intent));
}
export function applyCalendarImport(scope: CalendarImportScope, input: CalendarImportSelection, value: CalendarImportPreview) {
  const intent = selection.parse(input), preview = confirmPreview(value, scope, intent);
  return request(scope, { source: 'repository', ...intent, apply: true, expectedHash: preview.campaign.source_hash, expectedImportHash: preview.importHash }, true, value => {
    const saved = savedSchema.parse(value);
    if (saved.ownerId !== scope.ownerId || saved.importHash !== preview.importHash || saved.sourceHash !== preview.campaign.source_hash || JSON.stringify(saved.report) !== JSON.stringify(preview.report)) throw new Error();
    return saved;
  });
}
