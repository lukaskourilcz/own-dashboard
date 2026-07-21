"use client";

import { BriefcaseBusiness } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <CardContent>{items.length === 0 ? <p className="text-sm text-foreground-muted">{p.attentionEmpty}</p> : <ul className="space-y-2">{items.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 text-sm"><span className="truncate">{item.title}</span><span className="shrink-0 text-[10px] uppercase text-foreground-subtle">{item.status.replaceAll("_", " ")}</span></li>)}</ul>}</CardContent>
  </Card>;
}
