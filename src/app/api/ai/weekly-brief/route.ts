import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { AI_MODELS, anthropicRuntime } from "@/lib/ai-config";
import { parseProjectBriefOutput } from "@/lib/ai-output";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const BRIEF_TOOL = {
  name: "weekly_operating_brief",
  description: "Return a concise source-grounded weekly operating brief.",
  input_schema: {
    type: "object",
    properties: {
      facts: { type: "array", maxItems: 8, items: { type: "string" } },
      risks: { type: "array", maxItems: 8, items: { type: "string" } },
      suggestions: { type: "array", maxItems: 8, items: { type: "string" } },
    },
    required: ["facts", "risks", "suggestions"],
  },
} as const;

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: preferences } = await supabase.from("user_preferences").select("ai_enabled,ai_sensitive_opt_in").eq("user_id", user.id).maybeSingle();
  if (preferences?.ai_enabled === false) return NextResponse.json({ error: "AI is disabled." }, { status: 403 });
  if (preferences?.ai_sensitive_opt_in !== true) return NextResponse.json({ error: "Sensitive AI access is not enabled." }, { status: 403 });
  const rl = await rateLimit(user.id, { key: "weekly-operating-brief", limit: 4, windowSec: 604800 });
  if (!rl.ok) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });

  const [projects, todos, opportunities, applications, dates, subscriptions, invoices, costs, crons] = await Promise.all([
    supabase.from("projects").select("id,name,status,revenue,revenue_currency,updated_at").eq("user_id", user.id).neq("status", "archived").limit(50),
    supabase.from("todos").select("id,title,done,due_date,project_id,importance").eq("user_id", user.id).eq("done", false).limit(100),
    supabase.from("client_opportunities").select("id,title,status,deadline,next_follow_up_at,project_id").eq("user_id", user.id).limit(60),
    supabase.from("job_applications").select("id,title,company,status,next_follow_up_at,updated_at").eq("user_id", user.id).limit(60),
    supabase.from("important_dates").select("id,title,the_date,project_id,organization_id").eq("user_id", user.id).limit(60),
    supabase.from("subscriptions").select("id,name,amount,currency,next_billing_date,project_id").eq("user_id", user.id).eq("is_active", true).limit(80),
    supabase.from("invoices").select("id,number,status,due_date,currency,project_id,organization_id").eq("user_id", user.id).limit(80),
    supabase.from("project_costs").select("id,project_id,label,amount,currency").eq("user_id", user.id).limit(100),
    supabase.from("crons").select("id,project_id,name,schedule,enabled,last_run_at").eq("user_id", user.id).limit(100),
  ]);
  const datasets = { projects, todos, opportunities, applications, dates, subscriptions, invoices, costs, crons } as unknown as Record<
    string,
    { data: ({ id: string } & Record<string, unknown>)[] | null; error: { message: string } | null }
  >;
  const failed = Object.values(datasets).find((result) => result.error);
  if (failed?.error) return NextResponse.json({ error: "Owned context could not be loaded." }, { status: 500 });
  const context = Object.fromEntries(Object.entries(datasets).map(([key, result]) => [key, result.data ?? []]));
  const sources = Object.entries(context).flatMap(([table, rows]) => (rows as { id: string }[]).map((row) => `${table}:${row.id}`)).slice(0, 180);

  const { apiKey, baseURL } = anthropicRuntime();
  if (!apiKey) return NextResponse.json({ error: "AI is unavailable." }, { status: 503 });
  const client = new Anthropic(baseURL ? { apiKey, baseURL } : { apiKey });
  try {
    const response = await client.messages.create({
      model: AI_MODELS.synthesis,
      max_tokens: 1400,
      tools: [BRIEF_TOOL] as unknown as Anthropic.Messages.Tool[],
      tool_choice: { type: "tool", name: "weekly_operating_brief" },
      system: "Create a weekly professional operating brief using only the supplied owned records. Separate observed facts, concrete risks, and non-destructive suggestions. Never invent activity, amounts, clients, deadlines, or outcomes. Suggestions are proposals only; do not claim any write occurred. Return only the tool call.",
      messages: [{ role: "user", content: JSON.stringify(context) }],
    });
    const tool = response.content.find((block) => block.type === "tool_use") as Anthropic.Messages.ToolUseBlock | undefined;
    const parsed = parseProjectBriefOutput(tool?.input);
    if (!parsed) return NextResponse.json({ error: "Invalid model output." }, { status: 502 });
    return NextResponse.json({ brief: { ...parsed, sources } }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "The weekly brief could not be generated." }, { status: 502 });
  }
}
