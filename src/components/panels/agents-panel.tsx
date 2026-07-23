"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Plus, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { AgentTask, AgentTaskStatus, Project, Updater } from "@/lib/types";

type Props = {
  tasks: AgentTask[];
  setTasks: Updater<AgentTask[]>;
  projects: Project[];
};

const EMPTY_FORM = { title: "", instructions: "", agentName: "", projectId: "", priority: "3" };

export function AgentsPanel({ tasks, setTasks, projects }: Props) {
  const t = useDict();
  const s = t.agents;
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirmation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim() || !form.instructions.trim()) {
      setError(s.required);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error(t.quickAdd.signInFirst);
      const { data, error: insertError } = await supabase
        .from("agent_tasks")
        .insert({
          user_id: userId,
          title: form.title.trim(),
          instructions: form.instructions.trim(),
          agent_name: form.agentName.trim() || null,
          project_id: form.projectId || null,
          priority: Number(form.priority),
        })
        .select()
        .single();
      if (insertError || !data) throw insertError ?? new Error("no-data");
      setTasks((prev) => [data as AgentTask, ...prev]);
      setForm(EMPTY_FORM);
      void qc.invalidateQueries({ queryKey: qk.agentTasks });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function updateTask(task: AgentTask, status: AgentTaskStatus) {
    const patch = status === "queued"
      ? { status, result: null, claimed_at: null, completed_at: null, updated_at: new Date().toISOString() }
      : { status, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { data, error: updateError } = await supabase
      .from("agent_tasks")
      .update(patch)
      .eq("id", task.id)
      .select()
      .single();
    if (updateError || !data) return toast.err(updateError?.message ?? s.required);
    setTasks((prev) => prev.map((item) => item.id === task.id ? data as AgentTask : item));
    void qc.invalidateQueries({ queryKey: qk.agentTasks });
  }

  async function removeTask(task: AgentTask) {
    if (!await confirm({
      title: s.remove,
      description: s.removeConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) return;
    const { error: deleteError } = await supabase.from("agent_tasks").delete().eq("id", task.id);
    if (deleteError) return toast.err(deleteError.message);
    setTasks((prev) => prev.filter((item) => item.id !== task.id));
  }

  return <div>
    <PageHeader title={s.title} description={s.description} />
    <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.75fr)_minmax(0,2fr)]">
      <Card>
        <CardHeader><CardTitle>{s.queueTask}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="agent-task-title">{s.taskTitle}</Label><Input id="agent-task-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={s.taskTitlePlaceholder} /></div>
            <div className="space-y-1.5"><Label htmlFor="agent-task-instructions">{s.instructions}</Label><Textarea id="agent-task-instructions" value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} placeholder={s.instructionsPlaceholder} rows={7} /></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="agent-task-agent">{s.agent}</Label><Input id="agent-task-agent" value={form.agentName} onChange={(event) => setForm({ ...form, agentName: event.target.value })} placeholder={s.agentPlaceholder} /></div>
              <div className="space-y-1.5"><Label htmlFor="agent-task-priority">{s.priority}</Label><SimpleSelect value={form.priority} onValueChange={(priority) => setForm({ ...form, priority })} aria-label={s.priority} options={[5, 4, 3, 2, 1].map((value) => ({ value: String(value), label: s.priorityLabel(value) }))} /></div>
            </div>
            <div className="space-y-1.5"><Label htmlFor="agent-task-project">{s.project}</Label><SimpleSelect value={form.projectId} onValueChange={(projectId) => setForm({ ...form, projectId })} aria-label={s.project} options={[{ value: "", label: s.noProject }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} /></div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <Button type="submit" disabled={saving}><Plus />{s.create}</Button>
            <p className="border-t border-border pt-3 text-xs leading-relaxed text-foreground-muted">{s.vpsBoundary}</p>
          </form>
        </CardContent>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{s.queue}</CardTitle><Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: qk.agentTasks })}><RefreshCw />{s.refresh}</Button></CardHeader>
        <CardContent className="p-0">
          {tasks.length === 0 ? <EmptyState icon={Bot} title={s.noTasks} description={s.noTasksDescription} className="py-16" /> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-y border-border bg-surface-secondary text-xs text-foreground-muted"><tr><th scope="col" className="px-4 py-2.5 font-medium">{s.taskTitle}</th><th scope="col" className="px-3 py-2.5 font-medium">{s.agent}</th><th scope="col" className="px-3 py-2.5 font-medium">{s.project}</th><th scope="col" className="px-3 py-2.5 font-medium">{s.priority}</th><th scope="col" className="px-3 py-2.5 font-medium">{s.status.queued}</th><th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th></tr></thead><tbody className="divide-y divide-border">
            {tasks.map((task) => {
              const project = projects.find((item) => item.id === task.project_id);
              return <tr key={task.id} className="align-top hover:bg-surface-hover">
                <td className="max-w-lg px-4 py-3"><p className="font-medium text-foreground">{task.title}</p><p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground-muted">{task.instructions}</p>{(task.result || task.status === "running") && <details className="mt-2"><summary className="cursor-pointer text-xs font-medium text-foreground-muted">{s.result}</summary><p className="mt-1 whitespace-pre-wrap rounded-md bg-surface-inset p-2 text-xs leading-relaxed">{task.result || s.waitingForResult}</p></details>}<p className="mt-2 text-[11px] text-foreground-subtle tabular">{s.created} {task.created_at.slice(0, 16).replace("T", " ")}</p></td>
                <td className="px-3 py-3 text-xs text-foreground-muted">{task.agent_name || s.anyAgent}</td>
                <td className="px-3 py-3 text-xs text-foreground-muted">{project?.name || s.noProject}</td>
                <td className="px-3 py-3 font-mono text-xs">{s.priorityLabel(task.priority)}</td>
                <td className="px-3 py-3"><StatusBadge value={task.status} label={s.status[task.status]} /></td>
                <td className="px-4 py-3"><div className="flex justify-end gap-1">{(task.status === "queued" || task.status === "running") && <Button size="icon-sm" variant="ghost" aria-label={s.cancel} onClick={() => void updateTask(task, "cancelled")}><Square /></Button>}{(task.status === "failed" || task.status === "cancelled") && <Button size="icon-sm" variant="ghost" aria-label={s.requeue} onClick={() => void updateTask(task, "queued")}><RotateCcw /></Button>}{task.status !== "running" && <Button size="icon-sm" variant="ghost" aria-label={s.remove} onClick={() => void removeTask(task)}><Trash2 /></Button>}</div></td>
              </tr>;
            })}
          </tbody></table></div>}
        </CardContent>
      </Card>
    </div>
  </div>;
}
