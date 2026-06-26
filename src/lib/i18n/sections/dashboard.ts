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
      "quick-add": "Quick add",
      kpi: "Highlights",
      todos: "Tasks",
      streaks: "Habits",
      subscriptions: "Subscriptions",
      calendar: "Calendar",
      plans: "Recurring plans",
    },
    widgetDescriptions: {
      "today-hero": "Greeting, today's events, and what needs attention.",
      "quick-add": "Add a task, habit check-in, or event in one line.",
      kpi: "Your key numbers at a glance.",
      todos: "Your open tasks.",
      streaks: "Daily habit tracking.",
      subscriptions: "Recurring spend overview.",
      calendar: "Add and view calendar events.",
      plans: "Recurring plans still due this period.",
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
      "quick-add": "Rychlé přidání",
      kpi: "Přehled",
      todos: "Úkoly",
      streaks: "Návyky",
      subscriptions: "Předplatná",
      calendar: "Kalendář",
      plans: "Opakující se plány",
    },
    widgetDescriptions: {
      "today-hero": "Pozdrav, dnešní události a co vyžaduje pozornost.",
      "quick-add": "Přidejte úkol, návyk nebo událost jedním řádkem.",
      kpi: "Klíčová čísla na první pohled.",
      todos: "Vaše otevřené úkoly.",
      streaks: "Sledování denních návyků.",
      subscriptions: "Přehled opakovaných výdajů.",
      calendar: "Přidávejte a prohlížejte události kalendáře.",
      plans: "Opakující se plány k splnění v tomto období.",
    },
  },
};
