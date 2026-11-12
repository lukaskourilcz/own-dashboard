import { createClient } from "@/lib/supabase/client";

/**
 * Opportunities → Contacts and Emails (owner request, 12 November 2026). Tradespeople the owner offers a website
 * with a booking form, one trade at a time (`20261112172222_lead_contacts.sql`). The dashboard reads and edits; it
 * never sends anything and never calls a model. scripts/import-lead-contacts.ts fills the contacts.
 */
export const LEAD_OUTREACH_STATUSES = ["new", "contacted", "replied", "interested", "not_interested", "do_not_contact"] as const;
export type LeadOutreachStatus = (typeof LEAD_OUTREACH_STATUSES)[number];
export type LeadFormStatus = "none" | "contact_form";

/** The 14 regions exactly as the data contract and the database check spell them. */
export const LEAD_REGIONS = [
  "Hlavní město Praha", "Středočeský kraj", "Jihočeský kraj", "Plzeňský kraj", "Karlovarský kraj",
  "Ústecký kraj", "Liberecký kraj", "Královéhradecký kraj", "Pardubický kraj", "Kraj Vysočina",
  "Jihomoravský kraj", "Olomoucký kraj", "Zlínský kraj", "Moravskoslezský kraj",
] as const;

export type LeadTrade = { id: string; slug: string; name: string; sort_order: number };

export type LeadContact = {
  id: string;
  trade_id: string;
  name: string;
  email: string;
  email_source_url: string;
  phone: string | null;
  website: string | null;
  form_status: LeadFormStatus | null;
  quality_score: number | null;
  quality_reason: string | null;
  activity: string;
  city: string | null;
  region: string | null;
  ico: string | null;
  source: string;
  source_url: string | null;
  other_profiles: string[];
  collected_at: string;
  outreach_status: LeadOutreachStatus;
  last_contacted_at: string | null;
  note: string;
  updated_at: string;
};

export type LeadTemplate = { id: string; trade_id: string; subject: string; body: string; updated_at: string };

export type LeadSort = "name" | "quality_asc" | "quality_desc" | "newest";
export type LeadFilter = {
  search: string;
  region: string; // "all", "unknown" or one of LEAD_REGIONS
  status: LeadOutreachStatus | "all" | "active";
  website: "all" | "without" | "with";
  sort: LeadSort;
};
export const DEFAULT_LEAD_FILTER: LeadFilter = { search: "", region: "all", status: "active", website: "all", sort: "name" };
export const LEAD_PAGE_SIZE = 50;

const CONTACT_COLUMNS = "id,trade_id,name,email,email_source_url,phone,website,form_status,quality_score,quality_reason,activity,city,region,ico,source,source_url,other_profiles,collected_at,outreach_status,last_contacted_at,note,updated_at";

export async function fetchLeadTrades(): Promise<LeadTrade[]> {
  const { data, error } = await createClient().from("lead_trades").select("id,slug,name,sort_order")
    .order("sort_order", { ascending: true }).order("name", { ascending: true }).limit(100);
  if (error) throw error;
  return (data ?? []) as LeadTrade[];
}

