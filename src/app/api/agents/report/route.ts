import { NextResponse } from "next/server";
import { authorizeAgentRunner } from "@/lib/agents/runner-auth";
import { createAdminClient } from "@/lib/supabase/admin";

type ReportBody = {
  task_id?: unknown;
  agent_name?: unknown;
  status?: unknown;
  result?: unknown;
};

export async function POST(request: Request) {
  const runner = authorizeAgentRunner(request);
  if (!runner) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const body = await request.json().catch(() => null) as ReportBody | null;
  const taskId = typeof body?.task_id === "string" ? body.task_id : "";
  const agentName = typeof body?.agent_name === "string" ? body.agent_name.trim().slice(0, 120) : "";
  const status = body?.status === "completed" || body?.status === "failed" ? body.status : null;
  const result = typeof body?.result === "string" ? body.result.trim().slice(0, 50000) : "";
  if (!taskId || !agentName || !status || !result) {
    return NextResponse.json({ error: "task_id, agent_name, status, and result are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("agent_tasks")
    .update({ status, result, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", taskId)
    .eq("user_id", runner.ownerId)
    .eq("agent_name", agentName)
    .eq("status", "running")
    .select("id, status, completed_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Task is not currently claimed by this agent." }, { status: 409 });
  return NextResponse.json({ task: data });
}
