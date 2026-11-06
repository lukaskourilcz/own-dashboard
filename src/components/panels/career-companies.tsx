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
import { CZECH_COMPANIES, CZECH_COMPANIES_CHECKED_ON } from "@/lib/jobs/czech-companies";
import { canonicalJobUrl } from "@/lib/jobs/research";
export function CareerCompanies({ userId, isPreview = false }: { userId: string; isPreview?: boolean }) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [city, setCity] = useState("all");
  const directory = useQuery({
    queryKey: [...qk.careerCompanies, userId],
    queryFn: ({ signal }) => fetchCareerCompanies(userId, signal),
    enabled: !isPreview, staleTime: 60_000,
  });
  // Owner-added rows come from the private career_companies table; the public
  // Czech directory is static research. Public rows win on duplicate URLs.
  const stored: CareerCompany[] = isPreview ? [] : directory.data ?? [];
  const publicCompanies: (CareerCompany & { city: string })[] = CZECH_COMPANIES.map(row => ({
    id: row.url, name: row.name, url: row.url, category: row.category, country: "CZ",
    city: row.city, notes: row.notes[lang], checked_on: row.checkedOn,
  }));
  const publicUrls = new Set(publicCompanies.map(row => canonicalJobUrl(row.url)));
  const companies = [
    ...publicCompanies,
    ...stored
      .filter(row => !publicUrls.has(canonicalJobUrl(row.url)))
      .map(row => ({ ...row, city: "" })),
  ].sort((a, b) => a.name.localeCompare(b.name, lang));
  const cities = [...new Set(publicCompanies.flatMap(row => row.city.split(" · ")).filter(Boolean))].sort();
  const labels: Record<string, string> = cs
    ? {
        Product: "Produktové firmy",
        AI: "AI a data",
        Agency: "Agentury a software na zakázku",
        Finance: "Banky a fintech",
        Commerce: "E-commerce a média",
        Enterprise: "Mezinárodní a enterprise",
        Public: "Veřejný sektor",
      }
    : {
        Product: "Product companies",
        AI: "AI and data",
        Agency: "Agencies and software houses",
        Finance: "Banks and fintech",
        Commerce: "E-commerce and media",
        Enterprise: "International and enterprise",
        Public: "Public sector",
      };
  const needle = query.trim().toLocaleLowerCase();
  const rows = companies.filter(row =>
    (category === "all" || row.category === category) &&
    (city === "all" || row.city.split(" · ").includes(city)) &&
    `${row.name} ${row.city} ${row.notes}`.toLocaleLowerCase().includes(needle)
  );
  return (
    <section className="space-y-4">
      <p className="max-w-3xl text-sm text-foreground-muted">
        {cs
          ? `${companies.length} přímých kariérních odkazů firem, které nabírají vývojáře v Praze, Brně nebo na dálku z Česka. Jde o adresář, ne seznam aktuálních vhodných pozic. Veřejné odkazy prověřeny ${CZECH_COMPANIES_CHECKED_ON}; nabídky, stack a jazyk ověřte u konkrétní role.`
          : `${companies.length} direct career destinations for companies hiring developers in Prague, Brno or remote from Czechia. This is an employer directory, not a list of matching live vacancies. Public links checked ${CZECH_COMPANIES_CHECKED_ON}; verify each role’s stack and language.`}
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
        <SimpleSelect value={city} onValueChange={setCity} className="w-full sm:w-48" aria-label={cs ? "Město" : "City"} options={[{ value: "all", label: cs ? "Všechna města" : "All cities" }, ...cities.map(value => ({ value, label: value === "Remote" ? (cs ? "Na dálku" : "Remote") : value }))]} />
      </div>
      <ul className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ id, name, url, category: kind, country, city: place, notes }) => (
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
              {labels[kind] ?? kind} · {place ? place.replace("Remote", cs ? "Na dálku" : "Remote") : country || (cs ? "Vlastní odkaz" : "Your link")}
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
