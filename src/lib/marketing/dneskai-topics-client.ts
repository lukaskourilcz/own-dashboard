import { qk } from '@/lib/queries/keys';
import { DneskaiTopicActionResultSchema, DneskaiTopicsReadSchema, type DneskaiTopicAction, type DneskaiTopicActionResult, type DneskaiTopicsRead } from './dneskai-topics';
import { DneskaiWorkspaceRequestError } from './dneskai-workspace-client';

/**
 * The browser side of the topics list (náměty, #154). `loadTopics` answers null when the server has topics off
 * (DNESKAI_TOPICS_ENABLED unset answers 404), so the Lab shows no section. In `/dev-preview` the in-memory demo
 * (`src/lib/demo/dneskai-topics-demo.ts`) stands in for the server.
 */
export interface DneskaiTopicsApi {
  readonly preview: boolean;
  loadTopics(projectId: string, signal?: AbortSignal): Promise<DneskaiTopicsRead | null>;
  act(action: DneskaiTopicAction): Promise<DneskaiTopicActionResult>;
}

const codeShape = /^[a-z][a-z0-9-]{0,63}$/;
async function failure(response: Response) {
  let code = 'topic-action-failed';
  try { const body = await response.json() as { error?: unknown }; if (typeof body.error === 'string' && codeShape.test(body.error)) code = body.error; } catch { /* generic code */ }
  return new DneskaiWorkspaceRequestError(response.status === 429 ? 'rate-limited' : code, response.status);
}

export const liveDneskaiTopicsApi: DneskaiTopicsApi = {
  preview: false,
  async loadTopics(projectId, signal) {
    const response = await fetch(`/api/marketing/dneskai/topics?projectId=${encodeURIComponent(projectId)}`, { cache: 'no-store', signal });
    if (response.status === 404) {
      // Off on the server, or a project that is not the DNESKAi one: either way there is no list to show.
      return null;
    }
    if (!response.ok) throw await failure(response);
    return DneskaiTopicsReadSchema.parse(await response.json());
  },
  async act(action) {
    let response: Response;
    try { response = await fetch('/api/marketing/dneskai/topics', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }); }
    catch { throw new DneskaiWorkspaceRequestError('topic-action-failed', 0); }
    if (!response.ok) throw await failure(response);
    const result = DneskaiTopicActionResultSchema.safeParse(await response.json().catch(() => null));
    if (!result.success) throw new DneskaiWorkspaceRequestError('topic-action-failed', 502);
    return result.data;
  },
};

let demo: Promise<DneskaiTopicsApi> | null = null;
/** The live port, or in the preview the in-memory demo, loaded only when a preview first shows the list. */
export function dneskaiTopicsApi(preview: boolean): Promise<DneskaiTopicsApi> {
  if (!preview) return Promise.resolve(liveDneskaiTopicsApi);
  demo ??= import('@/lib/demo/dneskai-topics-demo').then((module) => module.demoDneskaiTopicsApi);
  return demo;
}

/** The topics read of one project, on the centralised `qk` keys. */
export const dneskaiTopicsKey = (projectId: string) => [...qk.dneskaiTopics, projectId] as const;
