type SharingCategoryKey =
  | "subscriptions"
  | "todos"
  | "streaks"
  | "finances"
  | "plans"
  | "books";

type CategoryStrings = {
  label: string;
  hint: string;
};

type CoupleStrings = {
  title: string;
  description: string;
  paired: string;
  pairUp: string;
  unpair: string;
  inviteIntro: string;
  partnerEmail: string;
  partnerEmailPlaceholder: string;
  sendInvite: string;
  incoming: string;
  pairRequestWaiting: string;
  accept: string;
  decline: string;
  sent: string;
  cancelInvite: string;
  whatYouShare: string;
  partnerSeesShared: (name: string) => string;
  setSharedBeforePair: string;
  whatPartnerShares: (name: string) => string;
  partnerFallback: string;
  partnerFallbackYour: string;
  categories: Record<SharingCategoryKey, CategoryStrings>;
  status: Record<"pending" | "accepted" | "declined", string>;
  // Toasts
  ownEmail: string;
  inviteSent: (email: string) => string;
  inviteDeclined: string;
  paired_: string;
  unpaired: string;
  confirmUnpair: string;
  // Partner activity ticker
  partnerAdded: (name: string, summary: string) => string;
  and: string;
  task: (n: number) => string;
  habitCheckIn: (n: number) => string;
  transaction: (n: number) => string;
  plan: (n: number) => string;
  book: (n: number) => string;
  readingSession: (n: number) => string;
  dateItem: (n: number) => string;
  account: (n: number) => string;
  subscription: (n: number) => string;
};

/**
 * Czech count: 1 → singular, 2–4 → "X dny"/"X úkoly", 0 and 5+ → genitive plural.
 * Pass the three forms for one (1), few (2–4), and many (0, 5+).
 */
