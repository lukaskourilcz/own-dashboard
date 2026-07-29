import type { WidgetId } from "@/lib/dashboard-layout";

type DashboardStrings = {
  customize: string;
  done: string;
  addWidget: string;
  addTitle: string;
  addDescription: string;
  allAdded: string;
  reset: string;
  resetConfirm: string;
  remove: string;
  dragToReorder: string;
  editingHint: string;
  emptyTitle: string;
  emptyDescription: string;
  widgetNames: Record<WidgetId, string>;
  widgetDescriptions: Record<WidgetId, string>;
  crons: {
    title: string;
    today: string;
    history: string;
    emptyToday: string;
    emptyDay: string;
    prevDay: string;
    nextDay: string;
    endpointCol: string;
    statusSuccess: string;
    statusFailure: string;
    statusRunning: string;
    unavailable: string;
    summary: (ok: number, fail: number) => string;
  };
};

export const dashboard: { en: DashboardStrings; cs: DashboardStrings } = {
  en: {
    customize: "Customize",
    done: "Done",
    addWidget: "Add widget",
    addTitle: "Add a widget",
    addDescription: "Choose a widget to add to your dashboard.",
    allAdded: "Every widget is already on your dashboard.",
    reset: "Reset",
    resetConfirm: "Reset the dashboard to its default layout?",
    remove: "Remove widget",
    dragToReorder: "Drag to reorder",
    editingHint: "Drag widgets to reorder, or remove them with ×.",
    emptyTitle: "Your dashboard is empty",
    emptyDescription: "Add a widget to get started.",
    widgetNames: {
      "today-hero": "Today",
      kpi: "Highlights",
      todos: "Tasks",
      crons: "Crons",
      "work-attention": "Work attention",
      subscriptions: "Subscriptions",
      calendar: "Calendar",
      goals: "Recurring goals",
    },
    widgetDescriptions: {
      "today-hero": "Greeting, today's events, and what needs attention.",
      kpi: "Your key numbers at a glance.",
      todos: "Your open tasks.",
      crons: "Today's scheduled cron runs and a 14-day log history.",
      "work-attention": "Projects, opportunities, applications, and invoices that need action.",
      subscriptions: "Recurring spend overview.",
      calendar: "Add and view calendar events.",
      goals: "Recurring goals still due this period.",
    },
    crons: {
      title: "Crons",
      today: "Today",
      history: "Log history",
      emptyToday: "No cron runs recorded today.",
      emptyDay: "No cron runs on this day.",
      prevDay: "Previous day",
      nextDay: "Next day",
      endpointCol: "Endpoint",
      statusSuccess: "Success",
      statusFailure: "Failed",
      statusRunning: "Running",
      unavailable: "Cron history is unavailable.",
      summary: (ok, fail) => `${ok} ok · ${fail} failed`,
    },
  },
  cs: {
    customize: "Přizpůsobit",
    done: "Hotovo",
    addWidget: "Přidat widget",
    addTitle: "Přidat widget",
    addDescription: "Vyberte widget, který chcete přidat na nástěnku.",
    allAdded: "Všechny widgety už jsou na nástěnce.",
    reset: "Obnovit",
    resetConfirm: "Obnovit výchozí rozložení nástěnky?",
    remove: "Odebrat widget",
    dragToReorder: "Přetažením změníte pořadí",
    editingHint: "Přetažením změníte pořadí, křížkem × widget odeberete.",
    emptyTitle: "Nástěnka je prázdná",
    emptyDescription: "Začněte přidáním widgetu.",
    widgetNames: {
      "today-hero": "Dnes",
      kpi: "Přehled",
      todos: "Úkoly",
      crons: "Crony",
      "work-attention": "Pracovní pozornost",
      subscriptions: "Předplatná",
      calendar: "Kalendář",
      goals: "Opakující se cíle",
    },
    widgetDescriptions: {
      "today-hero": "Pozdrav, dnešní události a co vyžaduje pozornost.",
      kpi: "Klíčová čísla na první pohled.",
      todos: "Vaše otevřené úkoly.",
      crons: "Dnešní spuštěné crony a historie logů za 14 dní.",
      "work-attention": "Projekty, příležitosti, žádosti a faktury vyžadující akci.",
      subscriptions: "Přehled opakovaných výdajů.",
      calendar: "Přidávejte a prohlížejte události kalendáře.",
      goals: "Opakující se cíle k splnění v tomto období.",
    },
    crons: {
      title: "Crony",
      today: "Dnes",
      history: "Historie logů",
      emptyToday: "Dnes nebyl zaznamenán žádný běh cronu.",
      emptyDay: "V tento den žádné běhy cronů.",
      prevDay: "Předchozí den",
      nextDay: "Další den",
      endpointCol: "Endpoint",
      statusSuccess: "Úspěch",
      statusFailure: "Selhalo",
      statusRunning: "Běží",
      unavailable: "Historie cronů není dostupná.",
      summary: (ok, fail) => `${ok} ok · ${fail} selhalo`,
    },
  },
};
