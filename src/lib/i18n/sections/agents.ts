type AgentStrings = {
  title: string;
  description: string;
  queueTask: string;
  taskTitle: string;
  taskTitlePlaceholder: string;
  instructions: string;
  instructionsPlaceholder: string;
  agent: string;
  anyAgent: string;
  agentPlaceholder: string;
  project: string;
  noProject: string;
  priority: string;
  create: string;
  required: string;
  queue: string;
  refresh: string;
  noTasks: string;
  noTasksDescription: string;
  status: Record<"queued" | "running" | "completed" | "failed" | "cancelled", string>;
  cancel: string;
  requeue: string;
  remove: string;
  removeConfirm: string;
  result: string;
  waitingForResult: string;
  created: string;
  vpsBoundary: string;
  priorityLabel: (value: number) => string;
};

export const agents: { en: AgentStrings; cs: AgentStrings } = {
  en: {
    title: "Agents",
    description: "Queue explicit tasks for workers running on your VPS and inspect their results.",
    queueTask: "Queue a task",
    taskTitle: "Task",
    taskTitlePlaceholder: "Audit the release candidate",
    instructions: "Instructions",
    instructionsPlaceholder: "Describe the expected outcome, relevant paths, constraints, and validation…",
    agent: "Target agent",
    anyAgent: "Any agent",
    agentPlaceholder: "codex-vps-1",
    project: "Project",
    noProject: "No project",
    priority: "Priority",
    create: "Add to queue",
    required: "Task title and instructions are required.",
    queue: "Task queue",
    refresh: "Refresh results",
    noTasks: "No agent tasks",
    noTasksDescription: "Create an explicit task. A configured VPS worker can then claim it.",
    status: { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", cancelled: "Cancelled" },
    cancel: "Cancel",
    requeue: "Queue again",
    remove: "Delete",
    removeConfirm: "Delete this task and its result?",
    result: "Result",
    waitingForResult: "The worker has not returned a result yet.",
    created: "Created",
    vpsBoundary: "Workers authenticate server-to-server. Browser users never receive the VPS token, and tasks cannot execute arbitrary commands inside the dashboard.",
    priorityLabel: (value) => `P${value}`,
  },
  cs: {
    title: "Agenti",
    description: "Zadávejte konkrétní úkoly workerům na VPS a kontrolujte jejich výsledky.",
    queueTask: "Zadat úkol",
    taskTitle: "Úkol",
    taskTitlePlaceholder: "Prověř release candidate",
    instructions: "Instrukce",
    instructionsPlaceholder: "Popište očekávaný výsledek, relevantní cesty, omezení a validaci…",
    agent: "Cílový agent",
    anyAgent: "Libovolný agent",
    agentPlaceholder: "codex-vps-1",
    project: "Projekt",
    noProject: "Bez projektu",
    priority: "Priorita",
    create: "Přidat do fronty",
    required: "Název úkolu a instrukce jsou povinné.",
    queue: "Fronta úkolů",
    refresh: "Načíst výsledky",
    noTasks: "Žádné úkoly pro agenty",
    noTasksDescription: "Vytvořte konkrétní úkol. Nakonfigurovaný worker na VPS si ho potom vyzvedne.",
    status: { queued: "Ve frontě", running: "Probíhá", completed: "Dokončeno", failed: "Selhalo", cancelled: "Zrušeno" },
    cancel: "Zrušit",
    requeue: "Zařadit znovu",
    remove: "Smazat",
    removeConfirm: "Smazat tento úkol i jeho výsledek?",
    result: "Výsledek",
    waitingForResult: "Worker zatím nevrátil výsledek.",
    created: "Vytvořeno",
    vpsBoundary: "Workery se ověřují mezi servery. Prohlížeč nikdy nedostane VPS token a dashboard sám nespouští libovolné příkazy.",
    priorityLabel: (value) => `P${value}`,
  },
};
