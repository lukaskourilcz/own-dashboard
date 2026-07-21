import { NextResponse } from "next/server";
import { brandConfig } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";

const SCOPES = ["legacy", "financial", "professional", "knowledge", "projects", "notes", "prompts", "career", "full"] as const;
type Scope = (typeof SCOPES)[number];

const TABLES: Record<Exclude<Scope, "legacy" | "full">, string[]> = {
  financial: ["accounts", "bank_connections", "transactions", "subscriptions", "invoices", "invoice_items", "invoice_settings", "project_costs", "spend_categories", "transaction_category_rules"],
  professional: ["organizations", "client_opportunities", "projects", "project_costs", "crons", "todos", "plans", "important_dates", "job_applications", "job_user_state", "job_application_events", "cover_letter_templates", "weekly_reviews", "inbox_items", "notifications", "notification_log"],
  knowledge: ["notes", "prompts", "ai_links", "ai_categories", "shortcuts", "reference_rows", "repo_notes", "repo_links"],
  projects: ["projects", "project_costs", "crons", "todos", "notes", "prompts", "important_dates", "subscriptions", "transactions", "invoices"],
  notes: ["notes"],
  prompts: ["prompts"],
  career: ["job_applications", "job_user_state", "job_application_events", "cover_letter_templates"],
};

async function exportTables(supabase: Awaited<ReturnType<typeof createClient>>, tables: string[], userId: string) {
  const entries = await Promise.all(tables.map(async (table) => {
    const { data, error } = await supabase.from(table).select("*").eq("user_id", userId);
    return [table, error ? { unavailable: true, reason: error.message } : (data ?? [])] as const;
  }));
  return Object.fromEntries(entries);
}

async function exportLiveLegacy(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const ownTables = ["daily_pulse", "streaks", "streak_logs", "books", "book_pages", "sharing_prefs"];
  const result = await exportTables(supabase, ownTables, userId);
  // Legacy RLS already exposes only memberships/invites involving this user.
  const couples = await supabase.from("couples").select("*");
  const invites = await supabase.from("couple_invites").select("*");
  return {
    ...result,
    couples: couples.error ? { unavailable: true, reason: couples.error.message } : (couples.data ?? []),
    couple_invites: invites.error ? { unavailable: true, reason: invites.error.message } : (invites.data ?? []),
  };
}

function csvValue(value: unknown): string {
  const raw = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `"${raw.replaceAll('"', '""')}"`;
}

function toCsv(rows: unknown[]): string {
  const records = rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row));
  const headers = [...new Set(records.flatMap((row) => Object.keys(row)))];
  if (headers.length === 0) return "";
  return [headers.map(csvValue).join(","), ...records.map((row) => headers.map((header) => csvValue(row[header])).join(","))].join("\n");
}

export async function GET(request: Request, { params }: { params: Promise<{ scope: string }> }) {
  const { scope: rawScope } = await params;
  if (!SCOPES.includes(rawScope as Scope)) return NextResponse.json({ error: "Unknown export scope." }, { status: 404 });
  const scope = rawScope as Scope;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  let data: Record<string, unknown>;
  if (scope === "legacy") {
    const archive = await supabase.from("legacy_personal_archives").select("payload, archived_at").eq("user_id", user.id).maybeSingle();
    if (!archive.error && archive.data) {
      data = { archive: archive.data };
    } else {
      data = await exportLiveLegacy(supabase, user.id);
    }
  } else if (scope === "full") {
    const [profile, preferences] = await Promise.all([
      supabase.from("profiles").select("id,email,display_name,avatar_url,updated_at").eq("id", user.id).maybeSingle(),
      supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    ]);
    data = {
      account: { profile: profile.data ?? null, preferences: preferences.data ?? null },
      financial: await exportTables(supabase, TABLES.financial, user.id),
      professional: await exportTables(supabase, TABLES.professional, user.id),
      knowledge: await exportTables(supabase, TABLES.knowledge, user.id),
    };
  } else {
    data = await exportTables(supabase, TABLES[scope], user.id);
  }

  const exportedAt = new Date().toISOString();
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "csv" && scope !== "legacy" && scope !== "full") {
    const requestedTable = url.searchParams.get("table") ?? TABLES[scope][0];
    if (!TABLES[scope].includes(requestedTable)) return NextResponse.json({ error: "Table is not available in this scope." }, { status: 400 });
    const rows = data[requestedTable];
    if (!Array.isArray(rows)) return NextResponse.json({ error: "Table is unavailable." }, { status: 409 });
    return new NextResponse(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${brandConfig.fileNamePrefix}-${requestedTable}-${exportedAt.slice(0, 10)}.csv"`,
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const body = JSON.stringify({ product: brandConfig.name, schema_version: 1, scope, exported_at: exportedAt, data }, null, 2);
  return new NextResponse(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${brandConfig.fileNamePrefix}-${scope}-${exportedAt.slice(0, 10)}.json"`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
