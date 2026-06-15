import type { InvoiceStatus, PaymentMethod } from "@/lib/types";

type StatusLabels = Record<InvoiceStatus | "overdue", string>;
type PaymentLabels = Record<PaymentMethod, string>;

type InvoicesStrings = {
  title: string;
  description: string;

  // List
  newInvoice: string;
  settings: string;
  emptyTitle: string;
  emptyDesc: string;
  createFirst: string;
  buyerFallback: string;
  issuedOn: string;
  dueOn: string;
  outstanding: string;
  overdueSummary: string;
  paidSummary: string;
  statusLabel: StatusLabels;

  // Row / detail actions
  view: string;
  edit: string;
  duplicate: string;
  markPaid: string;
  markUnpaid: string;
  delete: string;
  print: string;
  back: string;
  copy: string;
  copied: string;

  // Detail document
  taxDocTitle: string;
  plainTitle: string;
  supplierLabel: string;
  buyerLabel: string;
  icoLabel: string;
  dicLabel: string;
  numberLabel: string;
  issueDateLabel: string;
  dueDateLabel: string;
  taxDateLabel: string;
  paymentMethodLabel: string;
  vsLabel: string;
  ksLabel: string;
  bankAccountLabel: string;
  ibanLabel: string;
  thDescription: string;
  thQuantity: string;
  thUnit: string;
  thUnitPrice: string;
  thVat: string;
  thLineTotal: string;
  vatRecapTitle: string;
  recapRate: string;
  recapBase: string;
  recapVat: string;
  recapTotal: string;
  nonVatPayerNote: string;
  subtotalLabel: string;
  vatTotalLabel: string;
  roundingLabel: string;
  totalToPayLabel: string;
  qrTitle: string;
  qrHint: string;
  qrMissing: string;

  // Form
  formNewTitle: string;
  formEditTitle: string;
  saveDraft: string;
  issue: string;
  saveChanges: string;
  cancel: string;
  sectionSupplier: string;
  sectionBuyer: string;
  sectionDetails: string;
  sectionItems: string;
  sectionSummary: string;
  sectionNote: string;
  supplierFromSettings: string;
  supplierMissing: string;
  editSupplier: string;
  fieldName: string;
  buyerNamePlaceholder: string;
  fieldAddress: string;
  fieldCity: string;
  fieldZip: string;
  fieldCountry: string;
  fieldIco: string;
  fieldDic: string;
  fieldNumber: string;
  fieldVs: string;
  fieldKs: string;
  fieldIssueDate: string;
  fieldDueDate: string;
  fieldTaxDate: string;
  fieldPaymentMethod: string;
  fieldCurrency: string;
  paymentMethod: PaymentLabels;
  itemDescription: string;
  itemDescriptionPlaceholder: string;
  itemQuantity: string;
  itemUnit: string;
  itemUnitPrice: string;
  itemVat: string;
  itemLineTotal: string;
  addItem: string;
  removeItem: string;
  roundTotalToggle: string;
  notePlaceholder: string;
  footerNoteLabel: string;

  // Settings
  settingsTitle: string;
  settingsDesc: string;
  supplierNameLabel: string;
  vatPayerToggle: string;
  vatPayerHint: string;
  defaultDueDays: string;
  defaultCurrency: string;
  bankAccount: string;
  bankAccountPlaceholder: string;
  iban: string;
  ibanPlaceholder: string;
  ibanHint: string;
  footerNote: string;
  footerNotePlaceholder: string;
  saveSettings: string;

  // Toasts / validation
  buyerNameRequired: string;
  numberRequired: string;
  itemRequired: string;
  numberTaken: string;
  errorToast: string;
  savedSettingsToast: string;
  deletedToast: string;
  markedPaidToast: string;
  markedUnpaidToast: string;
  createdToast: (number: string) => string;
  updatedToast: (number: string) => string;
  deleteConfirm: (number: string) => string;
};

