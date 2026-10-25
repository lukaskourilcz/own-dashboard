import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { awaitWithSignal } from "@/lib/abortable";
import { getProjectTraffic, vercelTrafficConfigured, vercelTrafficOwner } from "@/lib/vercel";
import { ProjectTrafficResponseSchema } from "@/lib/project-traffic-contract";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const headers = { "cache-control": "private, no-store", Vary: "Cookie" };
const repository = z.string().max(201).regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i);
const ownedProject = z.object({ id: z.uuid(), user_id: z.uuid(), repo_full_name: repository, repo_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable() }).strict();
const fail = (status: number) => Response.json({ error: status === 401 ? "unauthorized" : status === 404 ? "project-unavailable" : "traffic-unavailable" }, { status, headers });

/** The shared deployment credential serves only its configured dashboard owner
 * and a repository confirmed in that owner's project metadata. */
export async function GET(request: Request) {
  const stop = new AbortController(), signal = AbortSignal.any([request.signal, stop.signal, AbortSignal.timeout(25_000)]);
  try {
    const params = new URL(request.url).searchParams, repo = repository.safeParse(params.get("repo")), rawId = params.get("repoId");
    if (!repo.success || [...params.keys()].some(key => !["repo", "repoId"].includes(key) || params.getAll(key).length !== 1)
      || (rawId !== null && (!/^[1-9]\d{0,15}$/.test(rawId) || !Number.isSafeInteger(Number(rawId))))) return fail(400);
    const repoId = rawId === null ? null : Number(rawId);
    const authSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    const db = await awaitWithSignal(createClient(authSignal), authSignal), auth = await awaitWithSignal(db.auth.getUser(), authSignal);
    if (auth.error) return fail([400, 401, 403].includes(auth.error.status ?? 0) ? 401 : 503);
    const owner = z.uuid().safeParse(auth.data.user?.id);
    if (!auth.data.user) return fail(401);
    if (!owner.success) return fail(503);
    if (request.headers.get("x-own-dashboard-owner") !== owner.data) return fail(403);
    if (!vercelTrafficConfigured()) return Response.json({ ownerId: owner.data, traffic: { kind: "unconfigured" } }, { headers });
    if (!vercelTrafficOwner(owner.data)) return fail(404);
    const readSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
    let query = db.from("projects").select("id,user_id,repo_full_name,repo_id").eq("user_id", owner.data);
    query = repoId !== null ? query.eq("repo_id", repoId) : query.eq("repo_full_name", repo.data);
    // This is an existence proof, not a truncated list: several owned sections
    // may legitimately share one permanent repository id.
    const row = await awaitWithSignal(query.limit(1).retry(false).abortSignal(readSignal).maybeSingle(), readSignal);
    if (row.error) return fail(503);
    if (!row.data) return fail(404);
    const project = ownedProject.parse(row.data);
    if (project.user_id !== owner.data || (repoId !== null ? project.repo_id !== repoId : project.repo_full_name !== repo.data)) return fail(503);
    signal.throwIfAborted();
    const traffic = await getProjectTraffic(project.repo_full_name, project.repo_id, { ownerId: owner.data, signal });
    if (traffic.kind === "error") return fail(503);
    return Response.json(ProjectTrafficResponseSchema.parse({ ownerId: owner.data, traffic }), { headers });
  } catch { return fail(503); }
  finally { stop.abort(); }
}
