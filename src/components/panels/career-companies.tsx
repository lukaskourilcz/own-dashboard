"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import { CAREER_COMPANIES } from "@/lib/jobs/companies";
export function CareerCompanies() {
  const { lang } = useLang();
  const cs = lang === "cs";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
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
  const rows = CAREER_COMPANIES.filter(
    ([name, , kind]) =>
      (category === "all" || kind === category) &&
      name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="space-y-4">
      <p className="max-w-3xl text-sm text-foreground-muted">
        {cs
          ? "26 firem s týmy v Praze. Odkazy vedou na oficiální kariérní stránky, nikoliv na ověřené volné React pozice. U každé nabídky zkontrolujte technologie a místo práce."
          : "26 employers with Prague teams. These links lead to official career pages, not confirmed React vacancies. Check the stack and work location on each posting."}
      </p>
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
      </div>
      <ul className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(([name, url, kind]) => (
          <li key={name} className="border-b border-border py-4">
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
              {labels[kind]} · {cs ? "Kariérní stránka" : "Career page"}
            </p>
          </li>
        ))}
      </ul>
      {!rows.length && (
        <p role="status">
          {cs
            ? "Žádná firma neodpovídá hledání."
            : "No companies match your search."}
        </p>
      )}
    </section>
  );
}