export const invoices: { en: InvoicesStrings; cs: InvoicesStrings } = {
  en: {
    title: "Invoices",
    description: "Issue invoices in the Czech format.",

    newInvoice: "New invoice",
    settings: "Invoicing settings",
    emptyTitle: "No invoices yet",
    emptyDesc: "Create your first invoice to get started.",
    createFirst: "Create invoice",
    buyerFallback: "Unnamed customer",
    issuedOn: "Issued",
    dueOn: "Due",
    outstanding: "Outstanding",
    overdueSummary: "Overdue",
    paidSummary: "Paid",
    statusLabel: {
      draft: "Draft",
      issued: "Issued",
      paid: "Paid",
      cancelled: "Cancelled",
      overdue: "Overdue",
    },

    view: "View",
    edit: "Edit",
    duplicate: "Duplicate",
    markPaid: "Mark as paid",
    markUnpaid: "Mark as unpaid",
    delete: "Delete",
    print: "Print",
    back: "Back to list",
    copy: "Copy",
    copied: "Copied",

    taxDocTitle: "Invoice — tax document",
    plainTitle: "Invoice",
    supplierLabel: "Supplier",
    buyerLabel: "Customer",
    icoLabel: "Reg. No.",
    dicLabel: "VAT No.",
    numberLabel: "Invoice no.",
    issueDateLabel: "Issue date",
    dueDateLabel: "Due date",
    taxDateLabel: "Date of supply",
    paymentMethodLabel: "Payment method",
    vsLabel: "Variable symbol",
    ksLabel: "Constant symbol",
    bankAccountLabel: "Account number",
    ibanLabel: "IBAN",
    thDescription: "Description",
    thQuantity: "Qty",
    thUnit: "Unit",
    thUnitPrice: "Unit price",
    thVat: "VAT",
    thLineTotal: "Total",
    vatRecapTitle: "VAT summary",
    recapRate: "Rate",
    recapBase: "Base",
    recapVat: "VAT",
    recapTotal: "Total",
    nonVatPayerNote: "The supplier is not a VAT payer.",
    subtotalLabel: "Total excl. VAT",
    vatTotalLabel: "VAT total",
    roundingLabel: "Rounding",
    totalToPayLabel: "Total due",
    qrTitle: "QR payment",
    qrHint: "Scan it in your banking app.",
    qrMissing:
      "Add a bank account in invoicing settings to generate a payment QR.",

    formNewTitle: "New invoice",
    formEditTitle: "Edit invoice",
    saveDraft: "Save draft",
    issue: "Issue invoice",
    saveChanges: "Save changes",
    cancel: "Cancel",
    sectionSupplier: "Supplier",
    sectionBuyer: "Customer",
    sectionDetails: "Invoice details",
    sectionItems: "Line items",
    sectionSummary: "Summary",
    sectionNote: "Note",
    supplierFromSettings: "Taken from your invoicing settings.",
    supplierMissing: "Fill in your supplier details in invoicing settings.",
    editSupplier: "Edit supplier",
    fieldName: "Name / company",
    buyerNamePlaceholder: "ACME Ltd. or John Smith",
    fieldAddress: "Street and number",
    fieldCity: "City",
    fieldZip: "ZIP",
    fieldCountry: "Country",
    fieldIco: "Reg. No.",
    fieldDic: "VAT No.",
    fieldNumber: "Invoice number",
    fieldVs: "Variable symbol",
    fieldKs: "Constant symbol",
    fieldIssueDate: "Issue date",
    fieldDueDate: "Due date",
    fieldTaxDate: "Date of supply (DUZP)",
    fieldPaymentMethod: "Payment method",
    fieldCurrency: "Currency",
    paymentMethod: {
      bank: "Bank transfer",
      cash: "Cash",
      card: "Card",
    },
    itemDescription: "Description",
    itemDescriptionPlaceholder: "Web work, consulting…",
    itemQuantity: "Qty",
    itemUnit: "Unit",
    itemUnitPrice: "Unit price",
    itemVat: "VAT %",
    itemLineTotal: "Total",
    addItem: "Add item",
    removeItem: "Remove item",
    roundTotalToggle: "Round total to whole crowns",
    notePlaceholder: "Optional note shown on the invoice",
    footerNoteLabel: "Footer",

    settingsTitle: "Invoicing settings",
    settingsDesc: "Supplier details and defaults for new invoices.",
    supplierNameLabel: "Name / company",
    vatPayerToggle: "I'm a VAT payer",
    vatPayerHint: "Turn on if you're registered for VAT.",
    defaultDueDays: "Default due (days)",
    defaultCurrency: "Default currency",
    bankAccount: "Account number",
    bankAccountPlaceholder: "19-2000145399/0800",
    iban: "IBAN",
    ibanPlaceholder: "CZ65 0800 0000 1920 0014 5399",
    ibanHint: "Optional — we'll derive it from the account number for the QR.",
    footerNote: "Invoice footer",
    footerNotePlaceholder: 'e.g. "Not a VAT payer." or a thank-you note',
    saveSettings: "Save settings",

    buyerNameRequired: "Enter the customer's name.",
    numberRequired: "Enter an invoice number.",
    itemRequired: "Add at least one item with a description and price.",
    numberTaken: "An invoice with this number already exists.",
    errorToast: "Something went wrong.",
    savedSettingsToast: "Settings saved.",
    deletedToast: "Invoice deleted.",
    markedPaidToast: "Invoice marked as paid.",
    markedUnpaidToast: "Payment cleared.",
    createdToast: (number) => `Invoice ${number} created.`,
    updatedToast: (number) => `Invoice ${number} updated.`,
    deleteConfirm: (number) => `Delete invoice ${number}? This can't be undone.`,
  },
  cs: {
    title: "Faktury",
    description: "Vystavujte faktury v českém formátu.",

    newInvoice: "Nová faktura",
    settings: "Nastavení fakturace",
    emptyTitle: "Zatím žádné faktury",
    emptyDesc: "Začněte vytvořením první faktury.",
    createFirst: "Vytvořit fakturu",
    buyerFallback: "Bez názvu",
    issuedOn: "Vystaveno",
    dueOn: "Splatnost",
    outstanding: "Nezaplaceno",
    overdueSummary: "Po splatnosti",
    paidSummary: "Uhrazeno",
    statusLabel: {
      draft: "Koncept",
      issued: "Vystaveno",
      paid: "Uhrazeno",
      cancelled: "Stornováno",
      overdue: "Po splatnosti",
    },

    view: "Zobrazit",
    edit: "Upravit",
    duplicate: "Duplikovat",
    markPaid: "Označit jako uhrazenou",
    markUnpaid: "Zrušit úhradu",
    delete: "Smazat",
    print: "Tisk",
    back: "Zpět na seznam",
    copy: "Kopírovat",
    copied: "Zkopírováno",

    taxDocTitle: "Faktura — daňový doklad",
    plainTitle: "Faktura",
    supplierLabel: "Dodavatel",
    buyerLabel: "Odběratel",
    icoLabel: "IČO",
    dicLabel: "DIČ",
    numberLabel: "Faktura č.",
    issueDateLabel: "Datum vystavení",
    dueDateLabel: "Datum splatnosti",
    taxDateLabel: "Datum zd. plnění",
    paymentMethodLabel: "Způsob platby",
    vsLabel: "Variabilní symbol",
    ksLabel: "Konstantní symbol",
    bankAccountLabel: "Číslo účtu",
    ibanLabel: "IBAN",
    thDescription: "Popis",
    thQuantity: "Množství",
    thUnit: "MJ",
    thUnitPrice: "Cena za MJ",
    thVat: "DPH",
    thLineTotal: "Celkem",
    vatRecapTitle: "Rekapitulace DPH",
    recapRate: "Sazba",
    recapBase: "Základ",
    recapVat: "DPH",
    recapTotal: "Celkem",
    nonVatPayerNote: "Dodavatel není plátcem DPH.",
    subtotalLabel: "Celkem bez DPH",
    vatTotalLabel: "DPH celkem",
    roundingLabel: "Zaokrouhlení",
    totalToPayLabel: "Celkem k úhradě",
    qrTitle: "QR platba",
    qrHint: "Naskenujte v mobilní bankovní aplikaci.",
    qrMissing:
      "Pro QR platbu vyplňte číslo účtu v nastavení fakturace.",

    formNewTitle: "Nová faktura",
    formEditTitle: "Upravit fakturu",
    saveDraft: "Uložit koncept",
    issue: "Vystavit fakturu",
    saveChanges: "Uložit změny",
    cancel: "Zrušit",
    sectionSupplier: "Dodavatel",
    sectionBuyer: "Odběratel",
    sectionDetails: "Údaje faktury",
    sectionItems: "Položky",
    sectionSummary: "Souhrn",
    sectionNote: "Poznámka",
    supplierFromSettings: "Údaje se přebírají z nastavení fakturace.",
    supplierMissing: "Vyplňte údaje dodavatele v nastavení fakturace.",
    editSupplier: "Upravit dodavatele",
    fieldName: "Jméno / název firmy",
    buyerNamePlaceholder: "Firma s.r.o. nebo Jan Novák",
    fieldAddress: "Ulice a č. p.",
    fieldCity: "Město",
    fieldZip: "PSČ",
    fieldCountry: "Země",
    fieldIco: "IČO",
    fieldDic: "DIČ",
    fieldNumber: "Číslo faktury",
    fieldVs: "Variabilní symbol",
    fieldKs: "Konstantní symbol",
    fieldIssueDate: "Datum vystavení",
    fieldDueDate: "Datum splatnosti",
    fieldTaxDate: "Datum zd. plnění (DUZP)",
    fieldPaymentMethod: "Způsob platby",
    fieldCurrency: "Měna",
    paymentMethod: {
      bank: "Bankovním převodem",
      cash: "Hotově",
      card: "Platební kartou",
    },
    itemDescription: "Popis",
    itemDescriptionPlaceholder: "Webové práce, konzultace…",
    itemQuantity: "Množství",
    itemUnit: "MJ",
    itemUnitPrice: "Cena za MJ",
    itemVat: "DPH %",
    itemLineTotal: "Celkem",
    addItem: "Přidat položku",
    removeItem: "Odebrat položku",
    roundTotalToggle: "Zaokrouhlit na celé koruny",
    notePlaceholder: "Volitelná poznámka na faktuře",
    footerNoteLabel: "Patička",

    settingsTitle: "Nastavení fakturace",
    settingsDesc: "Údaje dodavatele a výchozí hodnoty pro nové faktury.",
    supplierNameLabel: "Jméno / název firmy",
    vatPayerToggle: "Jsem plátce DPH",
    vatPayerHint: "Zapněte, pokud jste registrovaní k DPH.",
    defaultDueDays: "Výchozí splatnost (dny)",
    defaultCurrency: "Výchozí měna",
    bankAccount: "Číslo účtu",
    bankAccountPlaceholder: "19-2000145399/0800",
    iban: "IBAN",
    ibanPlaceholder: "CZ65 0800 0000 1920 0014 5399",
    ibanHint: "Nepovinné — když nevyplníte, odvodíme ho z čísla účtu pro QR platbu.",
    footerNote: "Patička faktury",
    footerNotePlaceholder: 'Např. „Nejsem plátce DPH." nebo poděkování',
    saveSettings: "Uložit nastavení",

    buyerNameRequired: "Vyplňte název odběratele.",
    numberRequired: "Vyplňte číslo faktury.",
    itemRequired: "Přidejte alespoň jednu položku s popisem a cenou.",
    numberTaken: "Faktura s tímto číslem už existuje.",
    errorToast: "Něco se pokazilo.",
    savedSettingsToast: "Nastavení uloženo.",
    deletedToast: "Faktura smazána.",
    markedPaidToast: "Faktura označena jako uhrazená.",
    markedUnpaidToast: "Úhrada zrušena.",
    createdToast: (number) => `Faktura ${number} vytvořena.`,
    updatedToast: (number) => `Faktura ${number} upravena.`,
    deleteConfirm: (number) =>
      `Smazat fakturu ${number}? Tuto akci nelze vrátit.`,
  },
};
