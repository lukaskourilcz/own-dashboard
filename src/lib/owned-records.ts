import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiCategory, AiLink, Invoice, InvoiceItem, ProjectLink, Prompt, PromptLink, Transaction } from "@/lib/types";

type Collections = {
  transactions: Transaction;
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
  client: SupabaseClient, entity: K, ownerId?: string,
): Promise<{ data: Collections[K][]; error: null }> {
  const { data, error } = await client.rpc("read_owned_collection", { p_entity: entity });
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
