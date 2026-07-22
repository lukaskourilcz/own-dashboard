import { AlertTriangle, FileSearch, Lightbulb, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

export function AiProposalPanel({ label, description, children, className }: { label: string; description?: string; children: React.ReactNode; className?: string }) {
  return <section className={cn("border-l-2 border-information bg-surface-inset px-4 py-3", className)} aria-label={label}><div><p className="text-xs font-semibold text-foreground">{label}</p>{description && <p className="mt-1 text-xs text-foreground-muted">{description}</p>}</div><div className="mt-3">{children}</div></section>;
}

const kinds = {
  facts: { icon: ListChecks, className: "text-ai-fact" },
  risks: { icon: AlertTriangle, className: "text-ai-risk" },
  suggestions: { icon: Lightbulb, className: "text-ai-suggestion" },
  evidence: { icon: FileSearch, className: "text-ai-evidence" },
} as const;

export function AiResultGroup({ kind, title, items }: { kind: keyof typeof kinds; title: string; items: string[] }) {
  const item = kinds[kind];
  const Icon = item.icon;
  return <div><p className={cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]", item.className)}><Icon className="h-3.5 w-3.5" aria-hidden />{title}</p>{items.length === 0 ? <p className="mt-2 text-xs text-foreground-subtle">—</p> : <ul className="mt-2 space-y-1.5 text-sm">{items.map((value) => <li key={value} className="border-b border-border pb-1.5 last:border-0 last:pb-0">{value}</li>)}</ul>}</div>;
}
