import { awaitWithSignal } from "@/lib/abortable";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiCategory, AiLink, Invoice, InvoiceItem, ProjectLink, Prompt, PromptLink, Transaction, RepoNote, RepoLink, Todo, Project, ProjectCost, Cron } from "@/lib/types";

type Collections = {
  projects: Project;
  project_costs: ProjectCost;
  crons: Cron;
  transactions: Transaction;
  repo_notes: RepoNote;
  repo_links: RepoLink;
  todos: Todo;
  invoices: Invoice;
  invoice_items: InvoiceItem;
  prompts: Prompt;
  prompt_links: PromptLink;
  project_links: ProjectLink;
  ai_links: AiLink;
  ai_categories: AiCategory;
};

/** One complete, bounded statement snapshot under the caller's RLS. Never
 * commit a malformed or partial response as an empty cache. The server passes
 * its verified owner id as an additional response-ownership assertion.
 */
export async function readOwnedCollection<K extends keyof Collections>(
  client: SupabaseClient, entity: K, ownerId?: string, signal?: AbortSignal,
): Promise<{ data: Collections[K][]; error: null }> {
  const bounded = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  if (bounded.aborted) throw new DOMException("Request aborted", "AbortError");
  const query = client.rpc("read_owned_collection", { p_entity: entity }).retry(false).abortSignal(bounded);
  const { data, error } = await awaitWithSignal(query, bounded);
  if (error) throw error;
  if (!Array.isArray(data) || data.length > 50_000) throw new Error("Owned collection unavailable");
  const ids = new Set<string>();
  for (const row of data) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.user_id !== "string" || ids.has(row.id)
      || (ownerId !== undefined && row.user_id !== ownerId)) throw new Error("Invalid owned collection response");
    ids.add(row.id);
  }
  return { data: data as Collections[K][], error: null };
}
