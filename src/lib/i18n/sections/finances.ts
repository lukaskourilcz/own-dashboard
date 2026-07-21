type FinancesStrings = {
  title: string;
  description: string;
  netWorth: string;
  acrossAccounts: (n: number) => string;
  accountsTitle: string;
  thisMonth: string;
  net: string;
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
  project: string;
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
  bank: BankStrings;
};

type BankStrings = {
  title: string;
  subtitle: string;
  connect: string;
  connecting: string;
  pickBank: string;
  pickBankDesc: string;
  searchBank: string;
  noBanks: string;
  notConfigured: string;
  loadBanksErr: string;
  connectErr: string;
  syncNow: string;
  syncing: string;
  syncDone: (n: number) => string;
  syncNothing: string;
  syncErr: string;
  linkedToast: string;
  linkErrToast: string;
  disconnect: string;
  disconnectConfirm: string;
  lastSynced: (date: string) => string;
  neverSynced: string;
  statusLinked: string;
  statusCreated: string;
  statusExpired: string;
  statusError: string;
  connectedTitle: string;
  importTitle: string;
  csvHint: string;
  chooseFile: string;
  csvReady: (rows: number, skipped: number) => string;
  csvColumns: (date: string, amount: string) => string;
  import: string;
  importing: string;
  importDone: (added: number, dup: number) => string;
  importErr: string;
  csvParseErr: string;
  nothingToImport: string;
  rulesTitle: string;
  rulesHint: string;
  ruleMatchPlaceholder: string;
  ruleCategoryPlaceholder: string;
  addRule: string;
  noRules: string;
  applyToUncategorized: string;
  applyDone: (n: number) => string;
  applyNothing: string;
};

