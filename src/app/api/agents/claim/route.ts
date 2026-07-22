import { NextResponse } from "next/server";
import { authorizeAgentRunner } from "@/lib/agents/runner-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const runner = authorizeAgentRunner(request);
  if (!runner) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const body = await request.json().catch(() => null) as { agent_name?: unknown } | null;
  const agentName = typeof body?.agent_name === "string" ? body.agent_name.trim().slice(0, 120) : null;
  if (!agentName) return NextResponse.json({ error: "agent_name is required." }, { status: 400 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_agent_task", {
    p_user_id: runner.ownerId,
    p_agent_name: agentName,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const task = Array.isArray(data) ? data[0] ?? null : null;
  return NextResponse.json({ task });
}
