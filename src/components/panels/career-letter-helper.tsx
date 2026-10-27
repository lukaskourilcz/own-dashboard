"use client";
import { useMemo, useRef, useState } from "react";
import { useUnsavedDraft } from "@/components/navigation-guard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import {
  buildLetter,
  suggestApplicationAngles,
  suggestEvidence,
  type LetterLanguage,
} from "@/lib/jobs/letter-helper";
import { matchListing } from "@/lib/jobs/match";

type GuidanceInputs = { jobText: string; motivation: string; chosen: string[] | null; excludedSkills: string[] };
const sameChoices = (a: string[], b: string[]) => a.length === b.length && a.every(id => b.includes(id));
function sameInputs(a: GuidanceInputs, b: GuidanceInputs) {
  return a.jobText === b.jobText && a.motivation === b.motivation &&
    (a.chosen === null ? b.chosen === null : b.chosen !== null && sameChoices(a.chosen, b.chosen)) &&
    sameChoices(a.excludedSkills, b.excludedSkills);
}

export function CareerLetterHelper({
  position,
  company,
  description = "",
  value,
  onChange,
  language,
  onLanguageChange,
  readOnly = false,
}: {
  readOnly?: boolean;
  position: string;
  company: string;
  description?: string;
  value: string;
  onChange: (v: string) => void | boolean;
  language: LetterLanguage;
  onLanguageChange: (v: LetterLanguage) => void;
}) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const [inputs, setInputs] = useState<GuidanceInputs>(() => ({jobText: description, motivation: "", chosen: null, excludedSkills: []}));
  const [hasChanges, setHasChanges] = useState(false);
  const fields = useRef(inputs), baseline = useRef(inputs), dirty = useRef(false);
  const {jobText, motivation, chosen, excludedSkills} = inputs;
  function update(patch: Partial<GuidanceInputs>) {
    if (readOnly) return;
    const next = {...fields.current, ...patch};
    fields.current = next;
    dirty.current = !sameInputs(next, baseline.current);
    setHasChanges(dirty.current);
    setInputs(next);
  }
  function discard() {
    fields.current = baseline.current;
    dirty.current = false;
    setHasChanges(false);
    setInputs(baseline.current);
  }
  useUnsavedDraft({get dirty() {return dirty.current;}, canSave: false, save: async () => false, discard});
  const suggestions = useMemo(
    () => suggestEvidence(`${position} ${company} ${jobText}`),
    [position, company, jobText],
  );
  const angles = useMemo(
    () => suggestApplicationAngles(`${position} ${company} ${jobText}`),
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
  function draft() {
    if (readOnly) return;
    if (
      value.trim() &&
      !window.confirm(
        cs
          ? "Nahradit rozepsaný dopis novým návrhem?"
          : "Replace the current letter with this draft?",
      )
    )
      return;
    const current = fields.current;
    const evidence = suggestEvidence(`${position} ${company} ${current.jobText}`);
    const ids = current.chosen ?? evidence.slice(0, 3).map(e => e.evidence.id);
    const matched = matchListing({title: position, description: current.jobText, tags: [], seniority: null});
    const accepted = onChange(
      buildLetter({
        language,
        position,
        company,
        motivation: current.motivation,
        evidenceIds: evidence.filter(e => ids.includes(e.evidence.id)).map(e => e.evidence.id),
        skills: matched.matched.filter(s => !current.excludedSkills.includes(s.name)).map(s => s.name),
      }),
    );
    if (accepted !== false) {
      baseline.current = current;
      dirty.current = false;
      setHasChanges(false);
      setInputs({...current});
    }
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
          className="w-full sm:w-36"
          disabled={readOnly}
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
          readOnly={readOnly}
          onChange={(e) => update({jobText: e.target.value})}
          rows={3}
          maxLength={20000}
          className="text-sm"
        />
      </label>
      <p className="text-sm text-foreground-muted">
        {cs
          ? "Doporučení vycházejí z klíčových slov a vašich skutečných zkušeností. Vyberte 1–3 nejrelevantnější příklady. Text se neposílá do AI."
          : "Suggestions use keywords and your actual experience. Choose the 1–3 most relevant examples. This text is not sent to AI."}
      </p>
      {!!angles.length && (
        <div className="rounded border border-border bg-surface p-3">
          <h4 className="text-sm font-medium">
            {cs ? "Úhel dopisu pro tuto pozici" : "Cover-letter angle for this role"}
          </h4>
          <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-foreground-muted">
            {angles.map((angle) => (
              <li key={angle.id}>{angle.text[language]}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-3">
        {suggestions.map(({ evidence: e, domainMatch }) => (
          <label
            key={e.id}
            className="flex items-start gap-3 rounded border border-border bg-surface p-3 text-sm"
          >
            <Checkbox
              checked={selectedIds.includes(e.id)}
              disabled={readOnly}
              onCheckedChange={(checked) => {
                const defaults = suggestEvidence(`${position} ${company} ${fields.current.jobText}`).slice(0, 3).map(e => e.evidence.id);
                const current = fields.current.chosen ?? defaults;
                const next = checked ? [...new Set([...current, e.id])] : current.filter(id => id !== e.id);
                update({chosen: sameChoices(next, defaults) ? null : next});
              }}
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
                  disabled={readOnly}
                  onCheckedChange={(checked) => update({excludedSkills: checked
                    ? fields.current.excludedSkills.filter(id => id !== s.name)
                    : [...new Set([...fields.current.excludedSkills, s.name])]})}
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
          readOnly={readOnly}
          onChange={(e) => update({motivation: e.target.value})}
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
          disabled={readOnly || (!jobText.trim() && !position.trim())}
        >
          {cs ? "Sestavit upravitelný návrh" : "Build editable draft"}
        </Button>
        {hasChanges && <Button type="button" variant="outline" onClick={discard}>
          {cs ? "Zahodit úpravy průvodce" : "Discard guidance changes"}
        </Button>}
        <Label className="text-foreground-muted">
          {cs
            ? "Před odesláním zkontrolujte každé tvrzení."
            : "Review every claim before sending."}
        </Label>
      </div>
    </section>
  );
}
