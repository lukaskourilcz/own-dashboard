type Cycle = "monthly" | "yearly" | "weekly";
type Group = "development" | "entertainment" | "business" | "infrastructure" | "productivity" | "finance" | "other";
type Importance = "essential" | "useful" | "optional";

type SubscriptionsStrings = {
  title: string;
  description: string;
  displayIn: string;
  compactTitle: string;
  noSubscriptions: string;
  trackRecurringSpend: string;
  perMo: string;
  perYearAndActive: (yearly: string, active: number) => string;
  addSubscription: string;
  editSubscription: string;
  name: string;
  namePlaceholder: string;
  amount: string;
  amountPlaceholder: string;
  currency: string;
  billingCycle: string;
  cycle: Record<Cycle, string>;
  category: string;
  categoryPlaceholder: string;
  categoryGroup: string;
  group: Record<Group, string>;
  importance: string;
  importanceValue: Record<Importance, string>;
  nextBilling: string;
  project: string;
  generalOverhead: string;
  nameAndAmountRequired: string;
  renewalRequired: string;
  monthlySpend: string;
  yearlySpend: string;
  spendView: string;
  viewMonthly: string;
  viewYearly: string;
  noActiveSubscriptions: string;
  addFirstLeft: string;
  allCancelled: string;
  perMonth: string;
  perYear: string;
  perYearApprox: (yearly: string) => string;
  perMonthApprox: (monthly: string) => string;
  perMoApprox: (monthly: string) => string;
  perYr: (yearly: string) => string;
  next30Days: string;
  nothingBilling30: string;
  tagToday: string;
  tagTomorrow: string;
  tagInDays: (d: number) => string;
  overdueByDays: (d: number) => string;
  renewalMissing: string;
  allSubscriptions: string;
  nothingHereYet: string;
  addFirstForm: string;
  cancelled: string;
  nextOn: (date: string) => string;
  cancelSub: string;
  reactivate: string;
  cancelAria: string;
  reactivateAria: string;
};

