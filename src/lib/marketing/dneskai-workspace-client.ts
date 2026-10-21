import { z } from 'zod';
import { DneskaiMediaReadSchema, type DneskaiMediaRead } from './dneskai-media-contracts';
import { loadMarketingAccounts, type MarketingAccountStatus } from './accounts-client';
import { DneskaiRenderProblemSchema } from './contracts';
import { DneskaiCostsReadSchema, DneskaiWorkspaceReadSchema, type DneskaiCostsRead, type DneskaiWorkspaceRead } from './dneskai-workspace';
import type { DneskaiEditRequest } from './dneskai-deck-editor';
import { qk } from '@/lib/queries/keys';

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

export interface DneskaiWorkspaceApi {
  /** True in the deterministic preview: nothing reaches a server. */
  readonly preview: boolean;
  loadReview(projectId: string, signal?: AbortSignal): Promise<DneskaiWorkspaceRead>;
  loadCosts(projectId: string, signal?: AbortSignal): Promise<DneskaiCostsRead>;
  loadMedia(projectId: string, candidateId: string, signal?: AbortSignal): Promise<DneskaiMediaRead>;
  loadAccounts(signal?: AbortSignal): Promise<MarketingAccountStatus[]>;
  approve(id: string, expectedHash: string): Promise<void>;
  edit(request: DneskaiEditRequest): Promise<DneskaiEditResult>;
  decide(id: string, action: 'returned' | 'skipped', feedback?: string): Promise<void>;
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
async function post(body: unknown): Promise<unknown> {
  let response: Response;
  try { response = await fetch('/api/marketing/revisions', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new DneskaiWorkspaceRequestError('decision-failed', 0); }
  if (!response.ok) throw await failure(response);
  return response.json().catch(() => ({}));
}

export const liveDneskaiWorkspaceApi: DneskaiWorkspaceApi = {
  preview: false,
  async loadReview(projectId, signal) {
    return DneskaiWorkspaceReadSchema.parse(await getJson(`/api/marketing/dneskai/review?projectId=${encodeURIComponent(projectId)}`, signal));
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
  async edit(request) {
    const result = DneskaiEditResultSchema.safeParse(await post(request));
    if (!result.success) throw new DneskaiWorkspaceRequestError('render-attach-failed', 502);
    return result.data;
  },
  async decide(id, action, feedback) { await post({ action, id, ...(feedback?.trim() ? { feedback: feedback.trim().slice(0, 2000) } : {}) }); },
};

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
    costs: [...qk.dneskaiCosts, projectId] as const,
    media: (candidateId: string) => [...qk.dneskaiMedia, projectId, candidateId] as const,
    renderFailed: [...qk.dneskaiRenderFailed, projectId] as const,
  };
}
