"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { qk } from "@/lib/queries/keys";
import { fetchCareerCompanies, type CareerCompany } from "@/lib/jobs/career-directory";
import { ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import { CAREER_COMPANIES } from "@/lib/jobs/companies";
export function CareerCompanies({ userId, isPreview = false }: { userId: string; isPreview?: boolean }) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [country, setCountry] = useState("all");
  const directory = useQuery({
    queryKey: [...qk.careerCompanies, userId],
    queryFn: ({ signal }) => fetchCareerCompanies(userId, signal),
    enabled: !isPreview, staleTime: 60_000,
  });
  const companies: CareerCompany[] = isPreview
    ? CAREER_COMPANIES.map(([name, url, category]) => ({ id: name, name, url, category, country: "CZ", notes: "", checked_on: null }))
    : directory.data ?? [];
  const countries = [...new Set(companies.map(row => row.country).filter(Boolean))].sort();
  const labels: Record<string, string> = cs
    ? {
        Product: "Produktové firmy",
        Agency: "Agentury a konzultace",
        Finance: "Finance",
        Commerce: "E-commerce",
        Enterprise: "Enterprise",
      }
    : {
        Product: "Product companies",
        Agency: "Agencies and consultancies",
        Finance: "Finance",
        Commerce: "E-commerce",
        Enterprise: "Enterprise",
      };
  const rows = companies.filter(row =>
    (category === "all" || row.category === category) &&
    (country === "all" || row.country === country) &&
    `${row.name} ${row.country}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  );
  return (
    <section className="space-y-4">
      <p className="max-w-3xl text-sm text-foreground-muted">
        {cs
          ? `${companies.length} uložených firem. U každé nabídky ověřte technologie, požadovaný jazyk a země, ze kterých lze pracovat.`
          : `${companies.length} saved employers. Check the stack, required language and eligible work countries on each posting.`}
      </p>
      {!isPreview && directory.isPending && <p role="status">{cs ? "Načítám firmy…" : "Loading companies…"}</p>}
      {!isPreview && directory.isError && <div role="alert"><p>{cs ? "Firmy se nepodařilo načíst." : "Could not load companies."}</p><Button variant="outline" onClick={() => directory.refetch()}>{cs ? "Zkusit znovu" : "Retry"}</Button></div>}
      <div className="flex flex-wrap gap-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={cs ? "Hledat firmu" : "Search companies"}
          placeholder={cs ? "Hledat firmu" : "Search companies"}
          className="max-w-sm"
        />
        <SimpleSelect
          value={category}
          onValueChange={setCategory}
          className="w-full sm:w-64"
          aria-label={cs ? "Odvětví" : "Industry"}
          options={[
            { value: "all", label: cs ? "Všechna odvětví" : "All industries" },
            ...Object.entries(labels).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <SimpleSelect value={country} onValueChange={setCountry} className="w-full sm:w-64" aria-label={cs ? "Země firmy" : "Company country"} options={[{value:"all",label:cs ? "Všechny země" : "All countries"},...countries.map(value=>({value,label:value}))]} />
      </div>
      <ul className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ id, name, url, category: kind, country, notes }) => (
          <li key={id} className="border-b border-border py-4">
            <a
              className="focus-ring flex min-h-11 items-center justify-between gap-3 text-base font-medium hover:underline"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {name}
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </a>
            <p className="text-sm text-foreground-muted">
              {labels[kind] ?? kind} · {country || (cs ? "Země neuvedena" : "Country not specified")}
            </p>
            {notes && <p className="mt-2 text-sm text-foreground-muted break-words">{notes}</p>}
          </li>
        ))}
      </ul>
      {!rows.length && (isPreview || directory.isSuccess) && (
        <p role="status">
          {cs
            ? "Žádná firma neodpovídá hledání."
            : "No companies match your search."}
        </p>
      )}
    </section>
  );
}