function csCount(n: number, one: string, few: string, many: string): string {
  if (n === 1) return `${n} ${one}`;
  if (n >= 2 && n <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

export const couple: { en: CoupleStrings; cs: CoupleStrings } = {
  en: {
    title: "Couple",
    description: "Pair up and choose what to share.",
    paired: "Paired",
    pairUp: "Pair up",
    unpair: "Unpair",
    inviteIntro:
      "Invite your partner's email. They'll see the invite the next time they sign in.",
    partnerEmail: "Partner's email",
    partnerEmailPlaceholder: "partner@example.com",
    sendInvite: "Send invite",
    incoming: "Incoming",
    pairRequestWaiting: "Pair request waiting",
    accept: "Accept",
    decline: "Decline",
    sent: "Sent",
    cancelInvite: "Cancel invite",
    whatYouShare: "What you share",
    partnerSeesShared: (name) =>
      `${name} sees anything you toggle on. Changes save instantly.`,
    setSharedBeforePair:
      "Set what you'd like shared. These take effect once you pair up.",
    whatPartnerShares: (name) => `What ${name} shares`,
    partnerFallback: "partner",
    partnerFallbackYour: "your partner",
    categories: {
      subscriptions: {
        label: "Subscriptions",
        hint: "Recurring spend and pie chart",
      },
      todos: { label: "Tasks", hint: "Open and completed tasks" },
      streaks: { label: "Habits", hint: "Habits, heatmap, and check-ins" },
      finances: { label: "Finances", hint: "Accounts, balances, transactions" },
      plans: { label: "Plans", hint: "Long-horizon goals and timeline" },
      books: { label: "Books", hint: "Pages written and book progress" },
    },
    status: {
      pending: "pending",
      accepted: "accepted",
      declined: "declined",
    },
    ownEmail: "That's your own email.",
    inviteSent: (email) => `Invite sent to ${email}.`,
    inviteDeclined: "Invite declined.",
    paired_: "You're paired. Reload to see shared data.",
    unpaired: "Unpaired.",
    confirmUnpair:
      "Unpair? Your partner will lose access to anything you share.",
    partnerAdded: (name, summary) => `${name} added ${summary}.`,
    and: "and",
    task: (n) => (n === 1 ? "a task" : `${n} tasks`),
    habitCheckIn: (n) => (n === 1 ? "a habit check-in" : `${n} habit check-ins`),
    transaction: (n) => (n === 1 ? "a transaction" : `${n} transactions`),
    plan: (n) => (n === 1 ? "a plan" : `${n} plans`),
    book: (n) => (n === 1 ? "a book" : `${n} books`),
    readingSession: (n) =>
      n === 1 ? "a reading session" : `${n} reading sessions`,
    dateItem: (n) => (n === 1 ? "a date" : `${n} dates`),
    account: (n) => (n === 1 ? "an account" : `${n} accounts`),
    subscription: (n) => (n === 1 ? "a subscription" : `${n} subscriptions`),
  },
  cs: {
    title: "Pár",
    description: "Spárujte se a vyberte, co sdílet.",
    paired: "Spárováno",
    pairUp: "Spárovat se",
    unpair: "Zrušit spárování",
    inviteIntro:
      "Pozvěte partnera jeho e-mailem. Pozvánku uvidí při příštím přihlášení.",
    partnerEmail: "E-mail partnera",
    partnerEmailPlaceholder: "partner@example.com",
    sendInvite: "Odeslat pozvánku",
    incoming: "Přijaté",
    pairRequestWaiting: "Žádost o spárování čeká",
    accept: "Přijmout",
    decline: "Odmítnout",
    sent: "Odeslané",
    cancelInvite: "Zrušit pozvánku",
    whatYouShare: "Co sdílíte",
    partnerSeesShared: (name) =>
      `${name} uvidí vše, co zapnete. Změny se ukládají okamžitě.`,
    setSharedBeforePair:
      "Nastavte, co chcete sdílet. Projeví se, jakmile se spárujete.",
    whatPartnerShares: (name) => `Co sdílí ${name}`,
    partnerFallback: "partner",
    partnerFallbackYour: "váš partner",
    categories: {
      subscriptions: {
        label: "Předplatná",
        hint: "Opakované výdaje a koláčový graf",
      },
      todos: { label: "Úkoly", hint: "Otevřené a dokončené úkoly" },
      streaks: { label: "Návyky", hint: "Návyky, heatmapa a odškrtnutí" },
      finances: { label: "Finance", hint: "Účty, zůstatky, transakce" },
      plans: { label: "Plány", hint: "Dlouhodobé cíle a časová osa" },
      books: { label: "Knihy", hint: "Napsané stránky a postup v knize" },
    },
    status: {
      pending: "čeká",
      accepted: "přijato",
      declined: "odmítnuto",
    },
    ownEmail: "To je váš vlastní e-mail.",
    inviteSent: (email) => `Pozvánka odeslána na ${email}.`,
    inviteDeclined: "Pozvánka odmítnuta.",
    paired_: "Jste spárováni. Načtěte znovu pro zobrazení sdílených dat.",
    unpaired: "Spárování zrušeno.",
    confirmUnpair:
      "Zrušit spárování? Partner ztratí přístup ke všemu, co sdílíte.",
    partnerAdded: (name, summary) => `${name} přidal(a) ${summary}.`,
    and: "a",
    task: (n) => csCount(n, "úkol", "úkoly", "úkolů"),
    habitCheckIn: (n) =>
      csCount(n, "odškrtnutí návyku", "odškrtnutí návyku", "odškrtnutí návyku"),
    transaction: (n) => csCount(n, "transakci", "transakce", "transakcí"),
    plan: (n) => csCount(n, "plán", "plány", "plánů"),
    book: (n) => csCount(n, "knihu", "knihy", "knih"),
    readingSession: (n) =>
      csCount(n, "čtenářské sezení", "čtenářská sezení", "čtenářských sezení"),
    dateItem: (n) => csCount(n, "významný den", "významné dny", "významných dní"),
    account: (n) => csCount(n, "účet", "účty", "účtů"),
    subscription: (n) => csCount(n, "předplatné", "předplatná", "předplatných"),
  },
};
