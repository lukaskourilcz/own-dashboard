"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useGuardedNavigation, useUnsavedDraft } from "@/components/navigation-guard";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { useDict } from "@/lib/i18n";
import { safeWebUrl } from "@/lib/web-url";
import { CompetitorRecordError, type CompetitorFields, type CompetitorPatch } from "@/lib/competitor-records";
import type { CompetitorActions } from "./use-competitor-actions";
import type { Competitor, CompetitorCategory, Project } from "@/lib/types";

export type CompetitorForm = {
  id?: string;
  source?: Competitor;
  project_id: string;
  name: string;
  url: string;
  summary: string;
  category: CompetitorCategory;
  useful_features: string;
  social_content: string;
  pricing_model: string;
  lessons: string;
  relevance_score: string;
  score_rationale: string;
  social_links: string;
  source_urls: string;
  reviewed_at: string;
};

export function emptyCompetitorForm(projectId = ""): CompetitorForm {
  return {
    project_id: projectId,
    name: "",
    url: "",
    summary: "",
    category: "direct",
    useful_features: "",
    social_content: "",
    pricing_model: "",
    lessons: "",
    relevance_score: "",
    score_rationale: "",
    social_links: "",
    source_urls: "",
    reviewed_at: "",
  };
}

export function competitorToForm(competitor: Competitor): CompetitorForm {
  return {
    id: competitor.id,
    source: structuredClone(competitor),
    project_id: competitor.project_id,
    name: competitor.name,
    url: competitor.url ?? "",
    summary: competitor.summary,
    category: competitor.category,
    useful_features: competitor.useful_features.join("\n"),
    social_content: competitor.social_content,
    pricing_model: competitor.pricing_model,
    lessons: competitor.lessons,
    relevance_score: competitor.relevance_score ? String(competitor.relevance_score) : "",
    score_rationale: competitor.score_rationale,
    social_links: competitor.social_links.join("\n"),
    source_urls: competitor.source_urls.join("\n"),
    reviewed_at: competitor.reviewed_at ?? "",
  };
}

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
type EditableField = Exclude<keyof CompetitorForm, 'id' | 'source'>;
const editableFields: EditableField[] = ['project_id', 'name', 'url', 'summary', 'category', 'useful_features', 'social_content', 'pricing_model', 'lessons', 'relevance_score', 'score_rationale', 'social_links', 'source_urls', 'reviewed_at'];
function intentOf(form: CompetitorForm): CompetitorFields {
 return { project_id: form.project_id, name: form.name.trim(), url: form.url.trim() || null, summary: form.summary.trim(), category: form.category,
  useful_features: lines(form.useful_features), social_content: form.social_content.trim(), pricing_model: form.pricing_model.trim(), lessons: form.lessons.trim(),
  relevance_score: form.relevance_score ? Number(form.relevance_score) : null, score_rationale: form.score_rationale.trim(), social_links: lines(form.social_links), source_urls: lines(form.source_urls), reviewed_at: form.reviewed_at || null, sort_order: 0 };
}

/** Shared editor. The source version and creation identity survive an uncertain
 * response; closing or navigating uses the existing unsaved-draft guard. */
