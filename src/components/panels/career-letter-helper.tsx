"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import {
  buildLetter,
  suggestEvidence,
  type LetterLanguage,
} from "@/lib/jobs/letter-helper";
import { matchListing } from "@/lib/jobs/match";

export function CareerLetterHelper({
  position,
  company,
  description = "",
  value,
  onChange,
  language,
  onLanguageChange,
}: {
  position: string;
  company: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  language: LetterLanguage;
  onLanguageChange: (v: LetterLanguage) => void;
}) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const [jobText, setJobText] = useState(description);
  const [motivation, setMotivation] = useState("");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [excludedSkills, setExcludedSkills] = useState<string[]>([]);
  const suggestions = useMemo(
    () => suggestEvidence(`${position} ${company} ${jobText}`),
    [position, company, jobText],
  );
  const match = useMemo(
    () =>
      matchListing({
        title: position,
        description: jobText,
        tags: [],
        seniority: null,
      }),
    [position, jobText],
  );
  const selectedIds =
    chosen ?? suggestions.slice(0, 3).map((e) => e.evidence.id);
  const selected = suggestions.filter((e) =>
    selectedIds.includes(e.evidence.id),
  );
  const skills = match.matched.filter((s) => !excludedSkills.includes(s.name));
  function draft() {
    if (
      value.trim() &&
      !window.confirm(
        cs
          ? "Nahradit rozepsaný dopis novým návrhem?"
          : "Replace the current letter with this draft?",
      )
    )
      return;
    onChange(
      buildLetter({
        language,
        position,
        company,
        motivation,
        evidenceIds: selected.map((e) => e.evidence.id),
        skills: skills.map((s) => s.name),
      }),
    );
  }
  return (
    <section
      className="space-y-4 rounded-md border border-border bg-surface-secondary p-4"
      aria-label={cs ? "Průvodce dopisem" : "Letter guidance"}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">
          {cs
            ? "Co zmínit v této žádosti"
            : "What to mention in this application"}
        </h3>
        <SimpleSelect
          value={language}
          onValueChange={(v) => onLanguageChange(v as LetterLanguage)}
          aria-label={cs ? "Jazyk dopisu" : "Letter language"}
          options={[
            { value: "en", label: "English" },
            { value: "cs", label: "Čeština" },
          ]}
        ></SimpleSelect>
      </div>
      <label className="block space-y-2 text-sm">
        <span>
          {cs
            ? "Popis pozice (doplňte celý inzerát pro přesnější návrh)"
            : "Job description (paste the full posting for better suggestions)"}
        </span>
        <Textarea
          value={jobText}
          onChange={(e) => setJobText(e.target.value)}
          rows={5}
          maxLength={20000}
          className="text-sm"
        />
      </label>
      <p className="text-sm text-foreground-muted">
        {cs
          ? "Doporučení vycházejí z klíčových slov a vašich skutečných zkušeností. Vyberte 1–3 nejrelevantnější příklady. Text se neposílá do AI."
          : "Suggestions use keywords and your actual experience. Choose the 1–3 most relevant examples. This text is not sent to AI."}
      </p>
      <div className="grid gap-3">
        {suggestions.map(({ evidence: e, domainMatch }) => (
          <label
            key={e.id}
            className="flex items-start gap-3 rounded border border-border bg-surface p-3 text-sm"
          >
            <Checkbox
              checked={selectedIds.includes(e.id)}
              onCheckedChange={(checked) =>
                setChosen(
                  checked
                    ? [...selectedIds, e.id]
                    : selectedIds.filter((id) => id !== e.id),
                )
              }
            />
            <span className="min-w-0">
              <strong className="block">{e.employer}</strong>
              <span className="block">{e.label[lang]}</span>
              <span className="mt-2 block text-foreground-muted">
                {e.paragraph[language]}
              </span>
              <span className="mt-1 block text-foreground-muted">
                {domainMatch
                  ? cs
                    ? "Relevantní odvětví"
                    : "Relevant industry"
                  : cs
                    ? "Relevantní technologie"
                    : "Relevant technology"}
              </span>
            </span>
          </label>
        ))}
      </div>
      {!suggestions.length && (
        <p className="text-sm">
          {cs
            ? "Vložte popis pozice. Doporučení se objeví podle požadavků a odvětví."
            : "Paste the job description to see suggestions based on requirements and industry."}
        </p>
      )}
      {!!match.matched.length && (
        <fieldset>
          <legend className="mb-2 text-sm font-medium">
            {cs
              ? "Technologie z nabídky, které znáte"
              : "Skills from the posting that you know"}
          </legend>
          <div className="flex flex-wrap gap-3">
            {match.matched.map((s) => (
              <label
                key={s.name}
                className="flex min-h-9 items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={!excludedSkills.includes(s.name)}
                  onCheckedChange={(checked) =>
                    setExcludedSkills((old) =>
                      checked
                        ? old.filter((id) => id !== s.name)
                        : [...old, s.name],
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {!!match.missing.length && (
        <p className="text-sm text-warning">
          {cs
            ? "Netvrďte zkušenosti bez ověření: "
            : "Do not claim experience without checking: "}
          {match.missing.join(", ")}
        </p>
      )}
      <label className="block space-y-2 text-sm">
        <span>
          {cs
            ? "Proč vás tato firma a produkt zajímají?"
            : "Why does this company and product interest you?"}
        </span>
        <Textarea
          value={motivation}
          onChange={(e) => setMotivation(e.target.value)}
          rows={2}
          maxLength={1500}
          placeholder={
            cs
              ? "Jedna konkrétní věta vašimi slovy."
              : "One specific sentence in your own words."
          }
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={draft}
          disabled={!jobText.trim() && !position.trim()}
        >
          {cs ? "Sestavit upravitelný návrh" : "Build editable draft"}
        </Button>
        <Label className="text-foreground-muted">
          {cs
            ? "Před odesláním zkontrolujte každé tvrzení."
            : "Review every claim before sending."}
        </Label>
      </div>
    </section>
  );
}