/** Drops the characters that would break a PostgREST `or=(…)` filter or act as a wildcard. */
export function leadSearchTerm(search: string): string {
  return search.replace(/[,()%*\\"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** One page of contacts, filtered and sorted in the database. "active" hides the closed statuses. */
export async function fetchLeadContacts(tradeId: string, filter: LeadFilter, page: number): Promise<{ rows: LeadContact[]; total: number }> {
  let query = createClient().from("lead_contacts").select(CONTACT_COLUMNS, { count: "exact" }).eq("trade_id", tradeId);
  const term = leadSearchTerm(filter.search);
  if (term) query = query.or(["name", "email", "activity", "city", "website"].map((column) => `${column}.ilike.*${term}*`).join(","));
  if (filter.region === "unknown") query = query.is("region", null);
  else if (filter.region !== "all") query = query.eq("region", filter.region);
  if (filter.status === "active") query = query.not("outreach_status", "in", "(not_interested,do_not_contact)");
  else if (filter.status !== "all") query = query.eq("outreach_status", filter.status);
  if (filter.website === "without") query = query.is("website", null);
  else if (filter.website === "with") query = query.not("website", "is", null);
  if (filter.sort === "quality_asc" || filter.sort === "quality_desc") {
    query = query.order("quality_score", { ascending: filter.sort === "quality_asc", nullsFirst: false });
  } else if (filter.sort === "newest") query = query.order("collected_at", { ascending: false });
  query = query.order("name", { ascending: true }).order("id", { ascending: true });
  const from = page * LEAD_PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + LEAD_PAGE_SIZE - 1);
  if (error) throw error;
  return { rows: (data ?? []) as LeadContact[], total: count ?? 0 };
}

export async function updateLeadContact(id: string, change: { outreach_status?: LeadOutreachStatus; note?: string }): Promise<LeadContact> {
  const { data, error } = await createClient().from("lead_contacts").update(change).eq("id", id).select(CONTACT_COLUMNS).single();
  if (error) throw error;
  return data as LeadContact;
}

export async function fetchLeadTemplate(tradeId: string): Promise<LeadTemplate | null> {
  const { data, error } = await createClient().from("lead_email_templates").select("id,trade_id,subject,body,updated_at").eq("trade_id", tradeId).maybeSingle();
  if (error) throw error;
  return data as LeadTemplate | null;
}

export async function saveLeadTemplate(tradeId: string, existingId: string | null, value: { subject: string; body: string }): Promise<LeadTemplate> {
  const supabase = createClient();
  const request = existingId
    ? supabase.from("lead_email_templates").update(value).eq("id", existingId)
    : supabase.from("lead_email_templates").insert({ trade_id: tradeId, ...value });
  const { data, error } = await request.select("id,trade_id,subject,body,updated_at").single();
  if (error) throw error;
  return data as LeadTemplate;
}

/* Template ----------------------------------------------------------------------------------------------------- */

/** The variables a template can use. `{{#web}}…{{/web}}` shows text only when the value exists, `{{^web}}…{{/web}}` only when it does not. */
export const LEAD_TEMPLATE_VARIABLES = ["jmeno", "mesto", "kraj", "web", "duvod", "cinnost", "zdroj", "zdroj_url"] as const;
export type LeadTemplateVariable = (typeof LEAD_TEMPLATE_VARIABLES)[number];

function host(url: string | null): string {
  if (!url) return "";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function leadTemplateValues(contact: Pick<LeadContact, "name" | "city" | "region" | "website" | "quality_reason" | "activity" | "email_source_url">): Record<LeadTemplateVariable, string> {
  return {
    jmeno: contact.name.trim(),
    mesto: contact.city?.trim() ?? "",
    kraj: contact.region ?? "",
    web: contact.website ? contact.website.replace(/^https?:\/\//i, "").replace(/\/$/, "") : "",
    duvod: contact.quality_reason?.trim() ?? "",
    cinnost: contact.activity.trim(),
    zdroj: host(contact.email_source_url),
    zdroj_url: contact.email_source_url,
  };
}

/** Fills a template. Returns the text and the names it did not recognise, so the editor can point at typos. */
export function renderLeadTemplate(template: string, values: Record<string, string>): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const known = (name: string) => { if (!(name in values)) unknown.add(name); return values[name] ?? ""; };
  let text = template;
  // Sections first, innermost out, so a variable inside a section is filled after the section is decided.
  for (let guard = 0; guard < 20; guard += 1) {
    const next = text.replace(/\{\{([#^])\s*([a-z_]+)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/g, (_match, kind: string, name: string, inner: string) => {
      const present = known(name) !== "";
      return (kind === "#" ? present : !present) ? inner : "";
    });
    if (next === text) break;
    text = next;
  }
  text = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, name: string) => known(name));
  // A section that was left out can leave a doubled space or an empty paragraph behind.
  text = text.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { text, unknown: [...unknown] };
}

/** A mailto: link for the owner's own mail client. Line breaks become CRLF as RFC 6068 expects. */
export function leadMailto(email: string, subject: string, body: string): string {
  const encode = (value: string) => encodeURIComponent(value.replace(/\r?\n/g, "\r\n"));
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}?subject=${encode(subject)}&body=${encode(body)}`;
}

/** Only http(s) links are rendered as links. */
export function safeLeadUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}
