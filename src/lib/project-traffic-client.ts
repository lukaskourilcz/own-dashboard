import { awaitWithSignal } from "@/lib/abortable";
import { boundedResponseText } from "@/lib/bounded-response";
import { ProjectTrafficResponseSchema } from "@/lib/project-traffic-contract";

export async function loadProjectTraffic(ownerId: string, repo: string, repoId: number | null, parent: AbortSignal) {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(20_000)]);
  try {
    signal.throwIfAborted(); const params = new URLSearchParams({ repo }); if (repoId !== null) params.set("repoId", String(repoId));
    const pending = fetch(`/api/vercel/analytics?${params}`, { cache: "no-store", signal, headers: { "x-own-dashboard-owner": ownerId } });
    void pending.then(response => { if (signal.aborted && response.body && !response.body.locked) void response.body.cancel().catch(() => undefined); }, () => undefined);
    const response = await awaitWithSignal(pending, signal);
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw Error(); }
    const result = ProjectTrafficResponseSchema.parse(JSON.parse(await boundedResponseText(response, 32_768, signal)));
    if (result.ownerId !== ownerId || result.traffic.kind === "error") throw Error();
    return result.traffic;
  } catch {
    if (parent.aborted) throw new DOMException("Request aborted", "AbortError");
    throw new Error("Traffic unavailable");
  }
}
