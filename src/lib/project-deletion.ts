import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { databaseTimestamp, databaseVersion } from "@/lib/database-version";
import type { Project } from "@/lib/types";

const identity = z.object({ id: z.uuid(), user_id: z.uuid(), updated_at: databaseTimestamp }).strict();
export class ProjectDeleteConflict extends Error { constructor() { super("Project deletion not confirmed"); this.name = "ProjectDeleteConflict"; } }

/** Delete only the owned version the owner reviewed. An empty/suppressed or
 * lost acknowledgement is not success; callers reconcile rather than rolling
 * an old collection over later changes. Private text never enters the request. */
export async function deleteOwnedProject(client: SupabaseClient, expected: Pick<Project, "id" | "user_id" | "updated_at">, parent?: AbortSignal): Promise<void> {
  const source = identity.parse({ id: expected.id, user_id: expected.user_id, updated_at: expected.updated_at });
  const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
  const { data, error } = await awaitWithSignal(client.from("projects").delete().eq("id", source.id).eq("user_id", source.user_id)
    .eq("updated_at", source.updated_at).select("id,user_id,updated_at").retry(false).abortSignal(signal), signal);
  if (error) throw Error("Project deletion not confirmed");
  const parsed = z.array(identity).length(1).safeParse(data);
  if (!parsed.success || parsed.data[0].id !== source.id || parsed.data[0].user_id !== source.user_id
    || databaseVersion(parsed.data[0].updated_at) !== databaseVersion(source.updated_at)) throw new ProjectDeleteConflict();
}
