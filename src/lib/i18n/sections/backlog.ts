import type { BacklogProject, BacklogStatus } from "@/lib/backlog";

/** The Backlog section (owner request, 8 November 2026). Every string exists in English and Czech with the same meaning. */
const en = {
  title: "Backlog",
  description: "Tasks the agents on this laptop added when you asked them to put something in the backlog, and the ones you track yourself.",
  project: "Project",
  status: "Status",
  allProjects: "All projects",
  activeStatuses: "Open and in progress",
  allStatuses: "All statuses",
  projects: { heyDarlink: "heyDarlink", DNESKAi: "DNESKAi", devShark: "devShark", personal: "Personal" } satisfies Record<BacklogProject, string>,
  statuses: { open: "Open", in_progress: "In progress", done: "Done", dropped: "Dropped" } satisfies Record<BacklogStatus, string>,
  statusOf: (title: string) => `Status of ${title}`,
  addedBy: (source: string) => `Added by ${source}`,
  loading: "Loading the backlog…",
  unavailable: "The backlog could not be loaded. Check the connection, then refresh.",
  empty: "Nothing in the backlog yet.",
  emptyHint: "Ask an agent to add a task to the backlog, and it appears here.",
  noMatch: "No task matches these filters.",
  saveFailed: "The status could not be saved. Try again.",
  previewOnly: "Preview data. Status changes are not saved.",
  count: (shown: number, total: number) => shown === total ? `${total} tasks` : `${shown} of ${total} tasks`,
};

const cs: typeof en = {
  title: "Backlog",
  description: "Úkoly, které agenti na tomhle notebooku přidali, když jsi jim řekl, ať je dají do backlogu, a ty, které si vedeš sám.",
  project: "Projekt",
  status: "Stav",
  allProjects: "Všechny projekty",
  activeStatuses: "Otevřené a rozpracované",
  allStatuses: "Všechny stavy",
  projects: { heyDarlink: "heyDarlink", DNESKAi: "DNESKAi", devShark: "devShark", personal: "Osobní" },
  statuses: { open: "Otevřený", in_progress: "Rozpracovaný", done: "Hotový", dropped: "Zahozený" },
  statusOf: (title: string) => `Stav úkolu ${title}`,
  addedBy: (source: string) => `Přidal ${source}`,
  loading: "Načítám backlog…",
  unavailable: "Backlog se nepodařilo načíst. Zkontroluj připojení a obnov stránku.",
  empty: "Backlog je zatím prázdný.",
  emptyHint: "Řekni agentovi, ať úkol přidá do backlogu, a objeví se tady.",
  noMatch: "Těmto filtrům neodpovídá žádný úkol.",
  saveFailed: "Stav se nepodařilo uložit. Zkus to znovu.",
  previewOnly: "Ukázková data. Změny stavu se neukládají.",
  count: (shown: number, total: number) => shown === total ? `${total} úkolů` : `${shown} z ${total} úkolů`,
};

export const backlog = { en, cs };