export function CompetitorDialog({ open, onOpenChange, form, setForm, projects, actions }: {
 open: boolean; onOpenChange: (open: boolean) => void; form: CompetitorForm; setForm: (next: CompetitorForm) => void; projects: Project[]; actions: CompetitorActions;
}) {
 const t = useDict(), p = t.portfolio, owner = useOwnerPreferences(), navigate = useGuardedNavigation();
 const [error, setError] = useState<'competitorChanged' | 'competitorSaveUnconfirmed' | null>(null), [saving, setSaving] = useState(false);
 const [visited, setVisited] = useState<ReadonlySet<EditableField>>(new Set());
 const savingRef = useRef(false), creationId = useRef<string | null>(null);
 const baseline = form.source ? competitorToForm(form.source) : emptyCompetitorForm(form.project_id);
 const changed = (key: EditableField) => form[key] !== baseline[key];
 const dirty = editableFields.some(key => changed(key));
 const invalid: Partial<Record<EditableField, string>> = {};
 if (!form.name.trim() || form.name.trim().length > 120) invalid.name = p.competitorNameInvalid;
 if (!projects.some(project => project.id === form.project_id)) invalid.project_id = p.nameAndProjectRequired;
 if ((!form.source || changed('url')) && form.url.trim() && !safeWebUrl(form.url.trim())) invalid.url = p.competitorUrlInvalid;
 for (const key of ['social_links', 'source_urls'] as const) if ((!form.source || changed(key)) && lines(form[key]).some(url => !safeWebUrl(url))) invalid[key] = p.competitorUrlInvalid;
 const valid = Object.keys(invalid).length === 0;
 const reset = () => { creationId.current = null; setError(null); setVisited(new Set()); setForm(emptyCompetitorForm(form.project_id)); onOpenChange(false); };
 const close = (next: boolean) => { if (next) onOpenChange(true); else if (!savingRef.current) navigate(reset); };
 async function save(): Promise<boolean> {
  if (savingRef.current || !open) return false;
  if (!valid) { setVisited(new Set(editableFields)); return false; }
  if (!dirty && form.source) { reset(); return true; }
  const captured = owner?.capture(); if (!captured || captured.signal.aborted) { setError('competitorSaveUnconfirmed'); return false; }
  const fields = intentOf(form), source = form.source;
  savingRef.current = true; setSaving(true); setError(null);
  try {
   if (source) {
    const patch = Object.fromEntries(editableFields.filter(changed).map(key => [key, fields[key]])) as CompetitorPatch;
    await actions.save({ source, fields: patch });
   } else { creationId.current ??= crypto.randomUUID(); await actions.save({ source: null, id: creationId.current, fields }); }
   captured.signal.throwIfAborted(); reset(); return true;
  } catch (error) {
   if (!captured.signal.aborted) setError(error instanceof CompetitorRecordError && error.reason === 'changed' ? 'competitorChanged' : 'competitorSaveUnconfirmed'); return false;
  } finally { savingRef.current = false; if (!captured.signal.aborted) setSaving(false); }
 }
 useUnsavedDraft({ dirty: open && dirty, pending: saving, canSave: valid && !saving, save, discard: reset });
 const field = (key: EditableField) => ({
  value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value }),
  onBlur: () => setVisited(previous => new Set([...previous, key])),
  'aria-invalid': visited.has(key) && !!invalid[key] || undefined,
  'aria-describedby': visited.has(key) && invalid[key] ? `competitor-${key}-error` : undefined,
 });
 const feedback = (key: EditableField) => visited.has(key) && invalid[key] ? <p id={`competitor-${key}-error`} role="alert" className="text-xs text-destructive">{invalid[key]}</p> : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent aria-describedby={undefined} aria-busy={saving} showClose={!saving} onEscapeKeyDown={event => { if (savingRef.current) event.preventDefault(); }} onPointerDownOutside={event => { if (savingRef.current) event.preventDefault(); }} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? p.editCompetitor : p.addCompetitor}</DialogTitle>
        </DialogHeader>
        <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3">
          <fieldset disabled={saving} className="min-w-0 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="competitor-project">{p.project}</Label>
              <SimpleSelect id="competitor-project" aria-invalid={visited.has("project_id") && !!invalid.project_id || undefined} aria-describedby={visited.has("project_id") && invalid.project_id ? "competitor-project_id-error" : undefined} value={form.project_id} onValueChange={(project_id) => { setForm({ ...form, project_id }); setVisited(previous => new Set([...previous, "project_id"])); }} options={projects.map((project) => ({ value: project.id, label: project.name }))} />{feedback("project_id")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-category">{p.competitorCategory}</Label>
              <SimpleSelect id="competitor-category" value={form.category} onValueChange={(category) => setForm({ ...form, category: category as CompetitorCategory })} options={(["direct", "indirect", "inspiration"] as CompetitorCategory[]).map((value) => ({ value, label: p.categories[value] }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-name">{p.competitorName}</Label>
              <Input id="competitor-name" autoFocus maxLength={120} {...field("name")} />{feedback("name")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-url">{p.competitorUrl}</Label>
              <Input id="competitor-url" inputMode="url" maxLength={2000} placeholder="https://" {...field("url")} />{feedback("url")}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="competitor-summary">{p.competitorSummary}</Label>
            <Textarea id="competitor-summary" rows={2} {...field("summary")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="competitor-features">{p.usefulFeatures}</Label>
              <Textarea id="competitor-features" rows={4} placeholder={p.usefulFeaturesHint} {...field("useful_features")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-social">{p.socialContent}</Label>
              <Textarea id="competitor-social" rows={4} {...field("social_content")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-pricing">{p.pricingModel}</Label>
              <Textarea id="competitor-pricing" rows={3} {...field("pricing_model")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-lessons">{p.lessons}</Label>
              <Textarea id="competitor-lessons" rows={3} {...field("lessons")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-score">{p.relevanceScore}</Label>
              <SimpleSelect id="competitor-score" value={form.relevance_score} onValueChange={(relevance_score) => setForm({ ...form, relevance_score })} options={[{ value: "", label: p.notScored }, ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value}/5` }))]} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-reviewed">{p.reviewedAt}</Label>
              <Input id="competitor-reviewed" type="date" {...field("reviewed_at")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="competitor-rationale">{p.scoreRationale}</Label>
              <Input id="competitor-rationale" {...field("score_rationale")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-social-links">{p.socialLinks}</Label>
              <Textarea id="competitor-social-links" rows={3} placeholder={p.oneUrlPerLine} {...field("social_links")} />{feedback("social_links")}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-sources">{p.sourceUrls}</Label>
              <Textarea id="competitor-sources" rows={3} placeholder={p.oneUrlPerLine} {...field("source_urls")} />{feedback("source_urls")}
            </div>
          </div>
          </fieldset>
          {error && <p role="alert" className="text-xs text-destructive">{p[error]}</p>}
          <div className="flex flex-col-reverse gap-2 pt-1 md:flex-row md:justify-end">
            <Button type="button" variant="outline" disabled={saving} onClick={() => close(false)}>{t.common.cancel}</Button>
            <Button type="submit" aria-busy={saving} disabled={saving || !valid}>{form.id ? t.common.save : t.common.add}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
