"use client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import type { OperatingCosts } from "@/lib/operating-costs";
import { formatCurrency } from "@/lib/utils";

export function ProjectOperatingCosts({ projectId, preview = false }: { projectId: string; preview?: boolean }) {
  const { lang } = useLang(); const cs = lang === "cs";
  const query = useQuery<OperatingCosts>({ queryKey: qk.projectOperatingCosts, enabled: !preview, staleTime: 60_000, queryFn: async () => {
    const response = await fetch("/api/finances/operating-costs", { cache: "no-store" }); if (!response.ok) throw Error("unavailable"); return response.json();
  } });
  const names = cs ? { collection: "Sběr zdrojů DNESKAi", generation: "Generování DNESKAi · evidovaná spotřeba", generationReserved: "Neúspěšné běhy · rezervovaný strop", devshark: "Generování devShark" } : { collection: "DNESKAi source collection", generation: "DNESKAi generation · recorded usage", generationReserved: "Unsuccessful runs · reserved cap", devshark: "devShark generation" };
  return <section className="space-y-2" data-testid="project-operating-costs"><h3 className="font-semibold">{cs ? "Výroba obsahu · tento měsíc" : "Content production · this month"}</h3>
    {preview ? <p className="text-foreground-muted">{cs ? "Živý nákladový ledger je dostupný po přihlášení." : "The live cost ledger is available after sign-in."}</p>
    : query.isPending ? <p role="status">{cs ? "Načítám náklady…" : "Loading costs…"}</p>
    : query.isError ? <div role="alert"><p>{cs ? "Nákladový ledger není dostupný." : "The cost ledger is unavailable."}</p><Button size="sm" variant="outline" onClick={() => void query.refetch()}>{cs ? "Zkusit znovu" : "Retry"}</Button></div>
    : <><p className="tabular-nums text-foreground-muted">{query.data.start.slice(0, 10)} → {query.data.end.slice(0, 10)}</p><p className="text-foreground-muted">{cs ? "Odhad spotřeby z uložených běhů; není to faktura ani další platba. Rezervované stropy se nesčítají se skutečně evidovanou spotřebou." : "Usage estimate from stored runs; this is not an invoice or an additional payment. Reserved caps are separate from recorded usage."}</p>
      {query.data.items.filter(row => row.projectId === projectId).map(row => <div key={row.source} className="space-y-1 border-b border-border pb-2"><p className="flex flex-wrap justify-between gap-2"><span>{names[row.source]}</span><span className="tabular-nums">{row.usd === null ? (cs ? "Neznámé" : "Unknown") : formatCurrency(row.usd, "USD")}</span></p><p className="text-foreground-muted">{cs ? `${row.rows} záznamů · ${row.unknown} bez známé částky` : `${row.rows} records · ${row.unknown} with unknown cost`}{row.partial ? (cs ? " · neúplný načtený vzorek" : " · partial loaded sample") : ""}</p></div>)}
      {query.data.items.every(row => row.projectId !== projectId) && <p className="text-foreground-muted">{cs ? "Pro tento projekt tu není připojený ledger výroby obsahu." : "No content production ledger is connected for this project."}</p>}
    </>}
  </section>;
}
