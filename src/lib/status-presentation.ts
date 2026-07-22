import type { Lang } from "@/lib/i18n/lang";

export type StatusTone = "neutral" | "information" | "success" | "warning" | "risk" | "destructive";

const labels = {
  en: {
    discovered: "Discovered", shortlisted: "Shortlisted", contacted: "Contacted", proposal_sent: "Proposal sent",
    negotiating: "Negotiating", won: "Won", lost: "Lost", expired: "Expired", archived: "Archived",
    tugedr: "Tugedr", referral: "Referral", direct: "Direct", existing_client: "Existing client", inbound: "Inbound", other: "Other",
    client: "Client", prospective_client: "Prospective client", employer: "Employer", prospective_employer: "Prospective employer", personal_project: "Personal project",
    active: "Active", planned: "Planned", planning: "Planning", on_hold: "On hold", completed: "Completed", draft: "Draft", issued: "Issued", paid: "Paid", cancelled: "Cancelled", overdue: "Overdue",
    pending: "Pending", processed: "Processed", snoozed: "Snoozed", dismissed: "Dismissed", healthy: "Healthy", attention: "Attention", at_risk: "At risk",
  },
  cs: {
    discovered: "Objeveno", shortlisted: "Ve výběru", contacted: "Kontaktováno", proposal_sent: "Nabídka odeslána",
    negotiating: "Vyjednávání", won: "Vyhráno", lost: "Prohráno", expired: "Propadlo", archived: "Archivováno",
    tugedr: "Tugedr", referral: "Doporučení", direct: "Přímý kontakt", existing_client: "Stávající klient", inbound: "Příchozí", other: "Jiné",
    client: "Klient", prospective_client: "Potenciální klient", employer: "Zaměstnavatel", prospective_employer: "Potenciální zaměstnavatel", personal_project: "Vlastní projekt",
    active: "Aktivní", planned: "Plánováno", planning: "Plánování", on_hold: "Pozastaveno", completed: "Dokončeno", draft: "Koncept", issued: "Vystaveno", paid: "Uhrazeno", cancelled: "Zrušeno", overdue: "Po splatnosti",
    pending: "Čeká", processed: "Zpracováno", snoozed: "Odloženo", dismissed: "Zamítnuto", healthy: "V pořádku", attention: "Pozornost", at_risk: "V ohrožení",
  },
} as const;

export function statusLabel(value: string, lang: Lang): string {
  return (labels[lang] as Record<string, string>)[value] ?? value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function statusTone(value: string): StatusTone {
  if (["won", "paid", "completed", "healthy", "active", "processed"].includes(value)) return "success";
  if (["lost", "cancelled", "dismissed"].includes(value)) return "destructive";
  if (["overdue", "expired", "at_risk"].includes(value)) return "risk";
  if (["proposal_sent", "negotiating", "on_hold", "attention", "snoozed"].includes(value)) return "warning";
  if (["shortlisted", "contacted", "issued", "planned", "planning"].includes(value)) return "information";
  return "neutral";
}
