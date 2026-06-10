type FinancesStrings = {
  title: string;
  description: string;
  netWorth: string;
  acrossAccounts: (n: number) => string;
  accountNamePlaceholder: string;
  balancePlaceholder: string;
  addAccount: string;
  last6Months: string;
  noTransactionsYet: string;
  addFewTransactions: string;
  income: string;
  expense: string;
  addTransaction: string;
  amount: string;
  amountPlaceholder: string;
  ccy: string;
  category: string;
  categoryPlaceholder: string;
  date: string;
  account: string;
  noneOption: string;
  note: string;
  notePlaceholder: string;
  amountRequired: string;
  thisMonthByCategory: string;
  nothingThisMonth: string;
  categorizeHint: string;
  recentTransactions: string;
  addOnLeft: string;
  categoryUncategorized: string;
  categorySubscriptions: string;
  // date-fns pattern for the monthly bar-chart axis labels.
  monthFormat: string;
};

export const finances: { en: FinancesStrings; cs: FinancesStrings } = {
  en: {
    title: "Finances",
    description: "Accounts, transactions, and trends.",
    netWorth: "Net worth",
    acrossAccounts: (n) => `across ${n} account${n === 1 ? "" : "s"}`,
    accountNamePlaceholder: "Account name",
    balancePlaceholder: "Balance",
    addAccount: "Add account",
    last6Months: "Last 6 months",
    noTransactionsYet: "No transactions yet",
    addFewTransactions: "Add a few transactions to see income vs expense.",
    income: "Income",
    expense: "Expense",
    addTransaction: "Add transaction",
    amount: "Amount",
    amountPlaceholder: "12.50",
    ccy: "CCY",
    category: "Category",
    categoryPlaceholder: "Groceries",
    date: "Date",
    account: "Account",
    noneOption: "— None —",
    note: "Note",
    notePlaceholder: "Optional",
    amountRequired: "Amount is required.",
    thisMonthByCategory: "This month by category",
    nothingThisMonth: "Nothing this month",
    categorizeHint: "Categorize transactions to see the breakdown.",
    recentTransactions: "Recent transactions",
    addOnLeft: "Add a transaction on the left.",
    categoryUncategorized: "Uncategorized",
    categorySubscriptions: "Subscriptions",
    monthFormat: "MMM",
  },
  cs: {
    title: "Finance",
    description: "Účty, transakce a trendy.",
    netWorth: "Čisté jmění",
    acrossAccounts: (n) => (n === 1 ? "na 1 účtu" : `na ${n} účtech`),
    accountNamePlaceholder: "Název účtu",
    balancePlaceholder: "Zůstatek",
    addAccount: "Přidat účet",
    last6Months: "Posledních 6 měsíců",
    noTransactionsYet: "Zatím žádné transakce",
    addFewTransactions: "Přidejte několik transakcí a uvidíte příjmy vs. výdaje.",
    income: "Příjem",
    expense: "Výdaj",
    addTransaction: "Přidat transakci",
    amount: "Částka",
    amountPlaceholder: "12.50",
    ccy: "Měna",
    category: "Kategorie",
    categoryPlaceholder: "Potraviny",
    date: "Datum",
    account: "Účet",
    noneOption: "— Žádný —",
    note: "Poznámka",
    notePlaceholder: "Volitelné",
    amountRequired: "Částka je povinná.",
    thisMonthByCategory: "Tento měsíc podle kategorie",
    nothingThisMonth: "Tento měsíc nic",
    categorizeHint: "Roztřiďte transakce do kategorií a uvidíte rozdělení.",
    recentTransactions: "Poslední transakce",
    addOnLeft: "Přidejte transakci vlevo.",
    categoryUncategorized: "Nezařazeno",
    categorySubscriptions: "Předplatná",
    monthFormat: "LLL",
  },
};
