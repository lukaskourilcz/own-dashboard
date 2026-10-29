import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { projectEngagement } from "@/lib/projects";
import type { Project } from "@/lib/types";

const sourceSchema = z.object({ id: z.uuid(), user_id: z.uuid(), updated_at: z.iso.datetime({ offset: true }), sort_order: z.number().int().min(-2147483648).max(2147483647), is_active: z.literal(true), parent_id: z.null().optional(), engagement: z.enum(["own", "client"]).optional() });
const receiptSchema = z.array(z.object({ id: z.uuid(), user_id: z.uuid(), sort_order: z.number().int().nonnegative(), updated_at: z.iso.datetime({ offset: true }) }).strict()).max(20000);
export type ProjectOrderReceipt = z.infer<typeof receiptSchema>;

/** Group positions are independent: own/client groups and subsections never
 * move into each other. Include unchanged group rows to prove completeness. */
export async function reorderOwnedProjects(client: SupabaseClient, expected: Project[], nextIds: string[]): Promise<ProjectOrderReceipt> {
  if (!expected.length || expected.length > 20000 || nextIds.length !== expected.length) throw Error("Invalid project order");
  const sources = expected.map(row => sourceSchema.parse(row)), owner = sources[0].user_id, group = projectEngagement(sources[0]);
  const byId = new Map(sources.map(row => [row.id, row]));
  if (byId.size !== sources.length || new Set(nextIds).size !== sources.length || sources.some(row => row.user_id !== owner || projectEngagement(row) !== group)) throw Error("Invalid project order");
  const rows = nextIds.map((id, sort_order) => {
    const source = byId.get(id); if (!source) throw Error("Invalid project order");
    return { id, user_id: owner, updated_at: source.updated_at, previous_sort_order: source.sort_order, sort_order, engagement: group, parent_id: null, is_active: true };
  });
  if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > 8388608) throw Error("Invalid project order");
  const changed = new Map(rows.filter(row => row.previous_sort_order !== row.sort_order).map(row => [row.id, row]));
  if (!changed.size) return [];
  const signal = AbortSignal.timeout(15_000);
  const { data, error } = await awaitWithSignal(client.rpc("reorder_owned_projects", { p_rows: rows }).retry(false).abortSignal(signal), signal);
  if (error) throw Error("Project order unconfirmed");
  const saved = receiptSchema.parse(data), seen = new Set<string>();
  if (saved.length !== changed.size || saved.some(row => {
    const source = changed.get(row.id);
    if (!source || seen.has(row.id) || row.user_id !== owner || row.sort_order !== source.sort_order || Date.parse(row.updated_at) <= Date.parse(source.updated_at)) return true;
    seen.add(row.id); return false;
  })) throw Error("Project order unconfirmed");
  return saved;
}

/** Apply only confirmed order/version fields to unchanged cached versions.
 * Never restore a full earlier list or overwrite another local edit. */
export function applyProjectOrder(current: Project[], expected: Project[], saved: ProjectOrderReceipt): Project[] {
  const before = new Map(expected.map(row => [row.id, row])), after = new Map(saved.map(row => [row.id, row]));
  return current.map(row => {
    const source = before.get(row.id), receipt = after.get(row.id);
    if (!source || !receipt || row.user_id !== source.user_id || row.updated_at !== source.updated_at || row.sort_order !== source.sort_order
      || row.parent_id !== source.parent_id || row.is_active !== source.is_active || projectEngagement(row) !== projectEngagement(source)) return row;
    return { ...row, sort_order: receipt.sort_order, updated_at: receipt.updated_at };
  });
}
