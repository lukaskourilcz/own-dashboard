type KpiStrings = {
  monthlyRecurring: string;
  subscriptions: string;
  openTasks: string;
  nDone: (n: number) => string;
  activeProjects: string;
  projectPortfolio: string;
};

export const kpi: { en: KpiStrings; cs: KpiStrings } = {
  en: {
    monthlyRecurring: "Monthly recurring",
    subscriptions: "subscriptions",
    openTasks: "Open tasks",
    nDone: (n) => `${n} done`,
    activeProjects: "Active projects",
    projectPortfolio: "professional portfolio",
  },
  cs: {
    monthlyRecurring: "Měsíční výdaje",
    subscriptions: "předplatná",
    openTasks: "Otevřené úkoly",
    nDone: (n) => `${n} hotovo`,
    activeProjects: "Aktivní projekty",
    projectPortfolio: "profesní portfolio",
  },
};
