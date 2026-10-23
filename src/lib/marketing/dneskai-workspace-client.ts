import { z } from 'zod';
import { DneskaiMediaReadSchema, type DneskaiMediaRead } from './dneskai-media-contracts';
import { loadMarketingAccounts, type MarketingAccountStatus } from './accounts-client';
import { DneskaiRenderProblemSchema } from './contracts';
import { DneskaiCostsReadSchema, DneskaiWorkspaceReadSchema, type DneskaiCostsRead, type DneskaiWorkspaceRead } from './dneskai-workspace';
import type { DneskaiEditRequest } from './dneskai-deck-editor';
import { DneskaiApproveManyResultSchema, DneskaiFitResultSchema, DneskaiPreviewResultSchema, type DneskaiApproveManyResult, type DneskaiFitRequest, type DneskaiFitResult, type DneskaiPreviewRequest, type DneskaiPreviewResult } from './dneskai-lab';
import type { DneskaiDecisionCursor } from './dneskai-workspace';
import { qk } from '@/lib/queries/keys';
import { MARKETING_PUBLICATION_REQUEUE_RESULTS, type MarketingPublicationRequeueResult } from './publication-requeue';

/**
 * The browser side of the DNESKAi workspace (#119). Every read and decision goes through this port, so the
 * deterministic `/dev-preview` harness can stand in for the server (`src/lib/demo/dneskai-workspace-demo.ts`).
 */
export class DneskaiWorkspaceRequestError extends Error {
  /** `revisionId`: the version an edit saved before it failed (502 render-attach-failed), so the editor can move to it. */
  constructor(readonly code: string, readonly status: number, readonly revisionId: string | null = null) { super(code); this.name = 'DneskaiWorkspaceRequestError'; }
}

export const DneskaiEditResultSchema = z.strictObject({
  id: z.uuid(),
  ready: z.boolean(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  render: z.strictObject({ status: z.enum(['rendered', 'refused', 'failed']), problems: z.array(DneskaiRenderProblemSchema).max(100) }),
});
export type DneskaiEditResult = z.infer<typeof DneskaiEditResultSchema>;
export const DneskaiPublishNowResultSchema = z.object({ id: z.uuid(), scheduledAt: z.iso.datetime({ offset: true }) });
export type DneskaiPublishNowResult = z.infer<typeof DneskaiPublishNowResultSchema>;
/** A paid owner action (regenerate, generate now): the job, and whether it was drafted within the request. */
export const DneskaiPaidActionResultSchema = z.object({
  jobId: z.uuid(),
  status: z.enum(['review', 'queued', 'failed']),
  revisionId: z.uuid().nullable().optional(),
  errorCode: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/).optional(),
});
export type DneskaiPaidActionResult = z.infer<typeof DneskaiPaidActionResultSchema>;

