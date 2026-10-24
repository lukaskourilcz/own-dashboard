import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { databaseTimestamp, databaseVersion } from "@/lib/database-version";
import { sameProjectSnapshot } from "@/lib/projects";
import { safeWebUrl } from "@/lib/web-url";
import type { Project } from "@/lib/types";

const webUrl = z.string().max(2000).refine(value => safeWebUrl(value) === value);
const repositoryName = z.string().max(201).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
export const projectDetailsValues = z.object({
  name: z.string().min(1).max(200).refine(value => value === value.trim() && !/\p{Cc}/u.test(value)),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  repo_full_name: repositoryName.nullable(), repo_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  url: webUrl.nullable(), dev_url: webUrl.nullable(), engagement: z.enum(["own", "client"]), organization_id: z.uuid().nullable(),
}).strict().refine(value => value.repo_id === null || value.repo_full_name !== null);
export type ProjectDetailsValues = z.infer<typeof projectDetailsValues>;
const aliases = z.array(z.string().max(201)).max(500);
const sourceSchema = z.object({ id: z.uuid(), user_id: z.uuid(), updated_at: databaseTimestamp, slug: z.string().max(201),
  repo_full_name: z.string().max(201).nullable(), repo_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  previous_slugs: aliases.optional(), previous_repo_full_names: aliases.optional() });
const versionFields = { id: z.uuid(), user_id: z.uuid(), source_updated_at: databaseTimestamp, updated_at: databaseTimestamp };
const receiptSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), ...versionFields, values: projectDetailsValues, previous_slugs: aliases, previous_repo_full_names: aliases }).strict(),
  z.object({ kind: z.literal("conflict"), ...versionFields }).strict(),
]);
export type ProjectDetailsReceipt = z.infer<typeof receiptSchema>;

/** A slug rename retains its URL. Only a known same repository id, or the
 * unchanged legacy name while attaching an id, may retain repository aliases. */
export function projectDetailsHistory(source: Pick<Project, "slug" | "repo_full_name" | "repo_id" | "previous_slugs" | "previous_repo_full_names">, desired: ProjectDetailsValues) {
  const previous_slugs = [...(source.previous_slugs ?? [])], before = source.repo_full_name, oldId = source.repo_id ?? null;
  if (desired.slug !== source.slug && !previous_slugs.includes(source.slug)) previous_slugs.push(source.slug);
  const lower = (value: string | null) => (value ?? "").toLowerCase();
  const relink = (desired.repo_id !== oldId && oldId !== null) || (lower(desired.repo_full_name) !== lower(before)
    && (desired.repo_id === null || oldId === null || desired.repo_id !== oldId));
  const previous_repo_full_names = relink ? [] : [...(source.previous_repo_full_names ?? [])];
  if (!relink && desired.repo_full_name !== before && before !== null && lower(before) !== lower(desired.repo_full_name)
    && !previous_repo_full_names.some(name => lower(name) === lower(before))) previous_repo_full_names.push(before);
  return { previous_slugs: aliases.parse(previous_slugs), previous_repo_full_names: aliases.parse(previous_repo_full_names) };
}
const sameValues = (a: ProjectDetailsValues, b: ProjectDetailsValues) => Object.entries(a).every(([key, value]) => value === b[key as keyof ProjectDetailsValues]);
const sameArray = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);
export function currentProjectDetails(project: Project): ProjectDetailsValues {
  return { name: project.name, slug: project.slug, repo_full_name: project.repo_full_name, repo_id: project.repo_id ?? null,
    url: project.url, dev_url: project.dev_url ?? null, engagement: project.engagement ?? "own", organization_id: project.organization_id ?? null };
}

/** Manual details only. A captured source version prevents a stale form from
 * silently replacing another edit; identical retries need no second write. */
export async function saveProjectDetails(client: SupabaseClient, expected: Project, values: ProjectDetailsValues): Promise<ProjectDetailsReceipt> {
  const source = sourceSchema.parse(expected), desired = projectDetailsValues.parse(values);
  const history = projectDetailsHistory(source, desired);
  if (new TextEncoder().encode(JSON.stringify(desired)).byteLength > 16384) throw Error("Invalid project details");
  const signal = AbortSignal.timeout(15_000);
  const { data, error } = await awaitWithSignal(client.rpc("save_project_details", { p_id: source.id, p_expected_updated_at: source.updated_at, p_values: desired }).retry(false).abortSignal(signal), signal);
  if (error) throw Error("Project details save unconfirmed");
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 1048576) throw Error("Project details save unconfirmed");
  const saved = receiptSchema.parse(data), from = databaseVersion(saved.source_updated_at)!, to = databaseVersion(saved.updated_at)!;
  if (saved.id !== source.id || saved.user_id !== source.user_id || to < from) throw Error("Project details save unconfirmed");
  if (saved.kind === "conflict") {
    if (to !== from || from === databaseVersion(source.updated_at)) throw Error("Project details conflict unconfirmed");
  } else if (!sameValues(saved.values, desired) || !sameArray(saved.previous_slugs, history.previous_slugs)
    || !sameArray(saved.previous_repo_full_names, history.previous_repo_full_names)
    || (to > from ? from !== databaseVersion(source.updated_at) || sameValues(currentProjectDetails(expected), desired)
      : from === databaseVersion(source.updated_at) && !sameValues(currentProjectDetails(expected), desired))) throw Error("Project details save unconfirmed");
  return saved;
}

export function applyProjectDetailsReceipt(current: Project[], expected: Project, receipt: ProjectDetailsReceipt): { projects: Project[]; reconcile: boolean } {
  if (receipt.kind !== "saved" || receipt.id !== expected.id || receipt.user_id !== expected.user_id) return { projects: current, reconcile: true };
  let found = false, reconcile = false;
  const projects = current.map(project => {
    if (project.id !== expected.id || project.user_id !== expected.user_id) return project;
    found = true;
    const complete = { ...project, ...receipt.values, previous_slugs: receipt.previous_slugs, previous_repo_full_names: receipt.previous_repo_full_names, updated_at: receipt.updated_at };
    const currentVersion = databaseVersion(project.updated_at), savedVersion = databaseVersion(receipt.updated_at);
    if (currentVersion !== null && savedVersion !== null && currentVersion >= savedVersion
      && sameValues(currentProjectDetails(project), receipt.values) && sameArray(project.previous_slugs ?? [], receipt.previous_slugs)
      && sameArray(project.previous_repo_full_names ?? [], receipt.previous_repo_full_names)) return project;
    if (!sameProjectSnapshot(project, expected) || databaseVersion(project.updated_at) !== databaseVersion(receipt.source_updated_at)) { reconcile = true; return project; }
    return complete;
  });
  return { projects, reconcile: reconcile || !found };
}
