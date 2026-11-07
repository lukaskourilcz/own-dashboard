import { z } from 'zod';
import { DevsharkDeckSchema } from './devshark-deck';

/**
 * The devShark studio's read model and client calls (owner request, 7 November 2026). Browser-safe: the studio tab
 * validates every answer with these schemas. Concepts are edited, rendered as a preview without storing anything,
 * saved (which returns them to review) and approved; only approved concepts enter the plan.
 */
export const DEVSHARK_DRAFT_STATUSES = ['draft', 'approved', 'rejected', 'planned', 'published'] as const;
export type DevsharkDraftStatus = (typeof DEVSHARK_DRAFT_STATUSES)[number];

export const DevsharkDraftSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(160),
  deck: DevsharkDeckSchema,
  caption: z.string().min(1).max(2200),
  origin: z.enum(['concept', 'generated']),
  status: z.enum(DEVSHARK_DRAFT_STATUSES),
  decided_at: z.string().nullable(),
  created_at: z.string(),
});
export type DevsharkDraft = z.infer<typeof DevsharkDraftSchema>;
export const DevsharkDraftsReadSchema = z.object({
  // A generated concept the model got wrong is stored rejected with no slides (its cost still counts); the studio skips it.
  drafts: z.array(z.unknown()).max(100).transform((items) => items.flatMap((item) => { const parsed = DevsharkDraftSchema.safeParse(item); return parsed.success ? [parsed.data] : []; })),
  plan: z.array(z.object({ draft_id: z.uuid(), date: z.string(), local_time: z.string(), instagram: z.boolean(), threads: z.boolean(), status: z.string(), code: z.string().nullable() })).max(200),
});
export type DevsharkDraftsRead = z.infer<typeof DevsharkDraftsReadSchema>;
export const DevsharkPreviewSchema = z.object({ slides: z.array(z.object({ src: z.string().startsWith('data:image/jpeg;base64,'), alt: z.string() })).min(1).max(8) });
export type DevsharkPreview = z.infer<typeof DevsharkPreviewSchema>;
export const DevsharkSaveSchema = z.strictObject({ id: z.uuid(), title: z.string().trim().min(1).max(160), caption: z.string().trim().min(1).max(2200), deck: DevsharkDeckSchema });

export const devsharkEditable = (status: DevsharkDraftStatus) => status === 'draft' || status === 'approved' || status === 'rejected';

class DevsharkStudioError extends Error { constructor(readonly code: string) { super(code); } }
async function call<T>(input: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try { response = await fetch(input, { ...init, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } }); }
  catch { throw new DevsharkStudioError('network-unavailable'); }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new DevsharkStudioError(body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `http-${response.status}`);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new DevsharkStudioError('response-unreadable');
  return parsed.data;
}
export const devsharkStudioErrorCode = (error: unknown) => error instanceof DevsharkStudioError ? error.code : 'action-failed';

export const fetchDevsharkDrafts = () => call('/api/marketing/devshark/drafts', { method: 'GET' }, DevsharkDraftsReadSchema);
export const renderDevsharkPreview = (deck: z.infer<typeof DevsharkDeckSchema>) => call('/api/marketing/devshark/preview', { method: 'POST', body: JSON.stringify({ deck }) }, DevsharkPreviewSchema);
export const saveDevsharkDraft = (value: z.infer<typeof DevsharkSaveSchema>) => call('/api/marketing/devshark/drafts', { method: 'PUT', body: JSON.stringify(value) }, z.object({ id: z.uuid(), status: z.literal('draft') }));
export const decideDevsharkDraft = (id: string, decision: 'approved' | 'rejected' | 'draft') => call('/api/marketing/devshark/drafts', { method: 'POST', body: JSON.stringify({ id, decision }) }, z.object({ id: z.uuid(), status: z.string() }));