export interface DneskaiWorkspaceApi {
  /** True in the deterministic preview: nothing reaches a server. */
  readonly preview: boolean;
  loadReview(projectId: string, signal?: AbortSignal, before?: DneskaiDecisionCursor): Promise<DneskaiWorkspaceRead>;
  loadCosts(projectId: string, signal?: AbortSignal): Promise<DneskaiCostsRead>;
  loadMedia(projectId: string, candidateId: string, signal?: AbortSignal): Promise<DneskaiMediaRead>;
  loadAccounts(signal?: AbortSignal): Promise<MarketingAccountStatus[]>;
  approve(id: string, expectedHash: string): Promise<void>;
  /** „Publish now“: approves exactly this saved version for a time two minutes ahead; the next tick publishes it. */
  publishNow(id: string, expectedHash: string): Promise<DneskaiPublishNowResult>;
  /** „Moved, approve again“: this saved version moved to `scheduledAt`, the next free slot the owner was shown, and approved. */
  approveAt(id: string, expectedHash: string, scheduledAt: string): Promise<DneskaiPublishNowResult>;
  /** „Regenerate with a note“: a new draft of the same topic with the note as feedback (≈ $0.02, never approved). */
  regenerate(id: string, expectedHash: string, note: string): Promise<DneskaiPaidActionResult>;
  /** „Generate now“: admits a waiting topic now and drafts it, under the daily ceiling. */
  generateNow(briefId: string): Promise<DneskaiPaidActionResult>;
  edit(request: DneskaiEditRequest): Promise<DneskaiEditResult>;
  decide(id: string, action: 'returned' | 'skipped', feedback?: string): Promise<void>;
  /** „Approve the day“: each post bound to its own hash; one refusal never blocks the others. */
  approveMany(posts: ReadonlyArray<{ id: string; contentHash: string }>): Promise<DneskaiApproveManyResult>;
  /** Text fit feedback before saving ($0, no model call, nothing stored). */
  fit(request: DneskaiFitRequest, signal?: AbortSignal): Promise<DneskaiFitResult>;
  /** approval-04: give up on a stranded, provably unpublished publication and queue its approved post again. */
  requeuePublication(id: string): Promise<MarketingPublicationRequeueResult>;
  /** One slide of the unsaved draft as real pixels (REN-01): $0, nothing stored, never approvable. */
  renderPreview(request: DneskaiPreviewRequest, signal?: AbortSignal): Promise<DneskaiPreviewResult>;
}

const codeShape = /^[a-z][a-z0-9_-]{0,99}$/;
async function failure(response: Response): Promise<DneskaiWorkspaceRequestError> {
  let code = 'decision-failed';
  let revisionId: string | null = null;
  try {
    const body = await response.json() as { error?: unknown; reason?: unknown; id?: unknown };
    // An approval refusal names its reason (`render-blocked`, `revision-changed`, …); prefer it over the generic code.
    const reason = typeof body.reason === 'string' && codeShape.test(body.reason) ? body.reason : null;
    code = reason ?? (typeof body.error === 'string' && codeShape.test(body.error) ? body.error : code);
    revisionId = z.uuid().safeParse(body.id).data ?? null;
  } catch { /* the generic code stays */ }
  return new DneskaiWorkspaceRequestError(response.status === 429 ? 'rate-limited' : code, response.status, revisionId);
}
async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw await failure(response);
  return response.json();
}
async function post(body: unknown, url = '/api/marketing/revisions', signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, { signal, method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new DneskaiWorkspaceRequestError('decision-failed', 0); }
  if (!response.ok) throw await failure(response);
  return response.json().catch(() => ({}));
}

