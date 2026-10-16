"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  Copy,
  FileText,
  MapPin,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useLang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import {
  OSLO_JOBS,
  OSLO_RESEARCHED_ON,
  STRONG_OSLO_MATCH,
  researchForUrl,
  researchScore,
  researchIsStale,
  type ResearchJob,
} from "@/lib/jobs/oslo-research";
import type { JobApplication, SavedJobPosition, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  activated: boolean;
  onActivate: () => Promise<void>;
  isPreview: boolean;
  userId: string;
  savedPositions: SavedJobPosition[];
  setSavedPositions: Updater<SavedJobPosition[]>;
  applications: JobApplication[];
  onPrepare: (position: SavedJobPosition) => void;
};

export function OsloCareerWorkspace(props: Props) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("priority");
  const [selected, setSelected] = useState<ResearchJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const confirm = useConfirmation();
  const trigger = useRef<HTMLButtonElement>(null);
  const [today] = useState(() => new Date());
  const isPriority = (job: ResearchJob) =>
    researchScore(job) >= STRONG_OSLO_MATCH &&
    !job.blocker &&
    !researchIsStale(job, today) &&
    !/contract|part-time/i.test(job.arrangement);
  const rows = OSLO_JOBS.filter((job) => {
    if (
      !`${job.company} ${job.title} ${job.stack.join(" ")}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
    )
      return false;
    if (filter === "priority") return isPriority(job);
    if (filter === "stretch") return !!job.stretch;
    if (filter === "ai")
      return /\bai\b|llm|langchain|n8n/i.test(job.stack.join(" "));
    if (filter === "contract")
      return /contract|part-time/i.test(job.arrangement);
    return true;
  }).sort((a, b) => researchScore(b) - researchScore(a));
  const saved = selected
    ? props.savedPositions.find(
        (row) => researchForUrl(row.url)?.id === selected.id,
      )
    : undefined;
  const applied = selected
    ? props.applications.find(
        (row) => researchForUrl(row.url)?.id === selected.id,
      )
    : undefined;

  async function open(job: ResearchJob) {
    setDirty(false);
    setSelected(job);
    setLoadError(false);
    if (props.activated || props.isPreview) return;
    setLoading(true);
    try {
      await props.onActivate();
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className="space-y-6"
      aria-label={cs ? "Pracovní příležitosti v Oslu" : "Oslo opportunities"}
    >
      <div className="career-overview grid gap-5 rounded-xl border border-border bg-surface p-5 sm:grid-cols-[1fr_auto] sm:p-6">
        <div>
          <p className="text-xs font-semibold tracking-wide text-primary">
            OSLO · NORWAY
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {cs ? "Další krok v Oslu." : "Your next role in Oslo."}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-foreground-muted">
            {cs
              ? "Frontend, fullstack a praktické AI integrace. Silné shody nahoře, seniornější příležitosti i konkrétní mezery v detailu."
              : "Frontend, fullstack and practical AI integrations. Strong matches first, with senior stretches and concrete gaps in each detail."}
          </p>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-foreground-muted">
            <MapPin className="size-3.5" aria-hidden />
            {cs
              ? "Oslo a okolí · remote pozice slučitelné s prací z Norska"
              : "Oslo area · remote roles compatible with Norway"}
          </p>
        </div>
        <dl className="flex gap-6 sm:border-l sm:border-border sm:pl-6">
          <div>
            <dt className="text-xs text-foreground-muted">
              {cs ? "Prioritní shody" : "Priority matches"}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {OSLO_JOBS.filter(isPriority).length}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-foreground-muted">
              {cs ? "Prověřené role" : "Researched roles"}
            </dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
              {OSLO_JOBS.length}
            </dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-3 size-4 text-foreground-subtle"
            aria-hidden
          />
          <Input
            className="h-10 pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              cs
                ? "Firma, pozice nebo technologie"
                : "Company, role or technology"
            }
            aria-label={cs ? "Hledat pozici v Oslu" : "Search Oslo positions"}
          />
        </div>
        <SimpleSelect
          value={filter}
          onValueChange={setFilter}
          className="w-full sm:w-64"
          aria-label={cs ? "Výběr příležitostí" : "Opportunity filter"}
          options={[
            {
              value: "priority",
              label: cs
                ? "Prioritní shody · 75 % a více"
                : "Priority matches · 75%+",
            },
            {
              value: "all",
              label: cs ? "Všechny prověřené role" : "All researched roles",
            },
            {
              value: "stretch",
              label: cs ? "Seniornější příležitosti" : "Senior stretches",
            },
            {
              value: "ai",
              label: cs ? "AI a automatizace" : "AI and automation",
            },
            {
              value: "contract",
              label: cs ? "Doplňkové kontrakty" : "Alternative contracts",
            },
          ]}
        />
      </div>
      <p className="text-xs leading-relaxed text-foreground-muted">
        {cs
          ? "Procenta vyjadřují shodu s profilem, nikoli pravděpodobnost přijetí. Výzkum k "
          : "Percentages measure profile fit, not hiring probability. Researched "}
        {OSLO_RESEARCHED_ON}
        {cs
          ? ". Dostupnost a podmínky před podáním znovu ověřte."
          : ". Recheck availability and requirements before applying."}
      </p>
      <div
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="oslo-job-grid"
      >
        {rows.map((job) => {
          const state =
            props.activated &&
            (props.applications.some(
              (a) => researchForUrl(a.url)?.id === job.id,
            )
              ? "applied"
              : props.savedPositions.some(
                    (s) =>
                      researchForUrl(s.url)?.id === job.id && !!s.cover_letter,
                  )
                ? "letter"
                : null);
          return (
            <button
              key={job.id}
              type="button"
              onClick={(event) => {
                trigger.current = event.currentTarget;
                void open(job);
              }}
              className="career-job-card focus-ring group flex min-h-52 flex-col rounded-lg border border-border bg-surface p-5 text-left shadow-card transition-[border-color,box-shadow,transform] hover:border-border-strong hover:shadow-soft active:scale-[0.99]"
              aria-label={`${job.company} · ${job.title} · ${researchScore(job)}% ${cs ? "shoda" : "match"}`}
            >
              <div className="flex w-full items-start justify-between gap-3">
                <span className="text-sm font-medium text-foreground-muted">
                  {job.company}
                </span>
                <ArrowUpRight
                  className="size-4 shrink-0 text-foreground-subtle transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  aria-hidden
                />
              </div>
              <h3 className="mt-3 text-base font-semibold leading-snug tracking-tight">
                {job.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-foreground-muted">
                {job.stack.slice(0, 3).join(" · ")}
              </p>
              <div className="mt-auto flex w-full items-end justify-between gap-3 pt-5">
                <span className="text-xs text-foreground-muted">
                  {job.location}
                  <span className="mt-1 block">
                    {researchIsStale(job, today)
                      ? cs
                        ? "Znovu ověřit"
                        : "Recheck"
                      : job.blocker
                        ? cs
                          ? "Překážka v požadavcích"
                          : "Requirement barrier"
                        : job.stretch
                          ? cs
                            ? "Seniornější role"
                            : "Stretch role"
                          : job.source === "Employer" && cs ? "Zaměstnavatel" : job.source}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-right",
                    researchScore(job) >= 75 && !job.blocker
                      ? "text-primary"
                      : "text-foreground-muted",
                  )}
                >
                  <strong className="text-2xl font-semibold tabular-nums tracking-tight">
                    {researchScore(job)}
                    <span className="text-sm">%</span>
                  </strong>
                  <span className="block text-[11px]">
                    {cs ? "shoda s profilem" : "profile match"}
                  </span>
                </span>
              </div>
              {state && (
                <span className="mt-3 flex items-center gap-1 border-t border-border pt-3 text-xs text-foreground-muted">
                  <Check className="size-3.5" aria-hidden />
                  {state === "applied"
                    ? cs
                      ? "Odesláno"
                      : "Applied"
                    : cs
                      ? "Dopis připraven"
                      : "Letter prepared"}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {!rows.length && (
        <Card className="p-8 text-center">
          <p role="status">
            {cs
              ? "Žádná role neodpovídá filtru."
              : "No roles match this filter."}
          </p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
          >
            {cs ? "Zobrazit všechny role" : "Show all roles"}
          </Button>
        </Card>
      )}
      <details className="rounded-lg border border-border bg-surface px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium focus-ring">
          {cs
            ? "Jak vzniká skóre a co znamená stáří nabídky"
            : "How scoring and listing age work"}
        </summary>
        <div className="mt-3 space-y-2 leading-relaxed text-foreground-muted">
          <p>
            {cs
              ? "Technologie 40 bodů, zkušenost 25, doména 15, lokalita 10 a jazyk 10. Jde o ruční posouzení doloženého profilu. Povinná norština omezuje výsledek na 49 %, jiná nevyřešená podmínka na 59 %. Trh, konkurenci ani interní výběr firmy skóre nezná."
              : "Stack 40 points, experience 25, domain 15, location 10 and language 10. Scores are a manual assessment of documented experience. Mandatory Norwegian caps the result at 49%, other unresolved conditions at 59%. The score cannot account for competition or employer decisions."}
          </p>
          <p>
            {cs
              ? "Na LinkedIn byly ukládány pouze nabídky s ověřeným zveřejněním v posledních 5 týdnech. Repost bez původního data nestačí. U přímých kariérních webů může být aktivní inzerát starší. Po 35 dnech se výzkum přesune z priorit k opětovnému ověření; datum se při aktualizaci API nepřepisuje."
              : "Only LinkedIn listings with a verified posting age under 5 weeks were saved. A repost date alone is insufficient. An active employer-site vacancy may be older. After 35 days research leaves priorities for rechecking; API refresh does not reset its observation date."}
          </p>
        </div>
      </details>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {[
          [
            "LinkedIn · ≤ 5 týdnů",
            "LinkedIn · ≤ 5 weeks",
            "https://www.linkedin.com/jobs/search/?keywords=frontend%20fullstack%20typescript&location=Oslo%2C%20Norway&f_TPR=r3024000",
          ],
          [
            "Uložené na The Hub",
            "Saved on The Hub",
            "https://thehub.io/client/my-jobs",
          ],
          [
            "FINN · Oslo",
            "FINN · Oslo",
            "https://www.finn.no/job/search?location=1.20001.20061&q=react",
          ],
          [
            "NAV · Arbeidsplassen",
            "NAV · Arbeidsplassen",
            "https://arbeidsplassen.nav.no/stillinger",
          ],
          [
            "Startuplab · Jobs",
            "Startuplab · Jobs",
            "https://jobs.startuplab.no/jobs",
          ],
        ].map(([cz, en, url]) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex min-h-8 items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            {cs ? cz : en}
            <ArrowUpRight className="size-3" aria-hidden />
          </a>
        ))}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (open) return;
          if (!dirty) {
            setSelected(null);
            return;
          }
          void confirm({
            title: cs ? "Zahodit neuložené úpravy?" : "Discard unsaved edits?",
            description: cs
              ? "Dopis má neuložené změny. Vraťte se k němu a uložte je, nebo je zahoďte."
              : "This letter has unsaved changes. Return and save them, or discard the edits.",
            confirmLabel: cs ? "Zahodit úpravy" : "Discard edits",
            cancelLabel: cs ? "Pokračovat v úpravách" : "Keep editing",
            destructive: true,
          }).then((ok) => {
            if (ok) {
              setDirty(false);
              setSelected(null);
            }
          });
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
          className="w-[calc(100%-1.5rem)] max-w-4xl p-0"
          aria-describedby="oslo-role-description"
        >
          {selected && (
            <>
              <div className="border-b border-border px-5 pb-4 pt-6 sm:px-7">
                <p className="mb-2 text-xs font-medium text-primary">
                  {selected.company}
                </p>
                <DialogTitle className="pr-10 text-xl leading-snug tracking-tight">
                  {selected.title}
                </DialogTitle>
                <DialogDescription id="oslo-role-description" className="mt-2">
                  {selected.location} · {selected.arrangement}
                </DialogDescription>
              </div>
              <RoleResearch
                key={selected.id}
                job={selected}
                isPreview={props.isPreview}
              />
              {loading ? (
                <p className="px-5 pb-6 text-sm" role="status">
                  {cs
                    ? "Načítám soukromý dopis…"
                    : "Loading your private letter…"}
                </p>
              ) : loadError ? (
                <div className="px-5 pb-6" role="alert">
                  <p>
                    {cs
                      ? "Soukromý dopis se nepodařilo načíst."
                      : "Could not load your private letter."}
                  </p>
                  <Button onClick={() => void open(selected)}>
                    {cs ? "Zkusit znovu" : "Retry"}
                  </Button>
                </div>
              ) : (
                <RoleLetter
                  key={`${selected.id}:${saved?.id ?? "new"}`}
                  job={selected}
                  position={saved}
                  application={applied}
                  {...props}
                  onDirtyChange={setDirty}
                  onPrepare={(position) => {
                    setSelected(null);
                    props.onPrepare(position);
                  }}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function RoleResearch({
  job,
  isPreview,
}: {
  job: ResearchJob;
  isPreview: boolean;
}) {
  const { lang } = useLang();
  const cs = lang === "cs";
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<
    "open" | "closed" | "unknown" | "error" | null
  >(null);
  async function check() {
    if (isPreview) {
      setAvailability("unknown");
      return;
    }
    setChecking(true);
    try {
      const response = await fetch("/api/jobs/research-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id }),
      });
      if (!response.ok) throw new Error("Check failed");
      const data = await response.json();
      setAvailability(
        ["open", "closed", "unknown"].includes(data.state)
          ? data.state
          : "unknown",
      );
    } catch {
      setAvailability("error");
    } finally {
      setChecking(false);
    }
  }
  const labels = cs
    ? ["Technologie", "Zkušenost", "Doména", "Lokalita", "Jazyk"]
    : ["Stack", "Experience", "Domain", "Location", "Language"];
  return (
    <div className="space-y-5 px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          <strong className="mr-2 text-2xl tabular-nums text-primary">
            {researchScore(job)}%
          </strong>
          {cs ? "shoda s profilem" : "profile match"}
        </span>
        <Button asChild variant="outline">
          <a href={job.url} target="_blank" rel="noopener noreferrer">
            {cs ? "Otevřít původní nabídku" : "Open original listing"}
            <ArrowUpRight aria-hidden />
          </a>
        </Button>
      </div>
      <p className="text-sm leading-relaxed">{job.summary[lang]}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={checking}
          onClick={() => void check()}
        >
          {checking
            ? cs
              ? "Ověřuji…"
              : "Checking…"
            : cs
              ? "Ověřit dostupnost"
              : "Check availability"}
        </Button>
        {availability && (
          <p role="status" className="text-xs text-foreground-muted">
            {availability === "open"
              ? cs
                ? "Nabídka nyní obsahuje přihlášení."
                : "Listing currently exposes an application signal."
              : availability === "closed"
                ? cs
                  ? "Nabídka je uzavřená nebo po termínu. Neodesílejte bez dalšího ověření."
                  : "Listing is closed or expired. Recheck before applying."
                : availability === "error"
                  ? cs
                    ? "Kontrola se nezdařila. Zkuste to znovu nebo otevřete zdroj."
                    : "Check failed. Retry or open the source."
                  : cs
                    ? "Dostupnost se nepodařilo spolehlivě potvrdit; otevřete původní nabídku."
                    : "Availability could not be confirmed; open the original listing."}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
        {job.points.map((point, i) => (
          <div key={labels[i]} className="rounded-md bg-surface-inset p-3">
            <dt className="text-foreground-muted">{labels[i]}</dt>
            <dd className="mt-1 font-semibold tabular-nums">
              {point} / {[40, 25, 15, 10, 10][i]}
            </dd>
          </div>
        ))}
      </dl>
      {job.blocker && (
        <p className="text-xs text-warning">
          {cs
            ? "Celkové skóre je omezeno nevyřešeným povinným požadavkem."
            : "The total is capped by an unresolved mandatory requirement."}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">
            {cs ? "Na čem stavět přihlášku" : "Evidence to lead with"}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
            {job.evidence[lang]}
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold">
            {cs ? "Mezery a co ověřit" : "Gaps and checks"}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
            {job.gaps[lang]}
          </p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-foreground-muted">
        {job.salary && `${job.salary} · `}
        {job.deadline && `${cs ? "Termín" : "Deadline"}: ${job.deadline} · `}
        {job.postedLabel && `${job.postedLabel} · `}
        {cs ? "Zdroj" : "Source"}: {job.source === "Employer" && cs ? "Zaměstnavatel" : job.source} · {OSLO_RESEARCHED_ON}
        {job.linkedinSaved
          ? cs
            ? " · Uloženo na LinkedIn"
            : " · Saved on LinkedIn"
          : ""}
      </p>
      {job.aliases.length > 0 && (
        <div className="flex flex-wrap gap-3 text-xs">
          {job.aliases
            .filter(
              (url) =>
                !url.includes("linkedin.com") || job.source !== "LinkedIn",
            )
            .map((url, i) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring text-primary underline underline-offset-4"
              >
                {new URL(url).hostname.replace("www.", "")} {i + 1}
              </a>
            ))}
        </div>
      )}
    </div>
  );
}

function RoleLetter({
  job,
  position,
  application,
  isPreview,
  userId,
  setSavedPositions,
  onPrepare,
  onDirtyChange,
}: Pick<Props, "isPreview" | "userId" | "setSavedPositions" | "onPrepare"> & {
  job: ResearchJob;
  position?: SavedJobPosition;
  application?: JobApplication;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const cs = useLang().lang === "cs";
  const toast = useToast();
  const qc = useQueryClient();
  const [letter, setLetter] = useState(
    position?.cover_letter ?? application?.cover_letter ?? "",
  );
  const [notes, setNotes] = useState(position?.notes ?? "");
  const [readiness, setReadiness] = useState(
    position?.readiness ?? (job.blocker ? "needs_review" : "draft"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty =
    letter !== (position?.cover_letter ?? application?.cover_letter ?? "") ||
    notes !== (position?.notes ?? "") ||
    readiness !==
      (position?.readiness ?? (job.blocker ? "needs_review" : "draft"));
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (isPreview) {
        toast.ok(
          cs
            ? "Náhled: změny se neukládají do účtu."
            : "Preview: changes are not written to your account.",
        );
        return;
      }
      const client = createClient();
      const payload = {
        user_id: userId,
        title: job.title,
        company: job.company,
        url: job.url,
        source: job.source,
        location: job.location,
        description: job.summary.en,
        cover_letter: letter,
        notes: notes.trim() || null,
        readiness,
        updated_at: new Date().toISOString(),
      };
      const response = position
        ? await client
            .from("saved_job_positions")
            .update(payload)
            .eq("id", position.id)
            .eq("user_id", userId)
            .select()
            .single()
        : await client
            .from("saved_job_positions")
            .insert(payload)
            .select()
            .single();
      if (response.error || !response.data)
        throw response.error ?? new Error("Missing saved row");
      const row = response.data as SavedJobPosition;
      setSavedPositions((current) => [
        row,
        ...current.filter((value) => value.id !== row.id),
      ]);
      void qc.invalidateQueries({ queryKey: qk.savedJobPositions });
      toast.ok(cs ? "Koncept uložen." : "Draft saved.");
    } catch {
      setError(
        cs
          ? "Dopis se nepodařilo uložit. Text zůstává v dialogu; zkuste to znovu."
          : "Could not save the letter. Your text remains in this dialog; please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4 border-t border-border bg-surface-secondary px-5 py-5 sm:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4" aria-hidden />
          {cs ? "Průvodní dopis · anglicky" : "Cover letter · English"}
        </h3>
        {position?.cover_letter_url && (
          <a
            href={position.cover_letter_url}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring text-xs text-primary underline underline-offset-4"
          >
            Google Docs ↗
          </a>
        )}
      </div>
      {application && (
        <p className="text-sm text-success">
          {cs
            ? "Přihláška již zaznamenána jako odeslaná."
            : "Application already recorded as sent."}
        </p>
      )}
      {isPreview && (
        <p className="text-xs text-foreground-muted">
          {cs
            ? "Náhled nezobrazuje soukromé dopisy. Ve vašem účtu se načtou po otevření pozice."
            : "Preview does not expose private letters. Your account loads them when a role opens."}
        </p>
      )}
      <Label htmlFor="oslo-letter" className="sr-only">
        {cs ? "Text průvodního dopisu" : "Cover letter text"}
      </Label>
      <Textarea
        id="oslo-letter"
        value={letter}
        onChange={(e) => setLetter(e.target.value)}
        rows={13}
        className="bg-surface text-sm leading-7"
        placeholder={
          cs
            ? "Zde bude váš uložený dopis. Nový koncept můžete napsat a uložit."
            : "Your saved letter appears here. You can write and save a new draft."
        }
      />
      <div>
        <Label htmlFor="oslo-letter-notes">
          {cs ? "Poznámky k přihlášce" : "Application notes"}
        </Label>
        <Textarea
          id="oslo-letter-notes"
          className="mt-2 bg-surface"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <SimpleSelect
        value={readiness}
        onValueChange={(value) => {
          if (
            value === "draft" ||
            value === "ready" ||
            value === "needs_review"
          )
            setReadiness(value);
        }}
        aria-label={cs ? "Připravenost dopisu" : "Letter readiness"}
        options={[
          { value: "draft", label: cs ? "Rozpracováno" : "Draft" },
          { value: "ready", label: cs ? "Připraveno" : "Ready" },
          {
            value: "needs_review",
            label: cs ? "Nejdřív zkontrolovat" : "Review first",
          },
        ]}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !letter.trim() || (!dirty && !!position)}
          onClick={() => void save()}
        >
          {busy
            ? cs
              ? "Ukládám…"
              : "Saving…"
            : cs
              ? "Uložit koncept"
              : "Save draft"}
        </Button>
        <Button
          variant="outline"
          disabled={!letter.trim()}
          onClick={() =>
            navigator.clipboard
              .writeText(letter)
              .then(() => toast.ok(cs ? "Dopis zkopírován." : "Letter copied."))
              .catch(() =>
                toast.err(cs ? "Kopírování se nezdařilo." : "Could not copy."),
              )
          }
        >
          <Copy aria-hidden />
          {cs ? "Kopírovat dopis" : "Copy letter"}
        </Button>
        {position && !application && (
          <Button
            variant="outline"
            disabled={busy || dirty}
            onClick={() => onPrepare(position)}
          >
            {cs ? "Zaznamenat odeslání…" : "Record application…"}
          </Button>
        )}
      </div>
      <p className="text-xs leading-relaxed text-foreground-muted">
        {cs
          ? "Dopis před odesláním zkontrolujte. Odkaz nabídky otevře formulář zaměstnavatele; aplikace sama nic neodesílá. Odeslání zaznamenejte až po skutečném podání."
          : "Review the letter before sending. The listing link opens the employer's form; this app does not submit applications. Record sending only after actually applying."}
      </p>
    </div>
  );
}

export function OsloLetterReview() {
  const cs = useLang().lang === "cs";
  return (
    <Card className="mb-5 p-5">
      <h2 className="text-base font-semibold">
        {cs
          ? "Dopisy: zachovat váš hlas, zpřesnit důkazy"
          : "Cover letters: keep your voice, sharpen the evidence"}
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground-muted">
        <li>
          {cs
            ? "Zachovat osobní „Hello…“, nadšení pro programování a konkrétní spojení produktu s DevSharkem. Původní Attensi dopis je osobnější než starší šablony."
            : "Keep the personal “Hello…”, enthusiasm for programming and a concrete DevShark connection. Your original Attensi letter is more personal than the older templates."}
        </li>
        <li>
          {cs
            ? "Přidat 2–3 důkazy podle role: bankovní BFF/WCAG, vedení rezervační platformy nebo LLM analýzu PDF v Ersilia. AI sekci podpořit n8n, LangChain, Apify a TypeSafe AI (Jev)."
            : "Add 2–3 relevant examples: banking BFF/WCAG, leading a reservation platform, or Ersilia LLM PDF analysis. Name n8n, LangChain, Apify and TypeSafe AI (Jev) where relevant."}
        </li>
        <li>
          {cs
            ? "Zkrátit historii kurzů a všechny tři barcelonské kontrakty do jedné věty. Vynechat opakované nabídky live codingu a obecné sliby spolehlivosti; důkazy jsou přesvědčivější."
            : "Condense courses and the three Barcelona contracts. Remove repeated live-coding offers and generic reliability promises; concrete work is stronger evidence."}
        </li>
        <li>
          {cs
            ? "Opravit staré „based in Prague/Czechia“. Před 22. říjnem psát o plánovaném přestěhování, po příjezdu upravit na bydliště v Oslu. EU občanství uvést, číslo a daňovou kartu neprezentovat jako již vyřízené."
            : "Replace stale Prague/Czechia location statements. Before October 22 describe the planned move; update to Oslo residence after arrival. State EU citizenship without implying tax/identity registration is already complete."}
        </li>
        <li>
          {cs
            ? "Nedoplňovat roky, titul ani expertizu, které CV nedokládá. „LLM integrations“ je přesnější než vývoj/trénování modelů. U Attensi otevřeně rozlišit React od SvelteKit/SignalR a základní C# od produkční expertizy."
            : "Do not invent years, degrees or expertise. “LLM integrations” is more accurate than model development/training. For Attensi distinguish React experience from learning SvelteKit/SignalR and C# familiarity from production expertise."}
        </li>
      </ul>
    </Card>
  );
}
