import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { databaseTimestamp as timestamp, databaseVersion as version } from "@/lib/database-version";
import type { Project } from "@/lib/types";

const patchSchema = z.object({ is_active: z.boolean().optional(), engagement: z.enum(["own", "client"]).optional() }).strict()
  .refine(patch => Object.keys(patch).length > 0 && Object.values(patch).every(value => value !== undefined));
const sourceSchema = z.object({ id: z.uuid(), user_id: z.uuid(), updated_at: timestamp });
const receiptSchema = z.object({ kind: z.enum(["saved", "conflict"]), id: z.uuid(), user_id: z.uuid(), values: patchSchema,
  previous_values: patchSchema, source_updated_at: timestamp, updated_at: timestamp }).strict();
export type ProjectPreferencesPatch = z.infer<typeof patchSchema>;
export type ProjectPreferencesReceipt = z.infer<typeof receiptSchema>;
const same = (a: ProjectPreferencesPatch, b: ProjectPreferencesPatch) => Object.keys(a).length === Object.keys(b).length
  && Object.entries(a).every(([key, value]) => b[key as keyof ProjectPreferencesPatch] === value);

/** Small, confirmed classification writes. No optimistic move, automatic retry,
 * private note response or whole-record cache replacement. */
export async function setProjectPreferences(client: SupabaseClient, expected: Pick<Project, "id" | "user_id" | "updated_at">, patch: ProjectPreferencesPatch): Promise<ProjectPreferencesReceipt> {
  const source = sourceSchema.parse(expected), desired = patchSchema.parse(patch), signal = AbortSignal.timeout(15_000);
  const { data, error } = await awaitWithSignal(client.rpc("set_project_preferences", { p_id: source.id, p_expected_updated_at: source.updated_at, p_patch: desired }).retry(false).abortSignal(signal), signal);
  if (error) throw Error("Project preferences save unconfirmed");
  const receipt = receiptSchema.parse(data), from = version(receipt.source_updated_at)!, to = version(receipt.updated_at)!;
  const keys = Object.keys(desired).sort().join(",");
  if (receipt.id !== source.id || receipt.user_id !== source.user_id || Object.keys(receipt.values).sort().join(",") !== keys
    || Object.keys(receipt.previous_values).sort().join(",") !== keys || to < from) throw Error("Project preferences save unconfirmed");
  if (receipt.kind === "saved") {
    if (!same(receipt.values, desired) || (same(receipt.previous_values, desired) ? to !== from : from !== version(source.updated_at) || to <= from)) throw Error("Project preferences save unconfirmed");
  } else if (!same(receipt.values, receipt.previous_values) || same(receipt.values, desired) || to !== from || from === version(source.updated_at)) throw Error("Project preferences conflict unconfirmed");
  return receipt;
}

/** Only apply a receipt to the exact source version. A late response cannot
 * regress notes, another classification change or a missing project. */
export function applyProjectPreferencesReceipt(current: Project[], receipt: ProjectPreferencesReceipt): { projects: Project[]; reconcile: boolean } {
  if (receipt.kind !== "saved") return { projects: current, reconcile: true };
  let found = false, reconcile = false;
  const projects = current.map(project => {
    if (project.id !== receipt.id || project.user_id !== receipt.user_id) return project;
    found = true;
    const matches = (values: ProjectPreferencesPatch) => Object.entries(values).every(([key, value]) => (key === "engagement" ? project.engagement ?? "own" : project.is_active) === value);
    const currentVersion = version(project.updated_at), savedVersion = version(receipt.updated_at), sourceVersion = version(receipt.source_updated_at);
    if (currentVersion === null || savedVersion === null || sourceVersion === null) { reconcile = true; return project; }
    if (matches(receipt.values) && currentVersion >= savedVersion) return project;
    if (currentVersion !== sourceVersion || !matches(receipt.previous_values)) { reconcile = true; return project; }
    return { ...project, ...receipt.values, updated_at: receipt.updated_at };
  });
  return { projects, reconcile: reconcile || !found };
}
