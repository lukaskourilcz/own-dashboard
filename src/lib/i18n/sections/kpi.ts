type KpiStrings = {
  monthlyRecurring: string;
  subscriptions: string;
  openTasks: string;
  nDone: (n: number) => string;
  longestActiveStreak: string;
  trackHabitHint: string;
  days: (n: number) => string;
};

export const kpi: { en: KpiStrings; cs: KpiStrings } = {
  en: {
    monthlyRecurring: "Monthly recurring",
    subscriptions: "subscriptions",
    openTasks: "Open tasks",
    nDone: (n) => `${n} done`,
    longestActiveStreak: "Longest active streak",
    trackHabitHint: "Track a habit to see it here",
    days: (n) => `${n}d`,
  },
  cs: {
    monthlyRecurring: "Měsíční výdaje",
    subscriptions: "předplatná",
    openTasks: "Otevřené úkoly",
    nDone: (n) => `${n} hotovo`,
    longestActiveStreak: "Nejdelší aktivní série",
    trackHabitHint: "Sledujte návyk a uvidíte ho zde",
    days: (n) => `${n} d`,
  },
};
