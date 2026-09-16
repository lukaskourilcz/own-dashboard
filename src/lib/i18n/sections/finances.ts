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
  rules: RulesStrings;
  matching: MatchingStrings;
};

// Invoice payment matching (src/components/finances/payment-matches.tsx).
type MatchingStrings = {
  title: string;
  subtitle: string;
  matchNow: string;
  matching: string;
  matchDone: (linked: number) => string;
  matchNothing: string;
  matchErr: string;
  empty: string;
  emptyHint: string;
  noOpenInvoices: string;
  unmatchedCount: (n: number) => string;
  vsLabel: string;
  vsNone: string;
  chooseInvoice: string;
  link: string;
  linking: string;
  linkDone: string;
  linkErr: string;
  invoiceOption: (number: string, total: string) => string;
  reason: Record<
    | "no-variable-symbol"
    | "no-open-invoice"
    | "currency-mismatch"
    | "amount-mismatch"
    | "duplicate-payment"
    | "ambiguous",
    string
  >;
  scheduleHint: string;
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
};

// The transaction rule editor (src/components/finances/transaction-rules.tsx).
type RulesStrings = {
  title: string;
  subtitle: string;
  empty: string;
  emptyHint: string;
  newRule: string;
  editRule: string;
  ruleName: string;
  ruleNamePlaceholder: string;
  unnamed: string;
  stage: string;
  stagePre: string;
  stageDefault: string;
  stagePost: string;
  stageHint: string;
  enabled: string;
  disabled: string;
  conditions: string;
  addCondition: string;
  removeCondition: string;
  needsCondition: string;
  needsAction: string;
  field: string;
  operator: string;
  value: string;
  fieldNote: string;
  fieldAccount: string;
  fieldAmount: string;
  fieldDate: string;
  fieldKind: string;
  opIs: string;
  opContains: string;
  opNotContains: string;
  opRegex: string;
  opOneOf: string;
  opGt: string;
  opGte: string;
  opLt: string;
  opLte: string;
  opBetween: string;
  oneOfHint: string;
  betweenFrom: string;
  betweenTo: string;
  regexInvalid: string;
  actions: string;
  actionCategory: string;
  actionProject: string;
  actionSubscription: string;
  actionNote: string;
  actionNotePlaceholder: string;
  actionsNone: string;
  matchesLoaded: (matched: number, loaded: number) => string;
  checkAll: string;
  checking: string;
  checkedResult: (matched: number, changed: number) => string;
  truncated: string;
  apply: string;
  applying: string;
  applyDone: (n: number) => string;
  applyNothing: string;
  applyErr: string;
  applyConfirmTitle: string;
  applyConfirmBody: string;
  applyConfirmLabel: string;
  deleteConfirmTitle: string;
  deleteConfirmBody: string;
  saveErr: string;
  loadErr: string;
  dropped: (n: number) => string;
  kindIncome: string;
  kindExpense: string;
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
    },
    rules: {
      title: "Transaction rules",
      subtitle:
        "Conditions that file a transaction automatically on every sync and import.",
      empty: "No rules yet.",
      emptyHint:
        "A rule matches on description, account, amount, date or direction, and sets the category, project, subscription or note.",
      newRule: "New rule",
      editRule: "Edit rule",
      ruleName: "Name",
      ruleNamePlaceholder: "What this rule is for",
      unnamed: "Unnamed rule",
      stage: "Stage",
      stagePre: "Before",
      stageDefault: "Default",
      stagePost: "After",
      stageHint:
        "Inside a stage the broadest rule runs first, so a narrower rule overwrites it.",
      enabled: "Enabled",
      disabled: "Disabled",
      conditions: "Conditions",
      addCondition: "Add condition",
      removeCondition: "Remove condition",
      needsCondition: "Add at least one condition.",
      needsAction: "Set at least one action.",
      field: "Field",
      operator: "Operator",
      value: "Value",
      fieldNote: "Description",
      fieldAccount: "Account",
      fieldAmount: "Amount",
      fieldDate: "Date",
      fieldKind: "Direction",
      opIs: "is",
      opContains: "contains",
      opNotContains: "does not contain",
      opRegex: "matches pattern",
      opOneOf: "is one of",
      opGt: "greater than",
      opGte: "at least",
      opLt: "less than",
      opLte: "at most",
      opBetween: "between",
      oneOfHint: "Separate values with commas.",
      betweenFrom: "From",
      betweenTo: "To",
      regexInvalid: "That pattern can't be read, so it matches nothing.",
      actions: "Actions",
      actionCategory: "Category",
      actionProject: "Project",
      actionSubscription: "Subscription",
      actionNote: "Rewrite description",
      actionNotePlaceholder: "Leave empty to keep the original",
      actionsNone: "No action set",
      matchesLoaded: (matched, loaded) =>
        `${matched} of the ${loaded} loaded transactions`,
      checkAll: "Check all transactions",
      checking: "Checking…",
      checkedResult: (matched, changed) =>
        `${matched} matched, ${changed} would change.`,
      truncated: "Stopped at the scan limit; the real number may be higher.",
      apply: "Apply to matching transactions",
      applying: "Applying…",
      applyDone: (n) =>
        n === 1 ? "Updated 1 transaction." : `Updated ${n} transactions.`,
      applyNothing: "Nothing to change.",
      applyErr: "Couldn't apply the rules. Please try again.",
      applyConfirmTitle: "Apply to existing transactions?",
      applyConfirmBody:
        "Every matching transaction is rewritten with this rule's actions. Previous values are not kept.",
      applyConfirmLabel: "Apply",
      deleteConfirmTitle: "Delete this rule?",
      deleteConfirmBody:
        "Transactions it has already filed keep their values; only the rule is removed.",
      saveErr: "Couldn't save the rule. Please try again.",
      loadErr: "Couldn't load the rules.",
      dropped: (n) =>
        n === 1 ? "1 rule couldn't be read." : `${n} rules couldn't be read.`,
      kindIncome: "Income",
      kindExpense: "Expense",
    },
    matching: {
      title: "Unmatched payments",
      subtitle:
        "Incoming payments that quote no open invoice, or quote one for a different amount.",
      matchNow: "Match now",
      matching: "Matching…",
      matchDone: (linked) =>
        linked === 1 ? "1 invoice marked paid." : `${linked} invoices marked paid.`,
      matchNothing: "Nothing new to match.",
      matchErr: "Matching failed. Please try again.",
      empty: "Every payment is accounted for",
      emptyHint: "Incoming payments that don't settle an open invoice show up here.",
      noOpenInvoices: "No issued invoice is waiting for payment.",
      unmatchedCount: (n) =>
        n === 1 ? "1 payment left over" : `${n} payments left over`,
      vsLabel: "VS",
      vsNone: "no symbol",
      chooseInvoice: "Link to invoice",
      link: "Link",
      linking: "Linking…",
      linkDone: "Payment linked and the invoice marked paid.",
      linkErr: "Couldn't link that payment.",
      invoiceOption: (number, total) => `${number} — ${total}`,
      reason: {
        "no-variable-symbol": "No variable symbol",
        "no-open-invoice": "No invoice with that symbol",
        "currency-mismatch": "Different currency",
        "amount-mismatch": "Amount doesn't match",
        "duplicate-payment": "That invoice is already paid",
        ambiguous: "Two invoices share that symbol",
      },
      scheduleHint:
        "Payments are matched on a schedule; this button runs the same check now.",
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
    },
    rules: {
      title: "Pravidla pro transakce",
      subtitle:
        "Podmínky, které transakci zařadí automaticky při každé synchronizaci a importu.",
      empty: "Zatím žádná pravidla.",
      emptyHint:
        "Pravidlo se porovnává s popisem, účtem, částkou, datem nebo směrem a nastaví kategorii, projekt, předplatné nebo popis.",
      newRule: "Nové pravidlo",
      editRule: "Upravit pravidlo",
      ruleName: "Název",
      ruleNamePlaceholder: "K čemu pravidlo slouží",
      unnamed: "Pravidlo bez názvu",
      stage: "Fáze",
      stagePre: "Před",
      stageDefault: "Výchozí",
      stagePost: "Po",
      stageHint:
        "V rámci fáze běží nejobecnější pravidlo první, takže užší pravidlo jeho výsledek přepíše.",
      enabled: "Zapnuto",
      disabled: "Vypnuto",
      conditions: "Podmínky",
      addCondition: "Přidat podmínku",
      removeCondition: "Odebrat podmínku",
      needsCondition: "Přidej alespoň jednu podmínku.",
      needsAction: "Nastav alespoň jednu akci.",
      field: "Pole",
      operator: "Operátor",
      value: "Hodnota",
      fieldNote: "Popis",
      fieldAccount: "Účet",
      fieldAmount: "Částka",
      fieldDate: "Datum",
      fieldKind: "Směr",
      opIs: "je",
      opContains: "obsahuje",
      opNotContains: "neobsahuje",
      opRegex: "odpovídá vzoru",
      opOneOf: "je jedno z",
      opGt: "větší než",
      opGte: "alespoň",
      opLt: "menší než",
      opLte: "nejvýše",
      opBetween: "mezi",
      oneOfHint: "Hodnoty odděl čárkou.",
      betweenFrom: "Od",
      betweenTo: "Do",
      regexInvalid: "Tenhle vzor se nedá přečíst, takže neodpovídá ničemu.",
      actions: "Akce",
      actionCategory: "Kategorie",
      actionProject: "Projekt",
      actionSubscription: "Předplatné",
      actionNote: "Přepsat popis",
      actionNotePlaceholder: "Prázdné ponechá původní popis",
      actionsNone: "Žádná akce",
      matchesLoaded: (matched, loaded) =>
        `${matched} z ${loaded} načtených transakcí`,
      checkAll: "Zkontrolovat všechny transakce",
      checking: "Kontroluji…",
      checkedResult: (matched, changed) =>
        `Odpovídá ${matched}, změnilo by se ${changed}.`,
      truncated: "Kontrola skončila na limitu, skutečné číslo může být vyšší.",
      apply: "Použít na odpovídající transakce",
      applying: "Používám…",
      applyDone: (n) => {
        if (n === 1) return "Upravena 1 transakce.";
        if (n >= 2 && n <= 4) return `Upraveny ${n} transakce.`;
        return `Upraveno ${n} transakcí.`;
      },
      applyNothing: "Nebylo co změnit.",
      applyErr: "Pravidla se nepodařilo použít. Zkus to znovu.",
      applyConfirmTitle: "Použít na existující transakce?",
      applyConfirmBody:
        "Každá odpovídající transakce se přepíše akcemi tohoto pravidla. Původní hodnoty se neuchovávají.",
      applyConfirmLabel: "Použít",
      deleteConfirmTitle: "Smazat toto pravidlo?",
      deleteConfirmBody:
        "Transakce, které už zařadilo, si hodnoty ponechají; smaže se jen pravidlo.",
      saveErr: "Pravidlo se nepodařilo uložit. Zkus to znovu.",
      loadErr: "Pravidla se nepodařilo načíst.",
      dropped: (n) => {
        if (n === 1) return "1 pravidlo se nepodařilo přečíst.";
        if (n >= 2 && n <= 4) return `${n} pravidla se nepodařilo přečíst.`;
        return `${n} pravidel se nepodařilo přečíst.`;
      },
      kindIncome: "Příjem",
      kindExpense: "Výdaj",
    },
    matching: {
      title: "Nespárované platby",
      subtitle:
        "Příchozí platby, které neodpovídají žádné vystavené faktuře — nebo odpovídají jiné částkou.",
      matchNow: "Spárovat teď",
      matching: "Páruji…",
      matchDone: (linked) => {
        if (linked === 1) return "Zaplacená 1 faktura.";
        if (linked >= 2 && linked <= 4) return `Zaplacené ${linked} faktury.`;
        return `Zaplaceno ${linked} faktur.`;
      },
      matchNothing: "Není co párovat.",
      matchErr: "Párování se nepodařilo. Zkus to znovu.",
      empty: "Všechny platby jsou spárované",
      emptyHint: "Tady se objeví příchozí platby, které nesedí na žádnou vystavenou fakturu.",
      noOpenInvoices: "Žádná vystavená faktura nečeká na platbu.",
      unmatchedCount: (n) => {
        if (n === 1) return "Zbývá 1 platba";
        if (n >= 2 && n <= 4) return `Zbývají ${n} platby`;
        return `Zbývá ${n} plateb`;
      },
      vsLabel: "VS",
      vsNone: "bez symbolu",
      chooseInvoice: "Přiřadit k faktuře",
      link: "Přiřadit",
      linking: "Přiřazuji…",
      linkDone: "Platba přiřazena, faktura je zaplacená.",
      linkErr: "Platbu se nepodařilo přiřadit.",
      invoiceOption: (number, total) => `${number} — ${total}`,
      reason: {
        "no-variable-symbol": "Bez variabilního symbolu",
        "no-open-invoice": "K symbolu není faktura",
        "currency-mismatch": "Jiná měna",
        "amount-mismatch": "Nesedí částka",
        "duplicate-payment": "Faktura je už zaplacená",
        ambiguous: "Symbol mají dvě faktury",
      },
      scheduleHint:
        "Platby se párují pravidelně, tohle tlačítko spustí stejnou kontrolu hned.",
    },
  },
};