export const subscriptions: {
  en: SubscriptionsStrings;
  cs: SubscriptionsStrings;
} = {
  en: {
    title: "Subscriptions",
    description: "Recurring spend across services.",
    displayIn: "Display in",
    compactTitle: "Subscriptions",
    noSubscriptions: "No subscriptions",
    trackRecurringSpend: "Track recurring spend in the Subscriptions tab.",
    perMo: "/mo",
    perYearAndActive: (yearly, active) => `${yearly} per year · ${active} active`,
    addSubscription: "Add subscription",
    editSubscription: "Edit subscription",
    name: "Name",
    namePlaceholder: "Netflix",
    amount: "Amount",
    amountPlaceholder: "9.99",
    currency: "Currency",
    billingCycle: "Billing cycle",
    cycle: { monthly: "Monthly", yearly: "Yearly", weekly: "Weekly" },
    category: "Category",
    categoryPlaceholder: "Entertainment",
    categoryGroup: "Spending group",
    group: { development: "Development", entertainment: "Entertainment", business: "Business / self-employment", infrastructure: "Infrastructure", productivity: "Productivity", finance: "Finance", other: "Other" },
    importance: "Importance",
    importanceValue: { essential: "Essential", useful: "Useful", optional: "Optional" },
    nextBilling: "Next billing",
    project: "Project",
    generalOverhead: "General overhead",
    nameAndAmountRequired: "Name and amount are required.",
    renewalRequired: "Active subscriptions need a next billing date.",
    monthlySpend: "Monthly spend",
    yearlySpend: "Yearly spend",
    spendView: "Spend view",
    viewMonthly: "Monthly",
    viewYearly: "Yearly",
    noActiveSubscriptions: "No active subscriptions",
    addFirstLeft: "Add your first subscription on the left.",
    allCancelled: "All subscriptions are cancelled.",
    perMonth: "per month",
    perYear: "per year",
    perYearApprox: (yearly) => `≈ ${yearly} per year`,
    perMonthApprox: (monthly) => `≈ ${monthly} per month`,
    perMoApprox: (monthly) => `≈ ${monthly}/mo`,
    perYr: (yearly) => `${yearly}/yr`,
    next30Days: "Next 30 days",
    nothingBilling30: "Nothing billing in the next 30 days.",
    tagToday: "today",
    tagTomorrow: "tomorrow",
    tagInDays: (d) => `in ${d}d`,
    overdueByDays: (d) => `${d}d overdue`,
    renewalMissing: "next payment missing",
    allSubscriptions: "All subscriptions",
    nothingHereYet: "Nothing here yet",
    addFirstForm: "Add your first subscription using the form.",
    cancelled: "cancelled",
    nextOn: (date) => `next ${date}`,
    cancelSub: "Cancel",
    reactivate: "Reactivate",
    cancelAria: "Cancel subscription",
    reactivateAria: "Reactivate subscription",
  },
  cs: {
    title: "Předplatná",
    description: "Opakované výdaje napříč službami.",
    displayIn: "Zobrazit v",
    compactTitle: "Předplatná",
    noSubscriptions: "Žádná předplatná",
    trackRecurringSpend: "Sledujte opakované výdaje v sekci Předplatná.",
    perMo: "/měs",
    perYearAndActive: (yearly, active) =>
      `${yearly} ročně · ${active} aktivních`,
    addSubscription: "Přidat předplatné",
    editSubscription: "Upravit předplatné",
    name: "Název",
    namePlaceholder: "Netflix",
    amount: "Částka",
    amountPlaceholder: "9.99",
    currency: "Měna",
    billingCycle: "Fakturační cyklus",
    cycle: { monthly: "Měsíčně", yearly: "Ročně", weekly: "Týdně" },
    category: "Kategorie",
    categoryPlaceholder: "Zábava",
    categoryGroup: "Skupina výdajů",
    group: { development: "Vývoj", entertainment: "Zábava", business: "Podnikání / OSVČ", infrastructure: "Infrastruktura", productivity: "Produktivita", finance: "Finance", other: "Ostatní" },
    importance: "Důležitost",
    importanceValue: { essential: "Nezbytné", useful: "Užitečné", optional: "Volitelné" },
    nextBilling: "Příští platba",
    project: "Projekt",
    generalOverhead: "Obecná režie",
    nameAndAmountRequired: "Název a částka jsou povinné.",
    renewalRequired: "Aktivní předplatné musí mít datum příští platby.",
    monthlySpend: "Měsíční výdaje",
    yearlySpend: "Roční výdaje",
    spendView: "Zobrazení výdajů",
    viewMonthly: "Měsíčně",
    viewYearly: "Ročně",
    noActiveSubscriptions: "Žádná aktivní předplatná",
    addFirstLeft: "Přidejte první předplatné vlevo.",
    allCancelled: "Všechna předplatná jsou zrušena.",
    perMonth: "měsíčně",
    perYear: "ročně",
    perYearApprox: (yearly) => `≈ ${yearly} ročně`,
    perMonthApprox: (monthly) => `≈ ${monthly} měsíčně`,
    perMoApprox: (monthly) => `≈ ${monthly}/měs`,
    perYr: (yearly) => `${yearly}/rok`,
    next30Days: "Příštích 30 dní",
    nothingBilling30: "Žádné platby v příštích 30 dnech.",
    tagToday: "dnes",
    tagTomorrow: "zítra",
    tagInDays: (d) => `za ${d} d`,
    overdueByDays: (d) => `${d} d po termínu`,
    renewalMissing: "chybí příští platba",
    allSubscriptions: "Všechna předplatná",
    nothingHereYet: "Zatím tu nic není",
    addFirstForm: "Přidejte první předplatné pomocí formuláře.",
    cancelled: "zrušeno",
    nextOn: (date) => `další ${date}`,
    cancelSub: "Zrušit",
    reactivate: "Obnovit",
    cancelAria: "Zrušit předplatné",
    reactivateAria: "Obnovit předplatné",
  },
};
