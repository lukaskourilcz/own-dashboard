"use client";

import { BriefcaseBusiness } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDict } from "@/lib/i18n";
import type { ClientOpportunity } from "@/lib/types";

export function WorkAttention({ opportunities, onOpen }: { opportunities: ClientOpportunity[]; onOpen: () => void }) {
  const p = useDict().professional;
  const items = opportunities
    .filter((item) => !["won", "lost", "expired", "archived"].includes(item.status))
    .sort((a, b) => (a.next_follow_up_at ?? "9999").localeCompare(b.next_follow_up_at ?? "9999"))
    .slice(0, 4);
  return <Card>
    <CardHeader><CardTitle className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2"><BriefcaseBusiness className="h-4 w-4" />{p.attention}</span><button type="button" onClick={onOpen} className="text-xs font-normal text-foreground-muted hover:text-foreground">{p.opportunitiesTitle}</button></CardTitle></CardHeader>
    <CardContent>{items.length === 0 ? <p className="text-sm text-foreground-muted">{p.attentionEmpty}</p> : <ul className="divide-y divide-border">{items.map((item) => <li key={item.id} className="flex min-h-10 items-center justify-between gap-3 text-sm"><span className="truncate">{item.title}</span><StatusBadge value={item.status} /></li>)}</ul>}</CardContent>
  </Card>;
}
