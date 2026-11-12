/**
 * Imports one trade's collected contacts into Opportunities → Contacts.
 *
 *   npm run import:leads -- hodinovy-manzel "Hodinový manžel" [--dry-run] [--dir <path>]
 *
 * (the npm script is `node --env-file-if-exists=.env.local scripts/import-lead-contacts.ts …`; Node 22.18+ runs TypeScript as is)
 *
 * Reads <dir>/<trade_slug>/contacts.json (default dir ~/Developer/leads-data) in the format of leads-data/CONTRACT.md,
 * validates every record, then calls public.import_lead_contacts in batches. The database function upserts by
 * (owner, trade, email), keeps the owner's outreach status, last-contacted date and note, and leaves a contact
 * marked "do not contact" untouched. Running it again with the same or a newer file is safe.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. DASHBOARD_OWNER_ID is optional while the dashboard
 * has exactly one account. --dry-run validates and prints counts without connecting to Supabase.
 *
 * No model calls (docs/ai-and-privacy.md): the scores and reasons in the file were written before the import.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export const LEAD_REGIONS = [
  "Hlavní město Praha", "Středočeský kraj", "Jihočeský kraj", "Plzeňský kraj", "Karlovarský kraj",
  "Ústecký kraj", "Liberecký kraj", "Královéhradecký kraj", "Pardubický kraj", "Kraj Vysočina",
  "Jihomoravský kraj", "Olomoucký kraj", "Zlínský kraj", "Moravskoslezský kraj",
] as const;

const httpUrl = z.string().trim().regex(/^https?:\/\//i, "must start with http:// or https://");
const optionalText = z.string().trim().nullish().transform((value) => value || null);

const contactSchema = z.object({
  trade: z.string(),
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "is not an e-mail address"),
  email_source_url: httpUrl,
  phone: z.string().trim().regex(/^\+[1-9][0-9]{6,14}$/, "must be E.164").nullish().transform((value) => value ?? null),
  website: httpUrl.nullish().transform((value) => value ?? null),
  form_status: z.enum(["none", "contact_form"]).nullish().transform((value) => value ?? null),
  quality_score: z.number().int().min(1).max(10).nullish().transform((value) => value ?? null),
  quality_reason: optionalText,
  activity: z.string().trim().nullish().transform((value) => value ?? ""),
  city: optionalText,
  region: z.enum(LEAD_REGIONS).nullish().transform((value) => value ?? null),
  ico: z.string().trim().regex(/^[0-9]{8}$/, "must be 8 digits").nullish().transform((value) => value ?? null),
  source: z.string().trim().min(1),
  source_url: httpUrl.nullish().transform((value) => value ?? null),
  other_profiles: z.array(z.string().trim()).nullish().transform((value) => value ?? []),
  collected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date"),
}).superRefine((row, ctx) => {
  if (row.website === null) {
    for (const field of ["form_status", "quality_score", "quality_reason"] as const) {
      if (row[field] !== null) ctx.addIssue({ code: "custom", path: [field], message: "must be null when website is null" });
    }
  } else if (row.form_status === null) {
    ctx.addIssue({ code: "custom", path: ["form_status"], message: "is required when website is set" });
  }
});

export type LeadContactRow = Omit<z.output<typeof contactSchema>, "trade">;

/** Validates a parsed contacts.json. Throws one error listing every bad record (at most 20 lines). */
export function parseContacts(input: unknown, tradeSlug: string): LeadContactRow[] {
  if (!Array.isArray(input)) throw new Error("contacts.json must be a JSON array");
  const problems: string[] = [];
  const rows: LeadContactRow[] = [];
  const seen = new Map<string, number>();
  input.forEach((record, index) => {
    const parsed = contactSchema.safeParse(record);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) problems.push(`#${index} ${issue.path.join(".") || "record"}: ${issue.message}`);
      return;
    }
    const { trade, ...row } = parsed.data;
    if (trade !== tradeSlug) { problems.push(`#${index} trade: "${trade}" is not "${tradeSlug}"`); return; }
    const first = seen.get(row.email);
    if (first !== undefined) { problems.push(`#${index} email: ${row.email} repeats record #${first}`); return; }
    seen.set(row.email, index);
    rows.push(row);
  });
  if (problems.length) {
    const shown = problems.slice(0, 20).join("\n");
    throw new Error(`${problems.length} problem(s) in contacts.json:\n${shown}${problems.length > 20 ? "\n…" : ""}`);
  }
  return rows;
}

export type ImportResult = { inserted: number; updated: number; skipped_do_not_contact: number };

type Rpc = (fn: "import_lead_contacts", args: { p_owner: string | null; p_trade_slug: string; p_trade_name: string; p_rows: LeadContactRow[] }) =>
  PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Sends the rows in batches; each batch is one transaction in the database. */
export async function importContacts(rpc: Rpc, options: { owner: string | null; tradeSlug: string; tradeName: string; rows: LeadContactRow[]; batchSize?: number }): Promise<ImportResult> {
  const total: ImportResult = { inserted: 0, updated: 0, skipped_do_not_contact: 0 };
  const size = options.batchSize ?? 500;
  for (let start = 0; start < options.rows.length || start === 0; start += size) {
    const { data, error } = await rpc("import_lead_contacts", {
      p_owner: options.owner, p_trade_slug: options.tradeSlug, p_trade_name: options.tradeName, p_rows: options.rows.slice(start, start + size),
    });
    if (error) throw new Error(`import failed at record ${start}: ${error.message}`);
    const result = data as ImportResult;
    total.inserted += result.inserted;
    total.updated += result.updated;
    total.skipped_do_not_contact += result.skipped_do_not_contact;
    if (options.rows.length === 0) break;
  }
  return total;
}

function argument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((value, index) => !value.startsWith("--") && args[index - 1] !== "--dir");
  const [tradeSlug, tradeName] = positional;
  if (!tradeSlug || !tradeName || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tradeSlug)) {
    console.error('Usage: npm run import:leads -- <trade_slug> "<Trade name>" [--dry-run] [--dir <path>]');
    process.exit(2);
  }
  const dir = argument(args, "--dir") ?? join(homedir(), "Developer", "leads-data");
  const file = join(dir, tradeSlug, "contacts.json");
  const rows = parseContacts(JSON.parse(await readFile(file, "utf8")), tradeSlug);
  const withoutWebsite = rows.filter((row) => row.website === null).length;
  console.log(`${file}: ${rows.length} valid contacts (${withoutWebsite} without a website, ${rows.length - withoutWebsite} with one).`);
  if (args.includes("--dry-run")) { console.log("Dry run: nothing written."); return; }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const result = await importContacts((fn, rpcArgs) => supabase.rpc(fn, rpcArgs), {
    owner: process.env.DASHBOARD_OWNER_ID || null, tradeSlug, tradeName, rows,
  });
  console.log(`New: ${result.inserted} · updated: ${result.updated} · left alone (do not contact): ${result.skipped_do_not_contact}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
}
