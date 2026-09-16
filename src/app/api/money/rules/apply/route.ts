import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import {
  parseActions,
  parseConditions,
  parseRules,
  ruleChanges,
  ruleMatches,
  usableRules,
  type OwnedIds,
  type RuleStage,
  type TransactionRule,
} from "@/lib/transaction-rules";

/**
 * Count or apply transaction rules across the owner's whole ledger.
 *
 * The Money editor can only see the bounded window the dashboard loads, so a
 * "matches N transactions" figure computed in the browser would be a half-truth
 * for anyone with more history than that. This route pages through every
 * transaction with the user's own session — own-only RLS is the scope boundary,
 * so there is no service-role client here — and returns honest counts, or
 * performs the retroactive update.
 *
 * Body:
 *   mode    "preview" (default) or "apply"
 *   ruleId  evaluate only this saved rule
 *   draft   preview only: an unsaved rule from the editor
 *   neither: the whole enabled rule set, folded in evaluation order
 */

const PAGE_SIZE = 1000;
// 60 pages ≈ 60k transactions. A personal ledger is far smaller; the cap keeps
// a pathological account from holding the request open indefinitely.
const MAX_PAGES = 60;
const UPDATE_CHUNK = 200;

export const dynamic = "force-dynamic";

type TransactionRow = {
  id: string;
  note: string | null;
  account_id: string | null;
  amount: number | string | null;
  occurred_on: string | null;
  kind: string | null;
  category: string | null;
  project_id: string | null;
  subscription_id: string | null;
};

const SELECT =
  "id, note, account_id, amount, occurred_on, kind, category, project_id, subscription_id";

type Body = {
  mode?: "preview" | "apply";
  ruleId?: string;
  draft?: {
    stage?: string;
    conditions?: unknown;
    actions?: unknown;
  };
};

function draftRule(draft: NonNullable<Body["draft"]>): TransactionRule {
  const stage =
    draft.stage === "pre" || draft.stage === "post" ? (draft.stage as RuleStage) : "default";
  return {
    id: "draft",
    user_id: "",
    name: "",
    stage,
    conditions: parseConditions(draft.conditions),
    actions: parseActions(draft.actions),
    sort_order: 0,
    enabled: true,
    created_at: "",
    updated_at: "",
  };
}

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const mode = body.mode === "apply" ? "apply" : "preview";
  if (mode === "apply" && body.draft) {
    return NextResponse.json(
      { error: "Save the rule before applying it." },
      { status: 400 },
    );
  }

  // Which rules to evaluate.
  let candidates: TransactionRule[];
  if (body.draft) {
    candidates = [draftRule(body.draft)];
  } else {
    const query = supabase.from("transaction_rules").select("*").eq("user_id", user.id);
    const { data, error } = body.ruleId
      ? await query.eq("id", body.ruleId)
      : await query
          .order("stage", { ascending: true })
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: "Could not read rules." }, { status: 500 });
    }
    if (body.ruleId && (data ?? []).length === 0) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    candidates = parseRules(data ?? []).rules;
  }

  // Applying only ever runs rules that are enabled and actually do something.
  // A preview of one named rule counts its matches even while it is switched
  // off or still missing an action, which is what the editor asks about.
  const single = Boolean(body.draft || body.ruleId);
  const rules =
    mode === "apply"
      ? usableRules(candidates)
      : single
        ? candidates.map((rule) => ({ ...rule, enabled: true }))
        : usableRules(candidates);

  if (rules.length === 0) {
    return NextResponse.json({ scanned: 0, matched: 0, changed: 0, updated: 0 });
  }

  const owned = await ownedIds(supabase, user.id);

  let scanned = 0;
  let matched = 0;
  let truncated = false;
  // Grouped by the exact change so one update covers every row that needs it.
  const byChange = new Map<string, string[]>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await supabase
      .from("transactions")
      .select(SELECT)
      .eq("user_id", user.id)
      .order("occurred_on", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return NextResponse.json({ error: "Could not read transactions." }, { status: 500 });
    }
    const rows = (data ?? []) as TransactionRow[];
    scanned += rows.length;

    for (const row of rows) {
      if (!rules.some((rule) => ruleMatches(row, rule))) continue;
      matched++;
      const changes = ruleChanges(row, rules, owned);
      if (Object.keys(changes).length === 0) continue;
      const key = JSON.stringify(changes);
      const ids = byChange.get(key);
      if (ids) ids.push(row.id);
      else byChange.set(key, [row.id]);
    }

    if (rows.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const changed = [...byChange.values()].reduce((total, ids) => total + ids.length, 0);

  if (mode === "preview") {
    return NextResponse.json({ scanned, matched, changed, updated: 0, truncated });
  }

  let updated = 0;
  for (const [key, ids] of byChange) {
    const patch = JSON.parse(key) as Record<string, string | null>;
    for (let index = 0; index < ids.length; index += UPDATE_CHUNK) {
      const chunk = ids.slice(index, index + UPDATE_CHUNK);
      const { error } = await supabase
        .from("transactions")
        .update(patch)
        .eq("user_id", user.id)
        .in("id", chunk);
      // A rejected chunk (for example a relationship the policies refuse) must
      // not abort the rest; it is simply not counted as updated.
      if (!error) updated += chunk.length;
    }
  }

  return NextResponse.json({ scanned, matched, changed, updated, truncated });
}

/** The owner's own project and subscription ids, so a rule action can never
 * write a foreign or stale relationship the transaction policies would reject. */
async function ownedIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<OwnedIds> {
  const [projects, subscriptions] = await Promise.all([
    supabase.from("projects").select("id").eq("user_id", userId),
    supabase.from("subscriptions").select("id").eq("user_id", userId),
  ]);
  const ids = (rows: { id: string }[] | null) =>
    new Set<string>((rows ?? []).map((row) => row.id));
  return {
    projectIds: ids(projects.data as { id: string }[] | null),
    subscriptionIds: ids(subscriptions.data as { id: string }[] | null),
  };
}