export const finances: { en: FinancesStrings; cs: FinancesStrings } = {
  en: {
    title: "Money",
    description: "Accounts, transactions, and trends.",
    netWorth: "Net worth",
    acrossAccounts: (n) => `across ${n} account${n === 1 ? "" : "s"}`,
    accountsTitle: "Accounts",
    thisMonth: "This month",
    net: "Net",
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
    project: "Project",
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
    bank: {
      title: "Bank sync",
      subtitle: "Pull balances and transactions automatically, or import a CSV.",
      connect: "Connect bank",
      connecting: "Connecting…",
      pickBank: "Choose your bank",
      pickBankDesc: "You'll be sent to your bank to approve read-only access.",
      searchBank: "Search banks…",
      noBanks: "No banks match.",
      notConfigured:
        "Live bank sync isn't configured on this server — you can still import a CSV below.",
      loadBanksErr: "Couldn't load the bank list.",
      connectErr: "Couldn't start the connection. Please try again.",
      syncNow: "Sync now",
      syncing: "Syncing…",
      syncDone: (n) =>
        n === 1 ? "Imported 1 new transaction." : `Imported ${n} new transactions.`,
      syncNothing: "Already up to date.",
      syncErr: "Sync failed. Please try again.",
      linkedToast: "Bank linked — syncing…",
      linkErrToast: "Bank connection failed.",
      disconnect: "Disconnect",
      disconnectConfirm:
        "Disconnect this bank? Transactions already imported will stay.",
      lastSynced: (date) => `synced ${date}`,
      neverSynced: "not synced yet",
      statusLinked: "Connected",
      statusCreated: "Pending",
      statusExpired: "Expired",
      statusError: "Error",
      connectedTitle: "Connected banks",
      importTitle: "Import from CSV",
      csvHint:
        "Export a statement from internet banking (CSV) and drop it here.",
      chooseFile: "Choose CSV file",
      csvReady: (rows, skipped) =>
        `${rows} row${rows === 1 ? "" : "s"} ready${
          skipped ? `, ${skipped} skipped` : ""
        }.`,
      csvColumns: (date, amount) =>
        `Reading “${date}” as date, “${amount}” as amount.`,
      import: "Import",
      importing: "Importing…",
      importDone: (added, dup) =>
        `Imported ${added}${dup ? `, skipped ${dup} duplicate${dup === 1 ? "" : "s"}` : ""}.`,
      importErr: "Import failed. Please try again.",
      csvParseErr: "Couldn't read that file.",
      nothingToImport: "No new transactions to import.",
      rulesTitle: "Auto-categories",
      rulesHint:
        "When an imported transaction's description contains the text, file it under this category.",
      ruleMatchPlaceholder: "Text in description (e.g. Albert)",
      ruleCategoryPlaceholder: "Category (e.g. Groceries)",
      addRule: "Add rule",
      noRules: "No rules yet.",
      applyToUncategorized: "Apply to uncategorized",
      applyDone: (n) =>
        n === 1 ? "Categorized 1 transaction." : `Categorized ${n} transactions.`,
      applyNothing: "Nothing to categorize.",
    },
  },
  cs: {
    title: "Peníze",
    description: "Účty, transakce a trendy.",
    netWorth: "Čisté jmění",
    acrossAccounts: (n) => (n === 1 ? "na 1 účtu" : `na ${n} účtech`),
    accountsTitle: "Účty",
    thisMonth: "Tento měsíc",
    net: "Netto",
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
    project: "Projekt",
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
    bank: {
      title: "Napojení banky",
      subtitle: "Automaticky stáhni zůstatky a transakce, nebo naimportuj CSV.",
      connect: "Připojit banku",
      connecting: "Připojuji…",
      pickBank: "Vyber svou banku",
      pickBankDesc: "Budeš přesměrován do banky pro schválení čtení dat.",
      searchBank: "Hledat banku…",
      noBanks: "Žádná banka neodpovídá.",
      notConfigured:
        "Živé napojení banky není na serveru nastavené — níže můžeš přesto naimportovat CSV.",
      loadBanksErr: "Nepodařilo se načíst seznam bank.",
      connectErr: "Spojení se nepodařilo zahájit. Zkus to znovu.",
      syncNow: "Synchronizovat",
      syncing: "Synchronizuji…",
      syncDone: (n) => {
        if (n === 1) return "Naimportována 1 nová transakce.";
        if (n >= 2 && n <= 4) return `Naimportovány ${n} nové transakce.`;
        return `Naimportováno ${n} nových transakcí.`;
      },
      syncNothing: "Vše je aktuální.",
      syncErr: "Synchronizace selhala. Zkus to znovu.",
      linkedToast: "Banka propojena — synchronizuji…",
      linkErrToast: "Napojení banky selhalo.",
      disconnect: "Odpojit",
      disconnectConfirm:
        "Odpojit tuto banku? Už naimportované transakce zůstanou.",
      lastSynced: (date) => `synchronizováno ${date}`,
      neverSynced: "zatím nesynchronizováno",
      statusLinked: "Připojeno",
      statusCreated: "Čeká na potvrzení",
      statusExpired: "Vypršelo",
      statusError: "Chyba",
      connectedTitle: "Připojené banky",
      importTitle: "Import z CSV",
      csvHint:
        "Exportuj výpis z internetového bankovnictví (CSV) a nahraj ho sem.",
      chooseFile: "Vybrat CSV soubor",
      csvReady: (rows, skipped) => {
        const r =
          rows === 1
            ? "1 řádek připraven"
            : rows >= 2 && rows <= 4
              ? `${rows} řádky připraveny`
              : `${rows} řádků připraveno`;
        return `${r}${skipped ? `, ${skipped} přeskočeno` : ""}.`;
      },
      csvColumns: (date, amount) =>
        `Čtu „${date}" jako datum, „${amount}" jako částku.`,
      import: "Importovat",
      importing: "Importuji…",
      importDone: (added, dup) =>
        `Naimportováno ${added}${dup ? `, přeskočeno ${dup} duplicit` : ""}.`,
      importErr: "Import selhal. Zkus to znovu.",
      csvParseErr: "Soubor se nepodařilo přečíst.",
      nothingToImport: "Žádné nové transakce k importu.",
      rulesTitle: "Auto-kategorie",
      rulesHint:
        "Když popis naimportované transakce obsahuje daný text, zařadí se do této kategorie.",
      ruleMatchPlaceholder: "Text v popisu (např. Albert)",
      ruleCategoryPlaceholder: "Kategorie (např. Potraviny)",
      addRule: "Přidat pravidlo",
      noRules: "Zatím žádná pravidla.",
      applyToUncategorized: "Použít na nezařazené",
      applyDone: (n) => {
        if (n === 1) return "Zařazena 1 transakce.";
        if (n >= 2 && n <= 4) return `Zařazeny ${n} transakce.`;
        return `Zařazeno ${n} transakcí.`;
      },
      applyNothing: "Nebylo co zařadit.",
    },
  },
};