export const liveDneskaiWorkspaceApi: DneskaiWorkspaceApi = {
  preview: false,
  async loadReview(projectId, signal, before) {
    const params = new URLSearchParams({ projectId });
    if (before) params.set('before', JSON.stringify(before));
    return DneskaiWorkspaceReadSchema.parse(await getJson(`/api/marketing/dneskai/review?${params}`, signal));
  },
  async loadCosts(projectId, signal) {
    return DneskaiCostsReadSchema.parse(await getJson(`/api/marketing/dneskai/costs?projectId=${encodeURIComponent(projectId)}`, signal));
  },
  async loadMedia(projectId, candidateId, signal) {
    const query = new URLSearchParams({ projectId, candidateId });
    return DneskaiMediaReadSchema.parse(await getJson(`/api/marketing/dneskai/media?${query}`, signal));
  },
  loadAccounts: (signal) => loadMarketingAccounts(signal),
  async approve(id, expectedHash) { await post({ action: 'approve', id, expectedHash }); },
  async publishNow(id, expectedHash) {
    const result = DneskaiPublishNowResultSchema.safeParse(await post({ action: 'publish-now', id, expectedHash }));
    if (!result.success) throw new DneskaiWorkspaceRequestError('approval-unavailable', 502);
    return result.data;
  },
  async approveAt(id, expectedHash, scheduledAt) {
    const result = DneskaiPublishNowResultSchema.safeParse(await post({ action: 'approve-at', id, expectedHash, scheduledAt }));
    if (!result.success) throw new DneskaiWorkspaceRequestError('approval-unavailable', 502);
    return result.data;
  },
  async regenerate(id, expectedHash, note) {
    const result = DneskaiPaidActionResultSchema.safeParse(await post({ action: 'regenerate', id, expectedHash, note: note.trim().slice(0, 1000) }));
    if (!result.success) throw new DneskaiWorkspaceRequestError('regenerate-unavailable', 502);
    return result.data;
  },
  async generateNow(briefId) {
    const result = DneskaiPaidActionResultSchema.safeParse(await post({ action: 'generate-now', briefId }, '/api/marketing/dneskai/generate'));
    if (!result.success) throw new DneskaiWorkspaceRequestError('generate-now-unavailable', 502);
    return result.data;
  },
  async edit(request) {
    const result = DneskaiEditResultSchema.safeParse(await post(request));
    if (!result.success) throw new DneskaiWorkspaceRequestError('render-attach-failed', 502);
    return result.data;
  },
  async decide(id, action, feedback) { await post({ action, id, ...(feedback?.trim() ? { feedback: feedback.trim().slice(0, 2000) } : {}) }); },
  async approveMany(posts) {
    const result = DneskaiApproveManyResultSchema.safeParse(await post({ action: 'approve-many', posts: posts.map((item) => ({ id: item.id, expectedHash: item.contentHash })) }));
    if (!result.success) throw new DneskaiWorkspaceRequestError('approval-unavailable', 502);
    return result.data;
  },
  fit: (request, signal) => fitAt('/api/marketing/dneskai/fit', request, signal),
  async requeuePublication(id) {
    const result = z.strictObject({ result: z.enum(MARKETING_PUBLICATION_REQUEUE_RESULTS) }).safeParse(await post({ action: 'requeue', id }, '/api/marketing/publications'));
    if (!result.success) throw new DneskaiWorkspaceRequestError('publication-requeue-failed', 502);
    return result.data.result;
  },
  renderPreview: (request, signal) => previewAt('/api/marketing/dneskai/preview', request, signal),
};

/** POST a preview request and validate the answer; the harness posts the edited deck to its fixture-only twin. */
export async function previewAt(url: string, body: unknown, signal?: AbortSignal): Promise<DneskaiPreviewResult> {
  const result = DneskaiPreviewResultSchema.safeParse(await post(body, url, signal));
  if (!result.success) throw new DneskaiWorkspaceRequestError('render-unavailable', 502);
  return result.data;
}

/** POST a fit request and validate the answer; the preview posts to its fixture-only twin of the route. */
export async function fitAt(url: string, request: DneskaiFitRequest, signal?: AbortSignal): Promise<DneskaiFitResult> {
  const result = DneskaiFitResultSchema.safeParse(await post(request, url, signal));
  if (!result.success) throw new DneskaiWorkspaceRequestError('fit-unavailable', 502);
  return result.data;
}

let demo: Promise<DneskaiWorkspaceApi> | null = null;
/** The live port, or in the preview the in-memory demo, loaded only when a preview first opens a DNESKAi tab. */
export function dneskaiWorkspaceApi(preview: boolean): Promise<DneskaiWorkspaceApi> {
  if (!preview) return Promise.resolve(liveDneskaiWorkspaceApi);
  demo ??= import('@/lib/demo/dneskai-workspace-demo').then((module) => module.demoDneskaiWorkspaceApi);
  return demo;
}

/** The workspace's query keys for one project, built on the centralised `qk` keys. */
export function dneskaiWorkspaceKeys(projectId: string) {
  return {
    review: [...qk.dneskaiReview, projectId] as const,
    reviewPage: (before: DneskaiDecisionCursor) => [...qk.dneskaiReview, projectId, before.createdAt, before.id] as const,
    costs: [...qk.dneskaiCosts, projectId] as const,
    media: (candidateId: string) => [...qk.dneskaiMedia, projectId, candidateId] as const,
    renderFailed: [...qk.dneskaiRenderFailed, projectId] as const,
  };
}
