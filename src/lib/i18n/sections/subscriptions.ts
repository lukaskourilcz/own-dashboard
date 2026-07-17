type Cycle = "monthly" | "yearly" | "weekly";

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
  nextBilling: string;
  nameAndAmountRequired: string;
  monthlySpend: string;
  noActiveSubscriptions: string;
  addFirstLeft: string;
  allCancelled: string;
  perMonth: string;
  perYearApprox: (yearly: string) => string;
  perMoApprox: (monthly: string) => string;
  next30Days: string;
  nothingBilling30: string;
  tagToday: string;
  tagTomorrow: string;
  tagInDays: (d: number) => string;
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
    nextBilling: "Next billing",
    nameAndAmountRequired: "Name and amount are required.",
    monthlySpend: "Monthly spend",
    noActiveSubscriptions: "No active subscriptions",
    addFirstLeft: "Add your first subscription on the left.",
    allCancelled: "All subscriptions are cancelled.",
    perMonth: "per month",
    perYearApprox: (yearly) => `≈ ${yearly} per year`,
    perMoApprox: (monthly) => `≈ ${monthly}/mo`,
    next30Days: "Next 30 days",
    nothingBilling30: "Nothing billing in the next 30 days.",
    tagToday: "today",
    tagTomorrow: "tomorrow",
    tagInDays: (d) => `in ${d}d`,
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
    nextBilling: "Příští platba",
    nameAndAmountRequired: "Název a částka jsou povinné.",
    monthlySpend: "Měsíční výdaje",
    noActiveSubscriptions: "Žádná aktivní předplatná",
    addFirstLeft: "Přidejte první předplatné vlevo.",
    allCancelled: "Všechna předplatná jsou zrušena.",
    perMonth: "měsíčně",
    perYearApprox: (yearly) => `≈ ${yearly} ročně`,
    perMoApprox: (monthly) => `≈ ${monthly}/měs`,
    next30Days: "Příštích 30 dní",
    nothingBilling30: "Žádné platby v příštích 30 dnech.",
    tagToday: "dnes",
    tagTomorrow: "zítra",
    tagInDays: (d) => `za ${d} d`,
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
